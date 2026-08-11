/**
 * Limitador de intentos en memoria.
 *
 * IMPORTANTE: en Vercel cada instancia serverless tiene su propia memoria, así que
 * esto NO es un límite global exacto: si hay varias instancias activas, un atacante
 * podría hacer N veces el límite. Igual sube muchísimo el costo de un ataque de
 * fuerza bruta contra el login (que hoy no tiene ninguna barrera) y frena el spam
 * de pedidos desde un mismo cliente.
 *
 * Para un límite real y distribuido hay que apoyarse en algo compartido
 * (Vercel Firewall con rate limiting, o Upstash Redis). Ver README.
 */

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

// Evita que el Map crezca sin control si el proceso vive mucho tiempo.
const MAX_BUCKETS = 5000;

function cleanupExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) {
    cleanupExpired(now);
  }

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  if (existing.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { ok: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/**
 * Marca un intento como exitoso para que no siga contando contra el límite
 * (por ejemplo, un login correcto no debería gastar intentos).
 */
export function resetRateLimit(key: string) {
  buckets.delete(key);
}

/**
 * IP del cliente según las cabeceras que setea el proxy de Vercel.
 * Se toma el primer valor de x-forwarded-for, que es el cliente real.
 */
export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }

  return request.headers.get('x-real-ip')?.trim() || 'desconocida';
}

export function tooManyRequestsResponse(retryAfterSeconds: number, message: string) {
  return Response.json(
    { error: message },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    },
  );
}
