import { NextResponse } from 'next/server';
import { isExampleSecret, safeCompare, setAdminSessionCookie } from '@/lib/auth';
import { RATE_LIMITS, checkRateLimit, getClientIp, rateLimitSubject, resetRateLimit, tooManyRequestsResponse } from '@/lib/rate-limit';
import { logSecurityEvent } from '@/lib/security-log';
import { sanitizeText } from '@/lib/sanitize';
import { readJsonBody } from '@/lib/request-body';

export const runtime = 'nodejs';

// Tope de largo antes de tocar nada: no tiene sentido hashear un "usuario"
// de 10 MB que alguien mandó para hacernos gastar CPU.
const MAX_CREDENTIAL_LENGTH = 200;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimitKey = `login:${rateLimitSubject(ip)}`;
  const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs);

  if (!rateLimit.ok) {
    logSecurityEvent('rate_limit', {
      ip,
      path: '/api/gestion/login',
      method: 'POST',
      reason: 'demasiados intentos de login',
    });
    return tooManyRequestsResponse(
      rateLimit.retryAfterSeconds,
      'Demasiados intentos fallidos. Esperá unos minutos y probá de nuevo.',
    );
  }

  try {
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword || isExampleSecret(adminPassword)) {
      console.error('Error en POST /api/gestion/login: faltan ADMIN_USERNAME o ADMIN_PASSWORD.');
      return NextResponse.json({ error: 'No se pudo iniciar sesión.' }, { status: 500 });
    }

    const parsed = await readJsonBody<{ username?: unknown; password?: unknown }>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // El usuario se limpia (control chars, invisibles, largo) antes de compararlo.
    // La contraseña NO se toca más allá del tope de largo: recortarla o normalizarla
    // cambiaría el valor que el dueño realmente tipeó.
    const username = sanitizeText(body?.username, { maxLength: MAX_CREDENTIAL_LENGTH, singleLine: true });
    const password = typeof body?.password === 'string' ? body.password : null;

    if (username === null || password === null || password.length > MAX_CREDENTIAL_LENGTH) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
    }

    // Se evalúan siempre las dos comparaciones (sin cortocircuito) para que el
    // tiempo de respuesta no revele si lo que falló fue el usuario o la contraseña.
    const usernameOk = safeCompare(username, adminUsername);
    const passwordOk = safeCompare(password, adminPassword);

    if (!usernameOk || !passwordOk) {
      // Nunca el texto tipeado: si el dueño escribe la contraseña en el campo
      // usuario (pasa con el autocompletado del celular) quedaría en los logs de
      // Vercel. Alcanza con saber qué falló.
      logSecurityEvent('login_fallido', {
        ip,
        path: '/api/gestion/login',
        method: 'POST',
        reason: usernameOk ? 'contraseña incorrecta' : 'usuario incorrecto',
      });
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
    }

    // Un login correcto no debería consumir el cupo de intentos.
    resetRateLimit(rateLimitKey);
    logSecurityEvent('login_ok', { ip, path: '/api/gestion/login', method: 'POST' });

    // El token va en una cookie httpOnly: el JavaScript del panel nunca lo ve.
    return setAdminSessionCookie(NextResponse.json({ ok: true }));
  } catch (error) {
    console.error('Error en POST /api/gestion/login:', error);
    return NextResponse.json({ error: 'No se pudo iniciar sesión.' }, { status: 500 });
  }
}
