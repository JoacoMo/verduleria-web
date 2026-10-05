import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';
import { logSecurityEvent } from './security-log';
import { getClientIp } from './rate-limit';

/**
 * Sesión del panel de administración.
 *
 * El token viaja en una cookie httpOnly + Secure + SameSite=Strict, no en
 * localStorage: así ningún JavaScript de la página (ni uno inyectado) lo puede
 * leer, y el navegador no lo manda en requests que vienen de otro sitio (CSRF).
 * La cookie solo se envía a /api/gestion, que es lo único que la necesita.
 *
 * Revocación: el token lleva la versión de ADMIN_TOKEN_VERSION. Si se cambia esa
 * variable en Vercel (por ejemplo, después de cambiar la contraseña o perder el
 * celular), todos los tokens ya emitidos dejan de valer al instante, sin tener
 * que rotar JWT_SECRET.
 */
const TOKEN_ISSUER = 'el-pampa';
export const ADMIN_COOKIE_NAME = 'elpampa_admin';
const ADMIN_COOKIE_PATH = '/api/gestion';
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

const MIN_SECRET_LENGTH = 32;
let shortSecretWarned = false;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET no está configurado.');
  }

  // Un secreto corto es más fácil de romper por fuerza bruta, pero cortar el
  // login acá dejaría al dueño afuera del panel sin manera de entrar. Se avisa
  // una sola vez por instancia y se sigue: la solución es rotar el secreto.
  if (secret.length < MIN_SECRET_LENGTH && !shortSecretWarned) {
    shortSecretWarned = true;
    logSecurityEvent('secreto_debil', {
      reason: `JWT_SECRET tiene ${secret.length} caracteres; se recomiendan al menos ${MIN_SECRET_LENGTH}`,
    });
  }

  return secret;
}

function getTokenVersion() {
  return process.env.ADMIN_TOKEN_VERSION || '1';
}

/**
 * Comparación de strings en tiempo constante, para no filtrar por diferencia de
 * tiempo cuántos caracteres del usuario/contraseña coinciden.
 */
export function safeCompare(a: string, b: string) {
  // Comparamos los digest SHA-256 en vez de los strings crudos: así ambos buffers
  // miden siempre 32 bytes, timingSafeEqual nunca explota por diferencia de largo
  // y tampoco se filtra el largo real del valor esperado.
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();

  return timingSafeEqual(digestA, digestB);
}

export function createAdminToken() {
  return jwt.sign({ role: 'admin', v: getTokenVersion() }, getJwtSecret(), {
    expiresIn: ADMIN_SESSION_SECONDS,
    issuer: TOKEN_ISSUER,
    algorithm: 'HS256',
  });
}

function cookieAttributes(maxAgeSeconds: number) {
  // En desarrollo (http://localhost) una cookie Secure no se guardaría.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=${ADMIN_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

/** Agrega a la respuesta la cookie de sesión con un token nuevo. */
export function setAdminSessionCookie(response: NextResponse) {
  response.headers.append('Set-Cookie', `${ADMIN_COOKIE_NAME}=${createAdminToken()}; ${cookieAttributes(ADMIN_SESSION_SECONDS)}`);
  return response;
}

/** Borra la cookie de sesión (cerrar sesión). */
export function clearAdminSessionCookie(response: NextResponse) {
  response.headers.append('Set-Cookie', `${ADMIN_COOKIE_NAME}=; ${cookieAttributes(0)}`);
  return response;
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const chunk of header.split(';')) {
    const separator = chunk.indexOf('=');
    if (separator === -1) continue;
    if (chunk.slice(0, separator).trim() === name) {
      return chunk.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * Verifica la sesión del panel. Uso al principio de cada handler de /api/gestion:
 *
 *   const auth = verifyAdminAuth(request);
 *   if (!auth.ok) return auth.response;
 */
export function verifyAdminAuth(request: Request): AdminAuthResult {
  const path = new URL(request.url).pathname;
  const token = readCookie(request, ADMIN_COOKIE_NAME);

  const unauthorized = (message: string, reason: string) => {
    // Un token presente pero inválido es señal de que alguien está probando,
    // no de que el dueño se quedó sin sesión: se registra aparte.
    if (token) {
      logSecurityEvent('token_invalido', { ip: getClientIp(request), path, method: request.method, reason });
    }
    return {
      ok: false as const,
      response: NextResponse.json({ error: message }, { status: 401 }),
    };
  };

  if (!token) {
    return unauthorized('No autorizado. Iniciá sesión.', 'sin cookie de sesión');
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      issuer: TOKEN_ISSUER,
      // Fijamos el algoritmo para descartar tokens firmados con otro (por ejemplo "none").
      algorithms: ['HS256'],
    });

    // Que el token esté bien firmado no alcanza: tiene que ser de admin y de la
    // versión vigente (si no, es un token revocado).
    if (typeof payload !== 'object' || payload === null || payload.role !== 'admin') {
      return unauthorized('Sesión inválida.', 'token bien firmado pero sin role=admin');
    }
    if (payload.v !== getTokenVersion()) {
      return unauthorized('Tu sesión se cerró. Volvé a iniciar sesión.', 'token de una versión revocada');
    }

    return { ok: true as const };
  } catch {
    // El mensaje al cliente es genérico a propósito: no le decimos si el token
    // está vencido, mal firmado o es de otro emisor.
    return unauthorized('Sesión vencida. Volvé a iniciar sesión.', 'firma inválida, vencido o emisor incorrecto');
  }
}
