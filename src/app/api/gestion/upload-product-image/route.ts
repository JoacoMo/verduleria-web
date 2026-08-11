import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';

// El bucket es público: si se pudiera subir cualquier cosa, un token robado
// permitiría alojar HTML/SVG con scripts en el dominio de Supabase.
const ALLOWED_IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function ensureBucketExists() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Faltan variables de Supabase Storage.');
  }

  const bucketsResponse = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!bucketsResponse.ok) {
    throw new Error('No se pudo verificar el bucket de Storage.');
  }

  const buckets = await bucketsResponse.json();
  const bucketExists = Array.isArray(buckets) && buckets.some((bucket: { name?: string }) => bucket.name === SUPABASE_STORAGE_BUCKET);

  if (bucketExists) {
    const updateResponse = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${SUPABASE_STORAGE_BUCKET}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        public: true,
      }),
    });

    if (!updateResponse.ok) {
      const body = await updateResponse.text();
      console.error('Error al hacer público el bucket:', body);
      throw new Error('No se pudo marcar el bucket como público.');
    }

    return;
  }

  const createResponse = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      id: SUPABASE_STORAGE_BUCKET,
      name: SUPABASE_STORAGE_BUCKET,
      public: true,
    }),
  });

  if (!createResponse.ok) {
    throw new Error('No se pudo crear el bucket de Storage.');
  }
}

export async function POST(request: Request) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'upload');
  if (limited) return limited;

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Faltan variables de Supabase Storage.' }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No se recibió ninguna imagen.' }, { status: 400 });
    }

    const contentType = file.type.toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: 'Formato no permitido. Subí una imagen WebP, JPG o PNG.' },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json({ error: 'La imagen está vacía.' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'La imagen no puede superar los 5 MB.' }, { status: 400 });
    }

    await ensureBucketExists();

    // El nombre lo generamos nosotros a partir del tipo declarado: nunca usamos la
    // extensión que venga en file.name, así no se puede forzar un .html o un .svg.
    const extension = EXTENSION_BY_TYPE[contentType];
    const safeName = `${Date.now()}-${randomUUID()}.${extension}`;

    const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${safeName}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: Buffer.from(await file.arrayBuffer()),
    });

    if (!uploadResponse.ok) {
      const body = await uploadResponse.text();
      console.error('Error en upload a Supabase Storage:', body);
      return NextResponse.json({ error: 'No se pudo subir la imagen.' }, { status: 500 });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${safeName}`;

    return NextResponse.json({
      url: publicUrl,
    });
  } catch (error) {
    console.error('Error en /api/gestion/upload-product-image:', error);
    return NextResponse.json({ error: 'No se pudo procesar la imagen.' }, { status: 500 });
  }
}