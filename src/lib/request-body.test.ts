import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, readBodyLimited, readJsonBody } from './request-body';

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', { method: 'POST', body, headers });

async function failure(result: Awaited<ReturnType<typeof readJsonBody>>) {
  if (result.ok) throw new Error('Se esperaba un error');
  return { status: result.response.status, body: (await result.response.json()) as { error: string } };
}

describe('readJsonBody', () => {
  it('JSON válido (incluso null, número o lista)', async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ ok: true, data: { a: 1 } });
    expect(await readJsonBody(post('null'))).toEqual({ ok: true, data: null });
    expect(await readJsonBody(post('[1,2]'))).toEqual({ ok: true, data: [1, 2] });
  });

  it('JSON roto o vacío → 400 (no 500)', async () => {
    for (const body of ['{"a":', 'hola', '', '{a:1}']) {
      expect(await failure(await readJsonBody(post(body)))).toEqual({ status: 400, body: { error: 'El cuerpo del pedido no es JSON válido.' } });
    }
  });

  it('content-length declarado por encima de 100 KB → 413 sin leer el cuerpo', async () => {
    const result = await readJsonBody(post('{}', { 'content-length': String(100 * 1024 + 1) }));
    expect(await failure(result)).toEqual({ status: 413, body: { error: 'El cuerpo del pedido es demasiado grande.' } });
  });

  it('cuerpo real de más de 100 KB → 413', async () => {
    const big = JSON.stringify({ notes: 'x'.repeat(100 * 1024) });
    expect((await failure(await readJsonBody(post(big)))).status).toBe(413);
  });

  it('justo 100 KB entra', async () => {
    const exact = `"${'x'.repeat(100 * 1024 - 2)}"`;
    expect((await readJsonBody(post(exact))).ok).toBe(true);
  });
});

/**
 * Cuerpo "chunked" (sin Content-Length) que se genera a medida que se lee:
 * cuenta cuántos bytes se llegaron a pedir, para comprobar que el servidor
 * corta el stream en vez de leerlo entero.
 */
function chunkedRequest(totalBytes: number, chunkBytes = 16 * 1024) {
  let produced = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - produced);
      produced += size;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('http://localhost/api/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  return { request, produced: () => produced, cancelled: () => cancelled };
}

describe('readJsonBody: cuerpos sin Content-Length (Transfer-Encoding: chunked)', () => {
  // Era un bug: sin Content-Length se leía el cuerpo entero (5 MB) y recién
  // después se respondía 413.
  it('10 MB en chunks → 413 sin leerlo entero: corta apenas pasa los 100 KB', async () => {
    const body = chunkedRequest(10 * 1024 * 1024);
    expect(body.request.headers.get('content-length')).toBeNull();
    const result = await readJsonBody(body.request);
    expect(await failure(result)).toEqual({ status: 413, body: { error: 'El cuerpo del pedido es demasiado grande.' } });
    expect(body.produced()).toBeLessThanOrEqual(MAX_BODY_BYTES + 2 * 16 * 1024);
    expect(body.cancelled()).toBe(true);
  });

  it('un cuerpo chico en chunks se lee y se parsea', async () => {
    const encoder = new TextEncoder();
    const parts = ['{"nombre":"Ñandú', ' 🍅","n":', '1}'];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    });
    const request = new Request('http://localhost/api/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await readJsonBody(request)).toEqual({ ok: true, data: { nombre: 'Ñandú 🍅', n: 1 } });
  });

  it('el tope es en bytes, no en caracteres: 60.000 "ñ" son 120.000 bytes → 413', async () => {
    const result = await readJsonBody(post(`"${'ñ'.repeat(60_000)}"`));
    expect((await failure(result)).status).toBe(413);
  });

  it('sin cuerpo → JSON inválido (400), no 500', async () => {
    const result = await readJsonBody(new Request('http://localhost/api/x', { method: 'POST' }));
    expect((await failure(result)).status).toBe(400);
  });

  it('un cuerpo ya leído → 400 "no se pudo leer"', async () => {
    const request = post('{}');
    await request.text();
    expect(await failure(await readJsonBody(request))).toEqual({ status: 400, body: { error: 'No se pudo leer el cuerpo del pedido.' } });
  });

  it('un stream que se corta a la mitad → 400 "no se pudo leer"', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
        controller.error(new Error('conexión cortada'));
      },
    });
    const request = new Request('http://localhost/api/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await failure(await readJsonBody(request))).toEqual({ status: 400, body: { error: 'No se pudo leer el cuerpo del pedido.' } });
  });
});

describe('readBodyLimited', () => {
  it('devuelve los bytes tal cual (binario)', async () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const result = await readBodyLimited(new Request('http://localhost/x', { method: 'POST', body: data }), 10);
    expect(result.ok && Array.from(result.bytes)).toEqual(Array.from(data));
  });

  it('justo el tope entra; un byte más, no', async () => {
    expect((await readBodyLimited(chunkedRequest(1000, 100).request, 1000)).ok).toBe(true);
    expect(await readBodyLimited(chunkedRequest(1001, 100).request, 1000)).toEqual({ ok: false, reason: 'demasiado_grande' });
  });

  it('Content-Length declarado de más → corta sin leer', async () => {
    const body = chunkedRequest(10);
    const request = new Request(body.request, { headers: { 'content-length': '5000' } });
    expect(await readBodyLimited(request, 1000)).toEqual({ ok: false, reason: 'demasiado_grande' });
    expect(body.produced()).toBeLessThanOrEqual(10);
  });
});
