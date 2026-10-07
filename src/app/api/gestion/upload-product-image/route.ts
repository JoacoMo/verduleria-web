import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { logSecurityEvent } from '@/lib/security-log';
import { readBodyLimited } from '@/lib/request-body';
import { detectImageType, type AllowedImageType } from '@/lib/validation';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';

// El bucket es público: si se pudiera subir cualquier cosa, una sesión robada
// permitiría alojar HTML/SVG con scripts en el dominio de Supabase.
const ALLOWED_IMAGE_TYPES: readonly AllowedImageType[] = ['image/webp', 'image/jpeg', 'image/png'];
const EXTENSION_BY_TYPE: Record<AllowedImageType, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
// 4 MB y no 5: Vercel corta cualquier cuerpo de más de 4,5 MB con su propio 413
// (que no es JSON y el panel mostraba como un error genérico). Con el margen del
// multipart sigue entrando debajo de ese límite. El panel comprime a WebP de
// 800 px antes de subir, así que una foto real queda muy por debajo.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
// Margen para los bordes del multipart (nombre del campo, boundary, etc.).
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const TOO_LARGE_MESSAGE = 'La imagen no puede superar los 4 MB.';
const UNREADABLE_MESSAGE = 'No se pudo leer la imagen enviada.';
// El nombre de cada archivo es único y nunca se reescribe: el navegador y la
// CDN de Supabase lo pueden cachear un año.
const IMAGE_CACHE_SECONDS = 365 * 24 * 60 * 60;

function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

function storageHeaders(serviceKey: string, extra: Record<string, string> = {}) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra };
}

/** Supabase responde "bucket no existe" con 404 o con 400 + mensaje, según la versión. */
function isBucketNotFound(status: number, body: string) {
  return (status === 404 || status === 400) && /bucket not found|not_found/i.test(body);
}

class BucketMissingError extends Error {}

/**
 * Crea el bucket si no existe. Antes esto corría en CADA subida (listar todos
 * los buckets + forzar `public: true`): dos requests extra por imagen y, peor,
 * pisaba cualquier configuración que el dueño hubiera hecho en Supabase.
 * Ahora se verifica una vez por instancia y solo al crearlo se lo marca público.
 */
async function createBucketIfMissing(supabaseUrl: string, serviceKey: string) {
  const check = await fetch(`${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}`, {
    headers: storageHeaders(serviceKey),
  });
  if (check.ok) return;

  const checkBody = await check.text();
  if (!isBucketNotFound(check.status, checkBody)) {
    throw new Error(`No se pudo verificar el bucket de Storage (${check.status}): ${checkBody.slice(0, 200)}`);
  }

  const create = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: storageHeaders(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      id: SUPABASE_STORAGE_BUCKET,
      name: SUPABASE_STORAGE_BUCKET,
      public: true,
      // Segunda barrera del lado de Supabase, por si algún día se sube por otro camino.
      file_size_limit: MAX_UPLOAD_BYTES,
      allowed_mime_types: ALLOWED_IMAGE_TYPES,
    }),
  });
  if (create.ok) return;

  const createBody = await create.text();
  // Otra instancia lo creó al mismo tiempo: está bien.
  if (create.status === 409 || /already exists|duplicate/i.test(createBody)) return;
  throw new Error(`No se pudo crear el bucket de Storage (${create.status}): ${createBody.slice(0, 200)}`);
}

// Promesa memoizada a nivel módulo: la primera subida de cada instancia hace la
// verificación y las siguientes reusan el resultado. Si falla, se olvida para
// que la próxima subida lo vuelva a intentar.
let bucketReady: Promise<void> | null = null;

function ensureBucketOnce(supabaseUrl: string, serviceKey: string) {
  if (!bucketReady) {
    bucketReady = createBucketIfMissing(supabaseUrl, serviceKey).catch((error) => {
      bucketReady = null;
      throw error;
    });
  }
  return bucketReady;
}

