import { logSecurityEvent } from './security-log';

/**
 * Limitador de intentos en memoria.
 *
 * IMPORTANTE: en Vercel cada instancia serverless tiene su propia memoria, así que
 * esto NO es un límite global exacto: si hay varias instancias activas, un atacante
 * podría hacer N veces el límite. Igual sube muchísimo el costo de un ataque de
 * fuerza bruta contra el login y frena el spam de pedidos desde un mismo cliente.
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
 *
 * SOLO es confiable detrás de Vercel, que pisa x-forwarded-for y x-real-ip con
 * la IP real. Si algún día se hostea en otro lado, hay que leer la cabecera que
 * ponga ESE proxy: el primer valor de x-forwarded-for lo puede mandar el cliente.
 */
export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }

  return request.headers.get('x-real-ip')?.trim() || 'desconocida';
}

/**
 * Presets de límite por tipo de endpoint. Se separan para que una ráfaga legítima
 * de lecturas no consuma el cupo de las operaciones que sí importan.
 */
export const RATE_LIMITS = {
  /** Login: lo más sensible, es la única barrera contra fuerza bruta. */
  login: { limit: 8, windowMs: 10 * 60 * 1000 },
  /** Crear pedidos. */
  checkout: { limit: 12, windowMs: 10 * 60 * 1000 },
  /** Lecturas públicas (catálogo, datos del local). */
  publicRead: { limit: 120, windowMs: 60 * 1000 },
  /** Lecturas del panel (pedidos, sesión): el panel refresca seguido. */
  adminRead: { limit: 120, windowMs: 60 * 1000 },
  /** Mutaciones del panel: el dueño no hace más que esto en una sesión normal. */
  adminWrite: { limit: 60, windowMs: 60 * 1000 },
  /** Subida de imágenes: cara en ancho de banda y storage. */
  upload: { limit: 20, windowMs: 10 * 60 * 1000 },
} as const;

export type RateLimitPreset = keyof typeof RATE_LIMITS;

/**
 * Aplica el límite y devuelve una respuesta 429 lista, o null si puede seguir.
 *
 * Uso en un handler:
 *   const limited = enforceRateLimit(request, 'adminWrite');
 *   if (limited) return limited;
 */
/**
 * Clave del límite para una IP. En IPv6 cada cliente recibe un /64 entero
 * (2^64 direcciones): contar por dirección exacta le daba a un atacante un cupo
 * nuevo por cada dirección. Se agrupa por /64; las IPv4 quedan igual.
 */
export function rateLimitSubject(ip: string) {
  if (!ip.includes(':')) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head = '', tail = ''] = ip.toLowerCase().split('::', 2);
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const zeros = Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill('0');
  const groups = [...headParts, ...zeros, ...tailParts].slice(0, 4).map((group) => group.replace(/^0+(?=.)/, ''));
  return `${groups.join(':')}::/64`;
}

export function enforceRateLimit(request: Request, preset: RateLimitPreset, message?: string) {
  const { limit, windowMs } = RATE_LIMITS[preset];
  const ip = getClientIp(request);
  const result = checkRateLimit(`${preset}:${rateLimitSubject(ip)}`, limit, windowMs);

  if (result.ok) return null;

  logSecurityEvent('rate_limit', {
    ip,
    path: new URL(request.url).pathname,
    method: request.method,
    reason: `superó ${limit} req en ${windowMs / 1000}s (${preset})`,
  });

  return tooManyRequestsResponse(
    result.retryAfterSeconds,
    message ?? 'Demasiadas solicitudes. Esperá unos minutos.',
  );
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
