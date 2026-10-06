import { clientSubject, logSecurityEvent } from './security-log';

/**
 * Limitador de intentos en memoria.
 *
 * IMPORTANTE: en Vercel cada instancia serverless tiene su propia memoria, así que
 * esto NO es un límite global exacto: si hay varias instancias activas, un atacante
 * podría hacer N veces el límite. Igual sube muchísimo el costo de un ataque de
 * fuerza bruta contra el login y frena el spam de pedidos desde un mismo cliente.
 * Para los pedidos hay además topes en la base (ORDER_CAPS), que sí son globales.
 *
 * Para un límite real y distribuido hay que apoyarse en algo compartido
 * (Vercel Firewall con rate limiting, o Upstash Redis). Ver README.
 */

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * Un Map recorre en orden de inserción, y cada uso de una clave la vuelve a
 * insertar al final: el principio del Map son siempre las que hace más que no
 * se usan. Eso permite un tope real sin recorrerlo entero en cada request.
 */
const buckets = new Map<string, Bucket>();

// Tope de claves vivas. Por encima, se descartan las que hace más que no se usan.
const MAX_BUCKETS = 5000;
// El barrido de vencidas recorre el Map entero: como mucho una vez cada tanto,
// no en cada request (antes, con más de 5000 claves vivas, cada request lo
// recorría sin liberar nada).
const SWEEP_EVERY_MS = 10_000;
let lastSweepAt = 0;

function pruneBuckets(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;

  if (now - lastSweepAt >= SWEEP_EVERY_MS || now < lastSweepAt) {
    lastSweepAt = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  // Si siguen sobrando (muchos clientes a la vez), se descartan los que hace más
  // que no aparecen. Cuesta lo que sobra, no el tamaño del Map.
  for (const key of buckets.keys()) {
    if (buckets.size <= MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

/** Cuántas claves tiene el limitador en memoria (para tests y diagnóstico). */
export function rateLimitBucketCount() {
  return buckets.size;
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.delete(key);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    pruneBuckets(now);
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  // Al final del Map: es la más recién usada.
  buckets.delete(key);
  buckets.set(key, existing);
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
  /**
   * Intentos de checkout, válidos o no. Generoso a propósito: un cliente que
   * corrige el formulario, o que recibe un 409 de precios o un turno vencido, no
   * puede quedarse sin cupo (y con CGNAT varios clientes comparten la IP).
   */
  checkout: { limit: 30, windowMs: 10 * 60 * 1000 },
  /** Pedidos creados de verdad: se consume justo antes de grabar el pedido. */
  checkoutCreate: { limit: 6, windowMs: 10 * 60 * 1000 },
  /** Lecturas públicas (catálogo, datos del local). */
  publicRead: { limit: 120, windowMs: 60 * 1000 },
  /** Lecturas del panel (pedidos, sesión): el panel refresca seguido. */
  adminRead: { limit: 120, windowMs: 60 * 1000 },
  /** Mutaciones del panel: el dueño no hace más que esto en una sesión normal. */
  adminWrite: { limit: 60, windowMs: 60 * 1000 },
  /** Subida de imágenes: cara en ancho de banda y storage. */
  upload: { limit: 20, windowMs: 10 * 60 * 1000 },
  /** Cron de limpieza: Vercel lo llama una vez por día; más que esto es alguien probando el secreto. */
  cron: { limit: 10, windowMs: 10 * 60 * 1000 },
} as const;

/**
 * Topes de pedidos que se cuentan en la base (POST /api/checkout). A diferencia
 * del rate limit en memoria, sobreviven a los cold starts y valen para todas
 * las instancias y todas las IPs.
 */
export const ORDER_CAPS = {
  /** Pedidos no cancelados de un mismo teléfono en 24 h. */
  perPhone: { limit: 5, windowMs: 24 * 60 * 60 * 1000 },
  /** Pedidos de toda la tienda en la última hora: por encima, es un ataque. */
  global: { limit: 150, windowMs: 60 * 60 * 1000 },
} as const;

export type RateLimitPreset = keyof typeof RATE_LIMITS;

/**
 * Clave del límite para una IP. En IPv6 cada cliente recibe un /64 entero
 * (2^64 direcciones): contar por dirección exacta le daba a un atacante un cupo
 * nuevo por cada dirección. Se agrupa por /64; las IPv4 quedan igual.
 */
export function rateLimitSubject(ip: string) {
  return clientSubject(ip);
}

/**
 * Aplica el límite y devuelve una respuesta 429 lista, o null si puede seguir.
 *
 * Uso en un handler:
 *   const limited = enforceRateLimit(request, 'adminWrite');
 *   if (limited) return limited;
 *
 * El evento de seguridad del 429 se muestrea (ver security-log.ts): una ráfaga
 * deja una línea por minuto y por cliente, no una por request.
 */
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
