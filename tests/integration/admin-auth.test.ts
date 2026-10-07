import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { POST as login } from '@/app/api/gestion/login/route';
import { POST as logout } from '@/app/api/gestion/logout/route';
import { GET as session } from '@/app/api/gestion/session/route';
import { ADMIN_COOKIE_NAME } from '@/lib/auth';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { adminCookie, apiRequest, cookieFromSetCookie, describeDb, nextIp, prisma, readJson, routeParams } from './helpers';

const GESTION_DIR = fileURLToPath(new URL('../../src/app/api/gestion/', import.meta.url));
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Endpoints de /api/gestion que NO piden sesión, a propósito. Cualquier otro
 * que aparezca (uno nuevo incluido) tiene que responder 401 sin cookie.
 */
const PUBLIC_ENDPOINTS = new Set(['POST login', 'POST logout']);

type Handler = (request: Request, context: ReturnType<typeof routeParams>) => Promise<Response>;
type Endpoint = { name: string; path: string; method: string; handler: Handler };

function findRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return findRouteFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

/** Recorre src/app/api/gestion/**\/route.ts e importa cada handler exportado. */
async function discoverEndpoints(): Promise<Endpoint[]> {
  const endpoints: Endpoint[] = [];
  for (const file of findRouteFiles(GESTION_DIR).sort()) {
    const route = relative(GESTION_DIR, file).replace(/\\/g, '/').replace(/\/?route\.ts$/, '');
    const routeModule = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
    for (const method of HTTP_METHODS) {
      if (typeof routeModule[method] === 'function') {
        endpoints.push({
          name: `${method} ${route}`,
          path: `/api/gestion/${route.replace('[id]', '1')}`,
          method,
          handler: routeModule[method] as Handler,
        });
      }
    }
  }
  return endpoints;
}

let endpoints: Endpoint[] = [];

beforeAll(async () => {
  endpoints = await discoverEndpoints();
});

