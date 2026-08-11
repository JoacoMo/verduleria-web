import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';
import { logSecurityEvent } from './security-log';

const TOKEN_ISSUER = 'el-pampa';

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
  return jwt.sign({ role: 'admin' }, getJwtSecret(), {
    expiresIn: '12h',
    issuer: TOKEN_ISSUER,
  });
}

export function verifyAdminAuth(authHeader: string | null, context?: { ip?: string; path?: string }) {
  const unauthorized = (message: string, reason: string) => {
    // Un token presente pero inválido es señal de que alguien está probando,
    // no de que el dueño se quedó sin sesión: se registra aparte.
    if (authHeader) {
      logSecurityEvent('token_invalido', { ...context, reason });
    }
    return {
      ok: false as const,
      response: NextResponse.json({ error: message }, { status: 401 }),
    };
  };

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return unauthorized('No autorizado. Falta el token.', 'cabecera Authorization ausente o mal formada');
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return unauthorized('No autorizado. Falta el token.', 'token vacío');
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      issuer: TOKEN_ISSUER,
      // Fijamos el algoritmo para descartar tokens firmados con otro (por ejemplo "none").
      algorithms: ['HS256'],
    });

    // Verificamos el claim de rol explícitamente: que el token esté bien firmado
    // no alcanza, tiene que ser además un token de admin.
    if (typeof payload !== 'object' || payload === null || payload.role !== 'admin') {
      return unauthorized('Token inválido.', 'token bien firmado pero sin role=admin');
    }

    return { ok: true as const };
  } catch {
    // El mensaje al cliente es genérico a propósito: no le decimos si el token
    // está vencido, mal firmado o es de otro emisor.
    return unauthorized('Token inválido o vencido.', 'firma inválida, vencido o emisor incorrecto');
  }
}
