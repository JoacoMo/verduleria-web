import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Cabeceras de seguridad para todas las respuestas.
//
// Nota sobre la CSP: Next inyecta scripts inline (hidratación, flight data) y la
// página inyecta JSON-LD inline, así que necesitamos 'unsafe-inline' en script-src.
// Usar nonces obligaría a renderizar todo dinámicamente y perderíamos el cacheo
// estático de la tienda, que es justo lo que la hace rápida y barata de servir.
// El resto de las directivas quedan lo más cerradas posible.
function buildContentSecurityPolicy() {
  const isDev = process.env.NODE_ENV !== 'production';

  const directives = [
    "default-src 'self'",
    // 'unsafe-eval' solo en dev: lo necesita el refresh rápido de Next.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://va.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    // Las imágenes de productos viven en Supabase Storage y pueden cargarse desde
    // cualquier URL que cargue el dueño desde el panel.
    "img-src 'self' data: blob: https:",
    // El mapa embebido de Google.
    "frame-src https://www.google.com https://maps.google.com",
    "connect-src 'self' https://va.vercel-scripts.com https://vitals.vercel-insights.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ];

  return directives.join('; ');
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy());
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  // El panel y la API nunca deberían quedar cacheados por un proxy intermedio.
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/') || pathname === '/panel' || pathname === '/login') {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
  }

  return response;
}

export const config = {
  matcher: [
    // Todo menos los assets estáticos de Next y el favicon.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
