import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { config, middleware } from './middleware';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const request = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, init);

/** El matcher de Next para este patrón es una regex común anclada. */
const matches = (path: string) => config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));

describe('middleware: cabeceras de seguridad', () => {
  it.each(['/', '/frutas', '/api/products', '/favicon.ico', '/trastienda'])('%s lleva CSP, X-Frame-Options y COOP', (path) => {
    const response = middleware(request(path));
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('el 403 de un origen ajeno también lleva COOP', () => {
    const response = middleware(request('/api/checkout', { method: 'POST', headers: { origin: 'https://evil.example' } }));
    expect(response.status).toBe(403);
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });
});

describe('middleware: matcher', () => {
  // Era un bug: /favicon.ico estaba excluido, no existe (el sitio usa icon.svg) y
  // el 404 salía sin CSP ni X-Frame-Options.
  it('pasa por todo, favicon incluido, menos los assets estáticos de Next', () => {
    expect(matches('/favicon.ico')).toBe(true);
    expect(matches('/')).toBe(true);
    expect(matches('/api/gestion/orders')).toBe(true);
    expect(matches('/icon.svg')).toBe(true);
    expect(matches('/_next/static/chunks/main.js')).toBe(false);
    expect(matches('/_next/image')).toBe(false);
  });
});
