/**
 * Log de eventos de seguridad.
 *
 * Sale por console.warn/error en formato JSON de una línea, que es lo que
 * Vercel indexa y permite filtrar (Project > Logs, buscar `"secEvent"`).
 *
 * Regla importante: acá NUNCA se loguean contraseñas, tokens ni el cuerpo
 * completo de un request. Solo el tipo de evento, la IP, la ruta y datos
 * mínimos para reconstruir qué pasó.
 */

export type SecurityEvent =
  | 'login_fallido'
  | 'login_ok'
  | 'rate_limit'
  | 'token_invalido'
  | 'cron_no_autorizado'
  | 'validacion_rechazada'
  | 'origen_bloqueado'
  | 'upload_rechazado'
  | 'secreto_debil';

type SecurityLogDetails = {
  ip?: string;
  path?: string;
  method?: string;
  reason?: string;
  /** Identificador no sensible (id de pedido o de producto). Nunca lo que tipeó alguien en un login. */
  subject?: string;
};

// Los eventos que indican un ataque en curso van como error para que
// destaquen en el panel de logs; el resto como warning.
const HIGH_SEVERITY: SecurityEvent[] = [
  'rate_limit',
  'cron_no_autorizado',
  'token_invalido',
  'origen_bloqueado',
];

/**
 * Eventos que un atacante puede generar de a miles por minuto (cada 401 con una
 * cookie basura, cada 429, cada intento contra el cron o desde otro origen). Se
 * muestrean: una línea por evento y por cliente cada SECURITY_LOG_SAMPLE_MS, con
 * la cuenta de los que se omitieron (`repetidos`) en la siguiente. Sin esto una
 * ráfaga tapaba en los logs un login_fallido o un login_ok sospechoso.
 *
 * Los de login y el de secreto débil no se muestrean: son pocos (el login tiene
 * su propio rate limit) y cada uno importa.
 */
const SAMPLED_EVENTS: ReadonlySet<SecurityEvent> = new Set<SecurityEvent>([
  'rate_limit',
  'token_invalido',
  'cron_no_autorizado',
  'origen_bloqueado',
]);

export const SECURITY_LOG_SAMPLE_MS = 60_000;

// Tope de clientes recordados: si se pasa (muchas IPs a la vez) se olvidan los
// que hace más que no aparecen. Lo peor que pasa es que esos vuelvan a loguear.
const MAX_SAMPLED_KEYS = 5000;

type SampleState = { loggedAt: number; suppressed: number };

const lastLogged = new Map<string, SampleState>();

/**
 * Cliente al que se le atribuye un request: la IP, salvo en IPv6, donde cada
 * cliente recibe un /64 entero (2^64 direcciones) y contar por dirección exacta
 * le daba a un atacante un cupo nuevo por cada una. Se agrupa por /64; las IPv4
 * (y las IPv4 mapeadas, ::ffff:a.b.c.d) quedan igual.
 *
 * Vive acá porque la usan el muestreo de este log y el rate limit
 * (rateLimitSubject en rate-limit.ts, que importa este módulo).
 */
export function clientSubject(ip: string) {
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

/**
 * Decide si un evento muestreado se escribe. Devuelve cuántos se omitieron desde
 * la última línea de ese cliente, o null si este también se omite.
 */
function takeSample(event: SecurityEvent, ip: string | undefined, now: number): number | null {
  const key = `${event}:${ip ? clientSubject(ip) : '-'}`;
  const previous = lastLogged.get(key);
  // `now >= loggedAt`: si el reloj fue para atrás, se loguea (mejor de más).
  if (previous && now >= previous.loggedAt && now - previous.loggedAt < SECURITY_LOG_SAMPLE_MS) {
    previous.suppressed += 1;
    return null;
  }

  // Se reinserta para que el Map quede ordenado por último log: así, al pasar
  // el tope, se descartan los clientes que hace más que no aparecen.
  lastLogged.delete(key);
  lastLogged.set(key, { loggedAt: now, suppressed: 0 });
  if (lastLogged.size > MAX_SAMPLED_KEYS) {
    const oldest = lastLogged.keys().next().value;
    if (oldest !== undefined) lastLogged.delete(oldest);
  }
  return previous?.suppressed ?? 0;
}

export function logSecurityEvent(event: SecurityEvent, details: SecurityLogDetails = {}) {
  let repeated = 0;
  if (SAMPLED_EVENTS.has(event)) {
    const sample = takeSample(event, details.ip, Date.now());
    if (sample === null) return;
    repeated = sample;
  }

  const entry = JSON.stringify({
    secEvent: event,
    ts: new Date().toISOString(),
    ...details,
    // Cuántos eventos iguales del mismo cliente se omitieron desde la línea anterior.
    ...(repeated > 0 ? { repetidos: repeated } : {}),
  });

  if (HIGH_SEVERITY.includes(event)) {
    console.error(entry);
  } else {
    console.warn(entry);
  }
}

/** Solo para tests: olvida el muestreo para que cada test arranque limpio. */
export function resetSecurityLogSampling() {
  lastLogged.clear();
}
