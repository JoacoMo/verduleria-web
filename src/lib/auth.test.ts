import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_SECONDS,
  clearAdminSessionCookie,
  createAdminToken,
  safeCompare,
  setAdminSessionCookie,
  verifyAdminAuth,
} from './auth';
import { NextResponse } from 'next/server';

const SECRET = 'secreto-de-tests-con-mas-de-32-caracteres-para-jwt';

function requestWith(cookie?: string, path = '/api/gestion/session') {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-forwarded-for': '203.0.113.7', ...(cookie !== undefined ? { cookie } : {}) },
  });
}

const withToken = (token: string) => requestWith(`${ADMIN_COOKIE_NAME}=${token}`);

/** Firma "a mano" para simular tokens raros (otro secreto, otro rol, otro emisor). */
function sign(payload: object, options: jwt.SignOptions = {}, secret = SECRET) {
  return jwt.sign(payload, secret, { algorithm: 'HS256', issuer: 'el-pampa', expiresIn: 60, ...options });
}

function base64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function errorMessage(result: ReturnType<typeof verifyAdminAuth>) {
  if (result.ok) throw new Error('Se esperaba 401');
  expect(result.response.status).toBe(401);
  return ((await result.response.json()) as { error: string }).error;
}

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', SECRET);
  vi.stubEnv('ADMIN_TOKEN_VERSION', '1');
  // Los intentos con token inválido se loguean como evento de seguridad.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('safeCompare', () => {
  it('compara en tiempo constante, sin importar el largo', () => {
    expect(safeCompare('clave', 'clave')).toBe(true);
    expect(safeCompare('clave', 'Clave')).toBe(false);
    expect(safeCompare('clave', 'clave-mas-larga')).toBe(false);
    expect(safeCompare('', '')).toBe(true);
    expect(safeCompare('', 'x')).toBe(false);
    expect(safeCompare('ñandú', 'ñandú')).toBe(true);
  });
});

describe('createAdminToken', () => {
  it('HS256, rol admin, versión vigente, emisor y vencimiento de 12 h', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T15:00:00Z'));
    const token = createAdminToken();
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.alg).toBe('HS256');
    expect(decoded?.payload).toMatchObject({ role: 'admin', v: '1', iss: 'el-pampa' });
    const payload = decoded?.payload as jwt.JwtPayload;
    expect(payload.exp! - payload.iat!).toBe(ADMIN_SESSION_SECONDS);
    expect(ADMIN_SESSION_SECONDS).toBe(12 * 60 * 60);
  });

  it('sin JWT_SECRET no firma nada', () => {
    vi.stubEnv('JWT_SECRET', '');
    expect(() => createAdminToken()).toThrow('JWT_SECRET no está configurado.');
  });

  it('un secreto corto se avisa una sola vez por instancia, pero no corta el login', async () => {
    vi.resetModules();
    vi.stubEnv('JWT_SECRET', 'corto');
    const fresh = await import('./auth');
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    expect(() => fresh.createAdminToken()).not.toThrow();
    fresh.createAdminToken();
    const events = warn.mock.calls.map(([line]) => JSON.parse(String(line)) as { secEvent: string });
    expect(events.filter((event) => event.secEvent === 'secreto_debil')).toHaveLength(1);
  });
});

