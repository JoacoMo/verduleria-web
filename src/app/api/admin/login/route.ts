import { NextResponse } from 'next/server';
import { createAdminToken, safeCompare } from '@/lib/auth';
import { RATE_LIMITS, checkRateLimit, getClientIp, resetRateLimit, tooManyRequestsResponse } from '@/lib/rate-limit';
import { logSecurityEvent } from '@/lib/security-log';
import { sanitizeText } from '@/lib/sanitize';
import { readJsonBody } from '@/lib/request-body';

export const runtime = 'nodejs';

// Tope de largo antes de tocar nada: no tiene sentido hashear un "usuario"
// de 10 MB que alguien mandó para hacernos gastar CPU.
const MAX_CREDENTIAL_LENGTH = 200;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimitKey = `login:${ip}`;
  const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs);

  if (!rateLimit.ok) {
    logSecurityEvent('rate_limit', {
      ip,
      path: '/api/admin/login',
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

    if (!adminUsername || !adminPassword) {
      console.error('Error en POST /api/admin/login: faltan ADMIN_USERNAME o ADMIN_PASSWORD.');
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
      // Se registra el usuario probado (no la contraseña) para poder distinguir
      // un tipeo del dueño de alguien barriendo nombres de usuario.
      logSecurityEvent('login_fallido', {
        ip,
        path: '/api/admin/login',
        method: 'POST',
        subject: username.slice(0, 40),
      });
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
    }

    // Un login correcto no debería consumir el cupo de intentos.
    resetRateLimit(rateLimitKey);
    logSecurityEvent('login_ok', { ip, path: '/api/admin/login', method: 'POST' });

    return NextResponse.json({ token: createAdminToken() });
  } catch (error) {
    console.error('Error en POST /api/admin/login:', error);
    return NextResponse.json({ error: 'No se pudo iniciar sesión.' }, { status: 500 });
  }
}
