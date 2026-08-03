import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET no está configurado.');
  }
  return secret;
}

export function createAdminToken() {
  return jwt.sign({ role: 'admin' }, getJwtSecret(), { expiresIn: '12h' });
}

export function verifyAdminAuth(authHeader: string | null) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'No autorizado. Falta el token.' }, { status: 401 }),
    };
  }

  const token = authHeader.split(' ')[1];

  try {
    jwt.verify(token, getJwtSecret());
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Token inválido o vencido.' }, { status: 401 }),
    };
  }
}