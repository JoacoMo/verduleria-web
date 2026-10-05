import { NextResponse } from 'next/server';
import { getPublicStoreInfo } from '@/lib/site';
import { enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Datos públicos del local (los mismos que la tienda recibe por props). Antes
 * se devolvía siteConfig entero; ahora pasa solo lo que define StoreInfo, así
 * una variable nueva en siteConfig no se publica sin querer.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, 'publicRead');
  if (limited) return limited;

  return NextResponse.json(getPublicStoreInfo());
}
