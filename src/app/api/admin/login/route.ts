import { NextResponse } from 'next/server';
import { createAdminToken, safeCompare } from '@/lib/auth';
import { checkRateLimit, getClientIp, resetRateLimit, tooManyRequestsResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// 8 intentos cada 10 minutos por IP. Suficiente para equivocarse tipeando,
// muy poco para probar contraseñas a lo bruto.
const LOGIN_ATTEMPT_LIMIT = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  const rateLimitKey = `login:${getClientIp(request)}`;
  const rateLimit = checkRateLimit(rateLimitKey, LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);

  if (!rateLimit.ok) {
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

    const { username, password } = await request.json();

    if (typeof username !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
    }

    // Se evalúan siempre las dos comparaciones (sin cortocircuito) para que el
    // tiempo de respuesta no revele si lo que falló fue el usuario o la contraseña.
    const usernameOk = safeCompare(username, adminUsername);
    const passwordOk = safeCompare(password, adminPassword);

    if (!usernameOk || !passwordOk) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
    }

    // Un login correcto no debería consumir el cupo de intentos.
    resetRateLimit(rateLimitKey);

    return NextResponse.json({ token: createAdminToken() });
  } catch (error) {
    console.error('Error en POST /api/admin/login:', error);
    return NextResponse.json({ error: 'No se pudo iniciar sesión.' }, { status: 500 });
  }
}
