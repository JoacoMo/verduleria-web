import { describe, expect, it } from 'vitest';
import { readJsonBody } from './request-body';

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
