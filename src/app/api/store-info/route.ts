import { NextResponse } from 'next/server';
import { siteConfig } from '@/lib/site';
import { isMercadoPagoEnabled } from '@/lib/mercadopago';
import { enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, 'publicRead');
  if (limited) return limited;

  return NextResponse.json({
    ...siteConfig,
    // La tienda muestra el botón de tarjeta solo si MP está configurado.
    mercadoPagoEnabled: isMercadoPagoEnabled(),
  });
}