import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';

const TOKEN_ISSUER = 'el-pampa';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET no está configurado.');
  }
  if (secret.length < 32) {
    throw new Error('JWT_SECRET es demasiado corto: usá al menos 32 caracteres random.');
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

export function verifyAdminAuth(authHeader: string | null) {
  const unauthorized = (message: string) => ({
    ok: false as const,
    response: NextResponse.json({ error: message }, { status: 401 }),
  });

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return unauthorized('No autorizado. Falta el token.');
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return unauthorized('No autorizado. Falta el token.');
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
      return unauthorized('Token inválido.');
    }

    return { ok: true as const };
  } catch {
    return unauthorized('Token inválido o vencido.');
  }
}
