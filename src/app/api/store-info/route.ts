import { NextResponse } from 'next/server';
import { siteConfig } from '@/lib/site';
import { isMercadoPagoEnabled } from '@/lib/mercadopago';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ...siteConfig,
    // La tienda muestra el botón de tarjeta solo si MP está configurado.
    mercadoPagoEnabled: isMercadoPagoEnabled(),
  });
}