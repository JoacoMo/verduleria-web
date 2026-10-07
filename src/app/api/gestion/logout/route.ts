import { NextResponse } from 'next/server';
import { clearAdminSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

/** Cierra la sesión del panel borrando la cookie. No requiere sesión válida. */
export async function POST() {
  return clearAdminSessionCookie(NextResponse.json({ ok: true }));
}
