import { NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * El panel no puede leer la cookie (es httpOnly), así que pregunta acá si la
 * sesión sigue vigente antes de mostrarse.
 */
export async function GET(request: Request) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminRead');
  if (limited) return limited;

  return NextResponse.json({ ok: true });
}