beforeEach(() => {
  // Los intentos con token inválido y los login fallidos se loguean como eventos de seguridad.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

async function callEndpoint(endpoint: Endpoint, cookie?: string) {
  const hasBody = endpoint.method !== 'GET' && endpoint.method !== 'DELETE';
  const request = apiRequest(endpoint.path, { method: endpoint.method, cookie, ...(hasBody ? { body: {} } : {}) });
  return endpoint.handler(request, routeParams(1));
}

describeDb('/api/gestion: todo pide sesión', () => {
  it('se encontraron los endpoints del panel', () => {
    expect(endpoints.map((endpoint) => endpoint.name)).toEqual(expect.arrayContaining([
      'POST login',
      'POST logout',
      'GET session',
      'GET orders',
      'PUT orders/[id]',
      'DELETE orders/[id]',
      'PUT orders/[id]/confirm',
      'PUT orders/[id]/cancel',
      'POST products',
      'PUT products/[id]',
      'DELETE products/[id]',
      'PUT products/[id]/availability',
      'POST products/bulk',
      'POST upload-product-image',
    ]));
  });

  it('sin cookie → 401 en todos los endpoints privados, sin tocar la base', async () => {
    const before = await Promise.all([prisma.order.count(), prisma.product.count()]);
    const privateEndpoints = endpoints.filter((endpoint) => !PUBLIC_ENDPOINTS.has(endpoint.name));
    expect(privateEndpoints.length).toBeGreaterThanOrEqual(12);
    for (const endpoint of privateEndpoints) {
      const response = await callEndpoint(endpoint);
      expect(response.status, endpoint.name).toBe(401);
      expect(await readJson(response), endpoint.name).toEqual({ error: 'No autorizado. Iniciá sesión.' });
    }
    expect(await Promise.all([prisma.order.count(), prisma.product.count()])).toEqual(before);
  });

  it('con una cookie inválida, vencida, de otra versión o mandada como Bearer → 401', async () => {
    const privateEndpoints = endpoints.filter((endpoint) => !PUBLIC_ENDPOINTS.has(endpoint.name));
    const expired = jwt.sign({ role: 'admin', v: '1' }, process.env.JWT_SECRET!, { algorithm: 'HS256', issuer: 'el-pampa', expiresIn: -10 });
    const otherVersion = jwt.sign({ role: 'admin', v: '0' }, process.env.JWT_SECRET!, { algorithm: 'HS256', issuer: 'el-pampa', expiresIn: 60 });
    const otherSecret = jwt.sign({ role: 'admin', v: '1' }, 'otro-secreto-de-mas-de-32-caracteres-xxxxxx', { algorithm: 'HS256', issuer: 'el-pampa', expiresIn: 60 });
    for (const token of ['basura', expired, otherVersion, otherSecret]) {
      for (const endpoint of privateEndpoints) {
        const response = await callEndpoint(endpoint, `${ADMIN_COOKIE_NAME}=${token}`);
        expect(response.status, `${endpoint.name} con ${token.slice(0, 12)}`).toBe(401);
      }
    }
    // El token correcto pero en Authorization (como en la versión vieja) no sirve.
    const bearer = new Request('http://localhost/api/gestion/session', { headers: { authorization: `Bearer ${adminCookie().split('=')[1]}`, 'x-forwarded-for': nextIp() } });
    expect((await session(bearer)).status).toBe(401);
  });
});

describeDb('POST /api/gestion/login', () => {
  const credentials = () => ({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  it('login correcto → cookie httpOnly que sirve para el resto del panel', async () => {
    const response = await login(apiRequest('/api/gestion/login', { method: 'POST', body: credentials() }));
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ ok: true });
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/api/gestion');
    // El token nunca va en el cuerpo.
    const cookie = cookieFromSetCookie(response);
    expect(cookie).not.toBeNull();

    const check = await session(apiRequest('/api/gestion/session', { cookie: cookie! }));
    expect(check.status).toBe(200);
    expect(await readJson(check)).toEqual({ ok: true });
  });

  it('el usuario se limpia (espacios, invisibles) pero la contraseña no', async () => {
    const { username, password } = credentials();
    expect((await login(apiRequest('/api/gestion/login', { method: 'POST', body: { username: `  ${username}​ `, password } }))).status).toBe(200);
    expect((await login(apiRequest('/api/gestion/login', { method: 'POST', body: { username, password: ` ${password}` } }))).status).toBe(401);
  });

  it.each([
    ['contraseña incorrecta', { username: 'admin-tests', password: 'otra' }],
    ['usuario incorrecto', { username: 'root', password: 'clave-de-tests' }],
    ['sin campos', {}],
    ['tipos raros', { username: ['admin-tests'], password: { $ne: '' } }],
    ['contraseña gigante', { username: 'admin-tests', password: 'x'.repeat(201) }],
  ])('%s → 401 genérico y sin cookie', async (_case, payload) => {
    const response = await login(apiRequest('/api/gestion/login', { method: 'POST', body: payload }));
    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: 'Usuario o contraseña incorrectos.' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('body que no es JSON → 400', async () => {
    const response = await login(apiRequest('/api/gestion/login', { method: 'POST', rawBody: 'username=admin' }));
    expect(response.status).toBe(400);
  });

  it(`después de ${RATE_LIMITS.login.limit} intentos desde la misma IP → 429, aunque la clave sea correcta`, async () => {
    const ip = nextIp();
    for (let i = 0; i < RATE_LIMITS.login.limit; i += 1) {
      expect((await login(apiRequest('/api/gestion/login', { method: 'POST', body: { username: 'admin-tests', password: `mala-${i}` }, ip }))).status).toBe(401);
    }
    const blocked = await login(apiRequest('/api/gestion/login', { method: 'POST', body: credentials(), ip }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe(String(RATE_LIMITS.login.windowMs / 1000));
    expect(blocked.headers.get('set-cookie')).toBeNull();
    // Otra IP sigue pudiendo entrar.
    expect((await login(apiRequest('/api/gestion/login', { method: 'POST', body: credentials() }))).status).toBe(200);
  });

  it('un login correcto libera el cupo de intentos de esa IP', async () => {
    const ip = nextIp();
    for (let i = 0; i < RATE_LIMITS.login.limit - 1; i += 1) {
      await login(apiRequest('/api/gestion/login', { method: 'POST', body: { username: 'x', password: 'y' }, ip }));
    }
    expect((await login(apiRequest('/api/gestion/login', { method: 'POST', body: credentials(), ip }))).status).toBe(200);
    for (let i = 0; i < RATE_LIMITS.login.limit; i += 1) {
      expect((await login(apiRequest('/api/gestion/login', { method: 'POST', body: { username: 'x', password: 'y' }, ip }))).status).toBe(401);
    }
  });

  it('sin ADMIN_USERNAME/ADMIN_PASSWORD configurados → 500 (no deja entrar con vacío)', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const response = await login(apiRequest('/api/gestion/login', { method: 'POST', body: { username: 'admin-tests', password: '' } }));
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: 'No se pudo iniciar sesión.' });
  });
});

describeDb('logout y revocación', () => {
  it('logout borra la cookie (Max-Age=0) y no pide sesión', async () => {
    const response = await logout();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(new RegExp(`^${ADMIN_COOKIE_NAME}=; .*Max-Age=0`));
  });

  it('cambiar ADMIN_TOKEN_VERSION cierra las sesiones abiertas', async () => {
    const cookie = adminCookie();
    expect((await session(apiRequest('/api/gestion/session', { cookie }))).status).toBe(200);
    vi.stubEnv('ADMIN_TOKEN_VERSION', '2');
    const revoked = await session(apiRequest('/api/gestion/session', { cookie }));
    expect(revoked.status).toBe(401);
    expect(await readJson(revoked)).toEqual({ error: 'Tu sesión se cerró. Volvé a iniciar sesión.' });
  });
});