async function uploadToStorage(supabaseUrl: string, serviceKey: string, fileName: string, contentType: string, bytes: Uint8Array<ArrayBuffer>) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/${fileName}`, {
    method: 'POST',
    headers: storageHeaders(serviceKey, {
      'Content-Type': contentType,
      'cache-control': `max-age=${IMAGE_CACHE_SECONDS}`,
      // El nombre es nuevo siempre: nunca se reemplaza una imagen existente.
      'x-upsert': 'false',
    }),
    body: bytes,
  });
  if (response.ok) return;

  const body = await response.text();
  if (isBucketNotFound(response.status, body)) {
    // Se borró el bucket después de la verificación de esta instancia.
    bucketReady = null;
    throw new BucketMissingError(body);
  }
  throw new Error(`Supabase Storage respondió ${response.status}: ${body.slice(0, 200)}`);
}

export async function POST(request: Request) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'upload');
  if (limited) return limited;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error en POST /api/gestion/upload-product-image: faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
    return NextResponse.json({ error: 'La subida de imágenes no está configurada.' }, { status: 500 });
  }

  // request.formData() lee el cuerpo entero a memoria sin tope. Se lee primero
  // con un contador de bytes que corta el stream apenas se pasa (también sin
  // Content-Length, con Transfer-Encoding: chunked) y recién después se arma el
  // multipart con lo leído.
  const body = await readBodyLimited(request, MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!body.ok) {
    return body.reason === 'demasiado_grande'
      ? NextResponse.json({ error: TOO_LARGE_MESSAGE }, { status: 413 })
      : NextResponse.json({ error: UNREADABLE_MESSAGE }, { status: 400 });
  }

  let file: FormDataEntryValue | null;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    file = (await new Response(body.bytes, { headers: { 'content-type': contentType } }).formData()).get('file');
  } catch {
    return NextResponse.json({ error: UNREADABLE_MESSAGE }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No se recibió ninguna imagen.' }, { status: 400 });
  }

  const declaredType = file.type.toLowerCase();
  if (!isAllowedImageType(declaredType)) {
    return NextResponse.json({ error: 'Formato no permitido. Subí una imagen WebP, JPG o PNG.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'La imagen está vacía.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: TOO_LARGE_MESSAGE }, { status: 413 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());

    // El tipo declarado lo elige quien manda el request; los primeros bytes no
    // mienten. Tienen que coincidir: un "image/png" que adentro es HTML se rechaza.
    const realType = detectImageType(bytes.subarray(0, 16));
    if (realType !== declaredType) {
      logSecurityEvent('upload_rechazado', {
        ip: getClientIp(request),
        path: '/api/gestion/upload-product-image',
        method: 'POST',
        reason: `tipo declarado ${declaredType}, contenido ${realType ?? 'desconocido'}`,
      });
      return NextResponse.json(
        { error: 'El archivo no es una imagen WebP, JPG o PNG válida (o no coincide con su extensión).' },
        { status: 400 },
      );
    }

    await ensureBucketOnce(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // El nombre lo generamos nosotros a partir del tipo real: nunca usamos la
    // extensión que venga en file.name, así no se puede forzar un .html o un .svg.
    const fileName = `${Date.now()}-${randomUUID()}.${EXTENSION_BY_TYPE[realType]}`;
    await uploadToStorage(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, fileName, realType, bytes);

    return NextResponse.json({
      url: `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/${fileName}`,
    });
  } catch (error) {
    if (error instanceof BucketMissingError) {
      console.error('Error en POST /api/gestion/upload-product-image: el bucket no existe.', error.message);
      return NextResponse.json(
        {
          error: `No existe el bucket de imágenes "${SUPABASE_STORAGE_BUCKET}" en Supabase Storage. Probá de nuevo (se vuelve a crear); si sigue fallando, revisá SUPABASE_STORAGE_BUCKET.`,
        },
        { status: 500 },
      );
    }
    console.error('Error en POST /api/gestion/upload-product-image:', error);
    return NextResponse.json({ error: 'No se pudo subir la imagen.' }, { status: 500 });
  }
}
