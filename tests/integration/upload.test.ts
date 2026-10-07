import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminCookie, apiRequest, readJson } from './helpers';

/**
 * Subida de imágenes. Supabase Storage se simula con un fetch global falso:
 * acá se prueba qué se le pide a Storage y qué se rechaza antes de pedirle nada.
 *
 * El handler memoiza "el bucket ya existe" a nivel módulo, así que cada test
 * importa una copia nueva del módulo (vi.resetModules).
 *
 * No usa la base: corre aunque no haya TEST_DATABASE_URL.
 */
const SUPABASE = 'https://supabase.test';
const SERVICE_KEY = 'service-role-de-tests';
const BUCKET_URL = `${SUPABASE}/storage/v1/bucket/product-images`;
const OBJECT_PREFIX = `${SUPABASE}/storage/v1/object/product-images/`;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)));

function bytes(header: number[], size = 64): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size);
  data.set(header);
  return data;
}

/** Bytes de un texto (para colar HTML/SVG/GIF disfrazados de imagen). */
const text = (value: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(value));

type FetchCall = { url: string; init: RequestInit };
type FakeReply = { status: number; body?: string };

let calls: FetchCall[] = [];

/** fetch falso: responde en orden lo que se le pase (por defecto, 200). */
function mockStorage(...replies: FakeReply[]) {
  calls = [];
  const queue = [...replies];
  const fake = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const reply = queue.shift() ?? { status: 200, body: '{}' };
    return new Response(reply.body ?? '{}', { status: reply.status });
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/gestion/upload-product-image/route');
}

function uploadRequest(file: File | string | null, options: { headers?: Record<string, string>; rawBody?: BodyInit } = {}) {
  let body: BodyInit;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else {
    const form = new FormData();
    if (file !== null) form.append('file', file);
    body = form;
  }
  return apiRequest('/api/gestion/upload-product-image', { method: 'POST', rawBody: body, cookie: adminCookie(), headers: options.headers });
}

const file = (data: Uint8Array<ArrayBuffer>, type: string, name = 'foto') => new File([data], name, { type });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('POST /api/gestion/upload-product-image: subidas válidas', () => {
  it.each([
    ['image/png', PNG, 'png'],
    ['image/jpeg', JPEG, 'jpg'],
    ['image/webp', WEBP, 'webp'],
  ])('%s: verifica el bucket una vez, sube con el tipo real y devuelve la URL pública', async (type, header, extension) => {
    const { POST } = await loadRoute();
    mockStorage({ status: 200 }, { status: 200 });
    const data = bytes(header);
    const response = await POST(uploadRequest(file(data, type, 'foto.html')));
    expect(response.status).toBe(200);
    const { url } = await readJson<{ url: string }>(response);
    expect(url).toMatch(new RegExp(`^${SUPABASE}/storage/v1/object/public/product-images/\\d+-[0-9a-f-]{36}\\.${extension}$`));

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ url: BUCKET_URL, init: { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } } });
    expect(calls[1].url.startsWith(OBJECT_PREFIX)).toBe(true);
    // El nombre lo pone el servidor (nunca el .html que mandó el cliente).
    expect(calls[1].url.endsWith(`.${extension}`)).toBe(true);
    expect(calls[1].init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': type, 'x-upsert': 'false', 'cache-control': 'max-age=31536000', apikey: SERVICE_KEY },
    });
    expect(Array.from(calls[1].init.body as Uint8Array)).toEqual(Array.from(data));
  });

  it('la segunda subida de la misma instancia no vuelve a verificar el bucket', async () => {
    const { POST } = await loadRoute();
    mockStorage({ status: 200 }, { status: 200 }, { status: 200 });
    expect((await POST(uploadRequest(file(bytes(PNG), 'image/png')))).status).toBe(200);
    expect((await POST(uploadRequest(file(bytes(PNG), 'image/png')))).status).toBe(200);
    expect(calls.map((call) => (call.url === BUCKET_URL ? 'bucket' : 'objeto'))).toEqual(['bucket', 'objeto', 'objeto']);
  });

  it('si el bucket no existe lo crea público, con tope de tamaño y tipos permitidos', async () => {
    const { POST } = await loadRoute();
    mockStorage({ status: 404, body: '{"error":"Bucket not found"}' }, { status: 200 }, { status: 200 });
    const response = await POST(uploadRequest(file(bytes(PNG), 'image/png')));
    expect(response.status).toBe(200);
    expect(calls[1].url).toBe(`${SUPABASE}/storage/v1/bucket`);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      id: 'product-images',
      name: 'product-images',
      public: true,
      file_size_limit: 4 * 1024 * 1024,
      allowed_mime_types: ['image/webp', 'image/jpeg', 'image/png'],
    });
  });

  it('si otra instancia creó el bucket al mismo tiempo (409), sigue', async () => {
    const { POST } = await loadRoute();
    mockStorage({ status: 400, body: '{"statusCode":"404","error":"not_found"}' }, { status: 409, body: 'already exists' }, { status: 200 });
    expect((await POST(uploadRequest(file(bytes(PNG), 'image/png')))).status).toBe(200);
  });
});