describe('verifyAdminAuth', () => {
  it('cookie válida → ok', () => {
    expect(verifyAdminAuth(withToken(createAdminToken()))).toEqual({ ok: true });
  });

  it('encuentra la cookie entre otras', () => {
    const request = requestWith(`otra=1; ${ADMIN_COOKIE_NAME}=${createAdminToken()}; tema=oscuro`);
    expect(verifyAdminAuth(request).ok).toBe(true);
  });

  it('sin cookie → 401 sin loguear evento (es el dueño sin sesión, no un ataque)', async () => {
    expect(await errorMessage(verifyAdminAuth(requestWith()))).toBe('No autorizado. Iniciá sesión.');
    expect(await errorMessage(verifyAdminAuth(requestWith('otra=1')))).toBe('No autorizado. Iniciá sesión.');
    expect(await errorMessage(verifyAdminAuth(requestWith(`${ADMIN_COOKIE_NAME}=`)))).toBe('No autorizado. Iniciá sesión.');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('el token NO se acepta por el header Authorization (solo cookie)', async () => {
    const request = new Request('http://localhost/api/gestion/session', { headers: { authorization: `Bearer ${createAdminToken()}` } });
    expect(await errorMessage(verifyAdminAuth(request))).toBe('No autorizado. Iniciá sesión.');
  });

  it('vencido → 401 con mensaje genérico y evento de seguridad', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T15:00:00Z'));
    const token = createAdminToken();
    vi.setSystemTime(new Date(Date.now() + (ADMIN_SESSION_SECONDS - 1) * 1000));
    expect(verifyAdminAuth(withToken(token)).ok).toBe(true);
    vi.setSystemTime(new Date(Date.now() + 2000));
    expect(await errorMessage(verifyAdminAuth(withToken(token)))).toBe('Sesión vencida. Volvé a iniciar sesión.');
    const logged = JSON.parse(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])) as Record<string, string>;
    expect(logged).toMatchObject({ secEvent: 'token_invalido', ip: '203.0.113.7', path: '/api/gestion/session', method: 'GET' });
    // Nunca se loguea el token.
    expect(JSON.stringify(logged)).not.toContain(token);
  });

  it('de otra versión (sesiones revocadas con ADMIN_TOKEN_VERSION) → 401', async () => {
    const token = createAdminToken();
    vi.stubEnv('ADMIN_TOKEN_VERSION', '2');
    expect(await errorMessage(verifyAdminAuth(withToken(token)))).toBe('Tu sesión se cerró. Volvé a iniciar sesión.');
  });

  it('sin ADMIN_TOKEN_VERSION la versión es "1"', () => {
    vi.stubEnv('ADMIN_TOKEN_VERSION', '');
    expect(verifyAdminAuth(withToken(sign({ role: 'admin', v: '1' }))).ok).toBe(true);
  });

  it('firmado con otro secreto → 401', async () => {
    const forged = sign({ role: 'admin', v: '1' }, {}, 'otro-secreto-cualquiera-de-mas-de-32-caracteres');
    expect(await errorMessage(verifyAdminAuth(withToken(forged)))).toBe('Sesión vencida. Volvé a iniciar sesión.');
  });

  it('alg "none" (sin firma) → 401', async () => {
    const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ role: 'admin', v: '1', iss: 'el-pampa', exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
    expect(await errorMessage(verifyAdminAuth(withToken(unsigned)))).toBe('Sesión vencida. Volvé a iniciar sesión.');
  });

  it('otro algoritmo (HS512) con el mismo secreto → 401', async () => {
    const token = sign({ role: 'admin', v: '1' }, { algorithm: 'HS512' });
    expect(verifyAdminAuth(withToken(token)).ok).toBe(false);
  });

  it('bien firmado pero sin rol admin, de otro emisor o basura → 401', async () => {
    expect(await errorMessage(verifyAdminAuth(withToken(sign({ role: 'user', v: '1' }))))).toBe('Sesión inválida.');
    expect(await errorMessage(verifyAdminAuth(withToken(sign({ v: '1' }))))).toBe('Sesión inválida.');
    expect(verifyAdminAuth(withToken(sign({ role: 'admin', v: '1' }, { issuer: 'otro' }))).ok).toBe(false);
    expect(verifyAdminAuth(withToken('no.es.un.jwt')).ok).toBe(false);
    expect(verifyAdminAuth(withToken('basura')).ok).toBe(false);
  });

  it('sin JWT_SECRET en el servidor: 401, no 500', async () => {
    const token = createAdminToken();
    vi.stubEnv('JWT_SECRET', '');
    expect(await errorMessage(verifyAdminAuth(withToken(token)))).toBe('Sesión vencida. Volvé a iniciar sesión.');
  });
});

describe('cookie de sesión', () => {
  it('setAdminSessionCookie: httpOnly, SameSite=Strict, solo /api/gestion, 12 h', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const header = setAdminSessionCookie(NextResponse.json({ ok: true })).headers.get('set-cookie') ?? '';
    expect(header).toMatch(new RegExp(`^${ADMIN_COOKIE_NAME}=[\\w-]+\\.[\\w-]+\\.[\\w-]+; `));
    expect(header).toContain('Path=/api/gestion');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain(`Max-Age=${ADMIN_SESSION_SECONDS}`);
    expect(header).not.toContain('Secure');
  });

  it('en producción lleva Secure', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(setAdminSessionCookie(NextResponse.json({ ok: true })).headers.get('set-cookie')).toContain('; Secure');
  });

  it('clearAdminSessionCookie la vacía con Max-Age=0', () => {
    const header = clearAdminSessionCookie(NextResponse.json({ ok: true })).headers.get('set-cookie') ?? '';
    expect(header).toMatch(new RegExp(`^${ADMIN_COOKIE_NAME}=; `));
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Path=/api/gestion');
  });
});
