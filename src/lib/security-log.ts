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
  /** Identificador no sensible (id de pedido/producto, nombre de usuario probado). */
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

export function logSecurityEvent(event: SecurityEvent, details: SecurityLogDetails = {}) {
  const entry = JSON.stringify({
    secEvent: event,
    ts: new Date().toISOString(),
    ...details,
  });

  if (HIGH_SEVERITY.includes(event)) {
    console.error(entry);
  } else {
    console.warn(entry);
  }
}
