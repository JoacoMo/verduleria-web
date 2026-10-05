import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_API, PRIVATE_PATH_PREFIXES } from '@/lib/routes';
import { getClientIp } from '@/lib/rate-limit';
import { logSecurityEvent } from '@/lib/security-log';

/**
 * Middleware de seguridad: CSP con nonce, resto de cabeceras y control de origen
 * para la API.
 */

const isProduction = process.env.NODE_ENV === 'production';

/** Métodos que no cambian nada: no necesitan defensa contra CSRF. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Orígenes permitidos para la API.
 *
 * El primero es el origen del propio request: si el navegador pide a
 * `https://loquesea/api/...` con `Origin: https://loquesea`, eso es same-origin y
 * siempre es legítimo. Incluirlo evita el problema de tener que acordarse de
 * actualizar SITE_URL al mover el sitio a un dominio propio (si no, la web se
 * bloquearía a sí misma). Los demás cubren llamadas entre dominios propios.
 */
function getAllowedOrigins(request: NextRequest) {
  const origins = new Set<string>();

  origins.add(request.nextUrl.origin);

  // Detrás del proxy de Vercel, nextUrl puede no reflejar el host público.
  // x-forwarded-host solo es confiable ahí (Vercel lo pisa con el host real): en
  // cualquier otro lado lo manda el cliente y no puede ampliar la lista de
  // orígenes permitidos. SITE_URL y las URLs de Vercel ya cubren los dominios propios.
  if (process.env.VERCEL === '1') {
    const forwardedHost = request.headers.get('x-forwarded-host');
    if (forwardedHost) {
      origins.add(`https://${forwardedHost}`);
    }
  }

  const siteUrl = process.env.SITE_URL || 'https://elpampa.vercel.app';
  origins.add(siteUrl.replace(/\/$/, ''));

  // URL que Vercel asigna a cada deploy (incluye los preview de cada rama).
  if (process.env.VERCEL_URL) {
    origins.add(`https://${process.env.VERCEL_URL}`);
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }

  if (!isProduction) {
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
 * como Next carga el bundle (y como Vercel Analytics agrega su script).
 *
 * No hay orígenes externos de estilos ni fuentes: next/font sirve las fuentes
 * desde el propio dominio y los íconos son SVG de lucide-react dentro del bundle.
 */
function buildContentSecurityPolicy(nonce: string) {
  // En dev, el refresh rápido de Next evalúa código y usa scripts inline sin nonce.
  // Vercel Analytics en dev carga su script de depuración desde va.vercel-scripts.com
  // (en producción sale del propio dominio, /_vercel/insights).
  const scriptSrc = isProduction
    ? `'nonce-${nonce}' 'strict-dynamic' https:`
    : "'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Los estilos siguen con 'unsafe-inline': la app usa el atributo style en varios
    // componentes y Next inyecta CSS inline. Un estilo inyectado no ejecuta código.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // Las imágenes de productos viven en Supabase Storage o en URLs que carga el dueño.
    "img-src 'self' data: blob: https:",
    // Mapa del local embebido.
    'frame-src https://www.google.com https://maps.google.com',
    // Vercel Analytics (en producción reporta al propio dominio; estos son los de dev y Speed Insights).
    "connect-src 'self' https://va.vercel-scripts.com https://vitals.vercel-insights.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Cabeceras que van en todas las respuestas, también en los 403 del propio middleware. */
function applySecurityHeaders(response: NextResponse, csp: string) {
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Nada de cámara, micrófono, ubicación ni pagos desde el navegador: el sitio no
  // los usa y así ningún script inyectado los puede pedir. browsing-topics corta la
  // API de intereses publicitarios de Chrome (reemplazo de interest-cohort).
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()');
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  // HSTS: el navegador recuerda por dos años que el sitio va siempre por HTTPS, así
  // nadie en el medio (un Wi-Fi público) puede bajar la conexión a HTTP. Sin
  // `preload` a propósito: entrar en la lista de precarga es difícil de deshacer si
  // algún día un subdominio necesita HTTP. Solo en producción: en local por HTTP
  // los navegadores lo ignoran, pero con `next dev --experimental-https` dejaría
  // a localhost forzado a HTTPS por dos años.
  if (isProduction) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
}

function isAdminApi(pathname: string) {
  return pathname === ADMIN_API || pathname.startsWith(`${ADMIN_API}/`);
}

function blocked(request: NextRequest, csp: string, reason: string) {
  logSecurityEvent('origen_bloqueado', {
    ip: getClientIp(request),
    path: request.nextUrl.pathname,
    method: request.method,
    reason,
  });

  const response = NextResponse.json({ error: 'Origen no permitido.' }, { status: 403 });
  applySecurityHeaders(response, csp);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(nonce);

  const origin = request.headers.get('origin');
  const allowedOrigins = getAllowedOrigins(request);

  // Si el request trae Origin y no es el nuestro, es una llamada cross-site desde
  // otra web. Se corta acá y no llega al handler. (Ya no hay webhooks externos:
  // toda la API la llama el propio sitio.)
  if (isApi && origin && !allowedOrigins.has(origin)) {
    return blocked(request, csp, `origen no permitido: ${origin}`);
  }

  // Defensa extra contra CSRF en el panel, además de la cookie SameSite=Strict:
  // los navegadores mandan Sec-Fetch-Site en cada request y no se puede falsificar
  // desde JavaScript. Cualquier cambio (login incluido) tiene que venir de una
  // página del mismo origen. Sin la cabecera (curl, scripts del dueño) se deja
  // pasar: ahí no hay navegador que una web ajena pueda usar, y la sesión igual se
  // valida en cada handler.
  if (isAdminApi(pathname) && !SAFE_METHODS.has(request.method)) {
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin') {
      return blocked(request, csp, `sec-fetch-site: ${fetchSite}`);
    }
  }

  // El nonce viaja en el request para que Next se lo ponga a sus <script>: Next lo
  // lee de la cabecera Content-Security-Policy del request (x-nonce queda para
  // componentes que lo necesiten).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response, csp);

  // CORS: se responde solo a los orígenes propios, nunca con comodín, así ninguna
  // otra web puede leer las respuestas de la API. Sin Allow-Credentials: el sitio
  // se llama a sí mismo (same-origin) y la cookie del panel es SameSite=Strict, así
  // que ningún otro origen tiene por qué mandar credenciales.
  if (isApi && origin && allowedOrigins.has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    response.headers.set('Access-Control-Max-Age', '86400');
    response.headers.append('Vary', 'Origin');
  }

  if (isApi || PRIVATE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
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
