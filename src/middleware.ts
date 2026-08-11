import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware de seguridad: CSP con nonce, resto de cabeceras y control de origen
 * para la API.
 */

// Orígenes permitidos: el sitio en producción, los preview de Vercel y el dev local.
function getAllowedOrigins() {
  const origins = new Set<string>();

  const siteUrl = process.env.SITE_URL || 'https://elpampa.vercel.app';
  origins.add(siteUrl.replace(/\/$/, ''));

  // URL que Vercel asigna a cada deploy (incluye los preview de cada rama).
  if (process.env.VERCEL_URL) {
    origins.add(`https://${process.env.VERCEL_URL}`);
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }

  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return origins;
}

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * CSP con nonce en script-src.
 *
 * Con 'unsafe-inline' cualquier <script> inyectado se ejecutaba igual, así que la
 * CSP no servía de nada contra XSS. Con nonce, el navegador solo corre los scripts
 * que llevan el nonce que generamos por request: un script inyectado no lo sabe y
 * queda bloqueado. Next propaga el nonce a sus propios scripts leyendo esta cabecera.
 *
 * `strict-dynamic` deja que los scripts ya autorizados carguen sus chunks, que es
 * como Next carga el bundle.
 */
function buildContentSecurityPolicy(nonce: string) {
  const isDev = process.env.NODE_ENV !== 'production';

  // En dev, el refresh rápido de Next evalúa código y usa scripts inline sin nonce.
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : `'nonce-${nonce}' 'strict-dynamic' https:`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Los estilos siguen con 'unsafe-inline': la app usa el atributo style en varios
    // componentes y Next inyecta CSS inline. Un estilo inyectado no ejecuta código.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    // Las imágenes de productos viven en Supabase Storage o en URLs que carga el dueño.
    "img-src 'self' data: blob: https:",
    "frame-src https://www.google.com https://maps.google.com",
    "connect-src 'self' https://va.vercel-scripts.com https://vitals.vercel-insights.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // El webhook de Mercado Pago lo llama un servidor externo, no un navegador:
  // no le aplica CORS y se valida por firma HMAC dentro del handler.
  const isWebhook = pathname.startsWith('/api/webhooks/');

  const origin = request.headers.get('origin');
  const allowedOrigins = getAllowedOrigins();

  if (isApi && !isWebhook && origin) {
    // Si el request trae Origin y no es el nuestro, es una llamada cross-site
    // desde otra web. Se corta acá y no llega al handler.
    if (!allowedOrigins.has(origin)) {
      console.error(JSON.stringify({
        secEvent: 'origen_bloqueado',
        ts: new Date().toISOString(),
        path: pathname,
        method: request.method,
        reason: `origen no permitido: ${origin}`,
      }));

      return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403 });
    }
  }

  const nonce = generateNonce();

  // El nonce viaja en el request para que Next se lo ponga a sus <script>.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce));
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  // CORS: se responde solo al propio origen. Sin Access-Control-Allow-Origin
  // comodín, así ninguna otra web puede leer las respuestas de la API.
  if (isApi && origin && allowedOrigins.has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Max-Age', '86400');
    response.headers.append('Vary', 'Origin');
  }

  if (isApi || pathname === '/panel' || pathname === '/login') {
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