describe('POST /api/gestion/upload-product-image: rechazos antes de llegar a Storage', () => {
  it.each([
    ['PNG declarado como JPEG', bytes(PNG), 'image/jpeg'],
    ['HTML declarado como PNG', text('<!doctype html><script>alert(1)</script>'), 'image/png'],
    ['SVG declarado como WebP', text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/webp'],
    ['GIF declarado como PNG', text('GIF89a......'), 'image/png'],
  ])('%s → 400 por magic bytes y evento de seguridad', async (_case, data, type) => {
    const { POST } = await loadRoute();
    const fake = mockStorage();
    const response = await POST(uploadRequest(file(data, type)));
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: 'El archivo no es una imagen WebP, JPG o PNG válida (o no coincide con su extensión).' });
    expect(fake).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.warn).mock.calls.at(-1)?.[0])).toContain('"secEvent":"upload_rechazado"');
  });

  it('tipos no permitidos (svg, gif, html) → 400 sin mirar el contenido', async () => {
    const { POST } = await loadRoute();
    const fake = mockStorage();
    for (const type of ['image/svg+xml', 'image/gif', 'text/html', '']) {
      const response = await POST(uploadRequest(file(bytes(PNG), type)));
      expect(response.status, type).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Formato no permitido. Subí una imagen WebP, JPG o PNG.' });
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('archivo vacío, sin archivo, campo de texto o body que no es multipart → 400', async () => {
    const { POST } = await loadRoute();
    const fake = mockStorage();
    expect(await readJson(await POST(uploadRequest(file(new Uint8Array(0), 'image/png'))))).toEqual({ error: 'La imagen está vacía.' });
    expect(await readJson(await POST(uploadRequest(null)))).toEqual({ error: 'No se recibió ninguna imagen.' });
    expect(await readJson(await POST(uploadRequest('no soy un archivo')))).toEqual({ error: 'No se recibió ninguna imagen.' });
    const notMultipart = await POST(uploadRequest(null, { rawBody: '{"file":"x"}', headers: { 'content-type': 'application/json' } }));
    expect(notMultipart.status).toBe(400);
    expect(await readJson(notMultipart)).toEqual({ error: 'No se pudo leer la imagen enviada.' });
    expect(fake).not.toHaveBeenCalled();
  });

  // 4 MB y no 5: Vercel corta los cuerpos de más de 4,5 MB con su propio 413.
  it('más de 4 MB → 413 (por tamaño real del archivo, por el cuerpo y por Content-Length declarado)', async () => {
    const { POST } = await loadRoute();
    const fake = mockStorage();
    const justOver = await POST(uploadRequest(file(bytes(PNG, 4 * 1024 * 1024 + 1), 'image/png')));
    expect(justOver.status).toBe(413);
    expect(await readJson(justOver)).toEqual({ error: 'La imagen no puede superar los 4 MB.' });

    const big = await POST(uploadRequest(file(bytes(PNG, 5 * 1024 * 1024), 'image/png')));
    expect(big.status).toBe(413);
    expect(await readJson(big)).toEqual({ error: 'La imagen no puede superar los 4 MB.' });

    const declared = await POST(uploadRequest(file(bytes(PNG), 'image/png'), { headers: { 'content-length': String(6 * 1024 * 1024) } }));
    expect(declared.status).toBe(413);
    expect(fake).not.toHaveBeenCalled();
  });

  it('justo 4 MB entra', async () => {
    const { POST } = await loadRoute();
    mockStorage({ status: 200 }, { status: 200 });
    expect((await POST(uploadRequest(file(bytes(PNG, 4 * 1024 * 1024), 'image/png')))).status).toBe(200);
  });

  // Era un bug: sin Content-Length, formData() leía el cuerpo entero a memoria.
  it('cuerpo chunked (sin Content-Length) de 20 MB → 413 sin leerlo entero', async () => {
    const { POST } = await loadRoute();
    const fake = mockStorage();
    const CHUNK = 64 * 1024;
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= 20 * 1024 * 1024) {
          controller.close();
          return;
        }
        produced += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK));
      },
    });
    const request = new Request('http://localhost/api/gestion/upload-product-image', {
      method: 'POST',
      headers: { cookie: adminCookie(), 'content-type': 'multipart/form-data; boundary=x', 'x-forwarded-for': '10.250.0.1' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(produced).toBeLessThanOrEqual(4 * 1024 * 1024 + 64 * 1024 + 2 * CHUNK);
    expect(fake).not.toHaveBeenCalled();
  });

  it('una imagen chica sin Content-Length (chunked) se lee igual', async () => {
    const { POST } = await loadRoute();
    mockStorage({ status: 200 }, { status: 200 });
    // El multipart serializado por el propio Request, pasado como stream sin largo.
    const multipart = uploadRequest(file(bytes(PNG), 'image/png'));
    const request = new Request(multipart.url, {
      method: 'POST',
      headers: { cookie: adminCookie(), 'content-type': multipart.headers.get('content-type') ?? '', 'x-forwarded-for': '10.250.0.2' },
      body: multipart.body,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    expect((await POST(request)).status).toBe(200);
  });
});

describe('POST /api/gestion/upload-product-image: errores de Storage y configuración', () => {
  it('Storage responde error → 500 genérico (sin filtrar el detalle)', async () => {
    const { POST } = await loadRoute();
    mockStorage({ status: 200 }, { status: 500, body: 'detalle interno de supabase' });
    const response = await POST(uploadRequest(file(bytes(PNG), 'image/png')));
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: 'No se pudo subir la imagen.' });
  });

  it('si el bucket se borró después de verificarlo, avisa y la próxima subida lo vuelve a verificar', async () => {
    const { POST } = await loadRoute();
    mockStorage({ status: 200 }, { status: 404, body: 'Bucket not found' }, { status: 200 }, { status: 200 });
    const first = await POST(uploadRequest(file(bytes(PNG), 'image/png')));
    expect(first.status).toBe(500);
    expect((await readJson<{ error: string }>(first)).error).toMatch(/^No existe el bucket de imágenes "product-images"/);
    expect((await POST(uploadRequest(file(bytes(PNG), 'image/png')))).status).toBe(200);
    expect(calls.map((call) => (call.url === BUCKET_URL ? 'bucket' : 'objeto'))).toEqual(['bucket', 'objeto', 'bucket', 'objeto']);
  });

  it('error al verificar el bucket (no es "no existe") → 500 y se reintenta en la próxima', async () => {
    const { POST } = await loadRoute();
    mockStorage({ status: 401, body: 'invalid key' }, { status: 200 }, { status: 200 });
    expect((await POST(uploadRequest(file(bytes(PNG), 'image/png')))).status).toBe(500);
    expect((await POST(uploadRequest(file(bytes(PNG), 'image/png')))).status).toBe(200);
  });

  it('sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → 500 "no está configurada"', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { POST } = await loadRoute();
    const fake = mockStorage();
    const response = await POST(uploadRequest(file(bytes(PNG), 'image/png')));
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: 'La subida de imágenes no está configurada.' });
    expect(fake).not.toHaveBeenCalled();
  });
});
