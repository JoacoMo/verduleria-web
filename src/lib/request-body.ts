import { NextResponse } from 'next/server';

/**
 * Lee el cuerpo JSON de un request sin que un body roto termine en un 500.
 *
 * `request.json()` tira si el JSON está mal formado; si eso se mezcla con el
 * try/catch general del handler, un payload inválido se reporta como error del
 * servidor. Es ruido en los logs y le dice al que prueba que rompió algo.
 */
export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

// Tope de tamaño: nada de lo que recibe esta app necesita más que esto, y evita
// que alguien mande megabytes de JSON solo para hacernos gastar memoria y CPU.
const MAX_BODY_BYTES = 100 * 1024;

export async function readJsonBody<T = unknown>(request: Request): Promise<ParsedBody<T>> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'El cuerpo del pedido es demasiado grande.' }, { status: 413 }),
    };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'No se pudo leer el cuerpo del pedido.' }, { status: 400 }),
    };
  }

  if (raw.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'El cuerpo del pedido es demasiado grande.' }, { status: 413 }),
    };
  }

  try {
    return { ok: true, data: JSON.parse(raw) as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'El cuerpo del pedido no es JSON válido.' }, { status: 400 }),
    };
  }
}
