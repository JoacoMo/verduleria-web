import { NextResponse } from 'next/server';
import { createAdminToken } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ token: createAdminToken() });
    }

    return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
  } catch (error) {
    console.error('Error en POST /api/admin/login:', error);
    return NextResponse.json({ error: 'No se pudo iniciar sesión.' }, { status: 500 });
  }
}