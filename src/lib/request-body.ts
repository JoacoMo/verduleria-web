import { NextResponse } from 'next/server';

/**
 * Lectura del cuerpo de un request con tope de tamaño.
 *
 * `request.text()` / `request.formData()` cargan TODO a memoria antes de que se
 * pueda mirar el largo, y el Content-Length lo manda el cliente: con
 * `Transfer-Encoding: chunked` no viene, y antes se leían megabytes enteros para
 * después responder 413. Acá se lee el stream contando bytes y se corta apenas
 * se pasa del tope, sin leer el resto.
 */

export type LimitedBody =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: 'demasiado_grande' | 'ilegible' };

export async function readBodyLimited(request: Request, maxBytes: number): Promise<LimitedBody> {
  // Si el tamaño declarado ya se pasa, ni se empieza a leer.
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const declaredLength = Number(declared);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, reason: 'demasiado_grande' };
    }
  }

  if (request.bodyUsed) return { ok: false, reason: 'ilegible' };
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Se corta el stream: el resto del cuerpo no se lee ni se guarda.
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'demasiado_grande' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'ilegible' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

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
export const MAX_BODY_BYTES = 100 * 1024;

export async function readJsonBody<T = unknown>(request: Request): Promise<ParsedBody<T>> {
  const body = await readBodyLimited(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return {
      ok: false,
      response: body.reason === 'demasiado_grande'
        ? NextResponse.json({ error: 'El cuerpo del pedido es demasiado grande.' }, { status: 413 })
        : NextResponse.json({ error: 'No se pudo leer el cuerpo del pedido.' }, { status: 400 }),
    };
  }

  try {
    // Igual que request.text(): UTF-8, sin BOM, y las secuencias inválidas como U+FFFD.
    const raw = new TextDecoder().decode(body.bytes);
    return { ok: true, data: JSON.parse(raw) as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'El cuerpo del pedido no es JSON válido.' }, { status: 400 }),
    };
  }
}
