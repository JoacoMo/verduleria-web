import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RATE_LIMITS, checkRateLimit, enforceRateLimit, getClientIp, resetRateLimit } from './rate-limit';

const START = new Date('2026-10-05T15:00:00.000Z');
let keyCounter = 0;
const uniqueKey = () => `test:${(keyCounter += 1)}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkRateLimit', () => {
  it('deja pasar hasta el límite y después corta con Retry-After', () => {
    const key = uniqueKey();
    const results = Array.from({ length: 4 }, () => checkRateLimit(key, 3, 60_000));
    expect(results.map((result) => result.ok)).toEqual([true, true, true, false]);
    expect(results.map((result) => result.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3].retryAfterSeconds).toBe(60);
  });

  it('la ventana se reinicia al vencer', () => {
    const key = uniqueKey();
    checkRateLimit(key, 1, 60_000);
    expect(checkRateLimit(key, 1, 60_000).ok).toBe(false);
    vi.setSystemTime(new Date(START.getTime() + 59_999));
    expect(checkRateLimit(key, 1, 60_000).retryAfterSeconds).toBe(1);
    vi.setSystemTime(new Date(START.getTime() + 60_000));
    expect(checkRateLimit(key, 1, 60_000).ok).toBe(true);
  });

  it('resetRateLimit libera el cupo (login correcto)', () => {
    const key = uniqueKey();
    checkRateLimit(key, 1, 60_000);
    resetRateLimit(key);
    expect(checkRateLimit(key, 1, 60_000).ok).toBe(true);
  });

  it('cada clave tiene su propio cupo', () => {
    const a = uniqueKey();
    const b = uniqueKey();
    checkRateLimit(a, 1, 60_000);
    expect(checkRateLimit(a, 1, 60_000).ok).toBe(false);
    expect(checkRateLimit(b, 1, 60_000).ok).toBe(true);
  });
});

describe('getClientIp', () => {
  const request = (headers: Record<string, string>) => new Request('http://localhost/api/x', { headers });

  it('primer valor de x-forwarded-for, después x-real-ip, si no "desconocida"', () => {
    expect(getClientIp(request({ 'x-forwarded-for': ' 203.0.113.1 , 10.0.0.1' }))).toBe('203.0.113.1');
    expect(getClientIp(request({ 'x-forwarded-for': ',', 'x-real-ip': ' 198.51.100.2 ' }))).toBe('198.51.100.2');
    expect(getClientIp(request({}))).toBe('desconocida');
  });
});

describe('enforceRateLimit', () => {
  it('null mientras haya cupo; 429 con Retry-After y evento de seguridad al pasarse', async () => {
    const ip = `198.51.100.${(keyCounter += 1) % 250}`;
    const request = () => new Request('http://localhost/api/gestion/login', { method: 'POST', headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < RATE_LIMITS.login.limit; i += 1) {
      expect(enforceRateLimit(request(), 'login')).toBeNull();
    }
    const limited = enforceRateLimit(request(), 'login', 'Pará un poco.');
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get('Retry-After')).toBe(String(RATE_LIMITS.login.windowMs / 1000));
    expect(await limited?.json()).toEqual({ error: 'Pará un poco.' });
    expect(JSON.parse(String(vi.mocked(console.error).mock.calls.at(-1)?.[0]))).toMatchObject({ secEvent: 'rate_limit', ip, path: '/api/gestion/login' });
  });

  it('los presets no comparten cupo (leer el catálogo no gasta el del checkout)', () => {
    const ip = '192.0.2.200';
    const request = () => new Request('http://localhost/api/x', { headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < RATE_LIMITS.checkout.limit; i += 1) enforceRateLimit(request(), 'checkout');
    expect(enforceRateLimit(request(), 'checkout')?.status).toBe(429);
    expect(enforceRateLimit(request(), 'publicRead')).toBeNull();
  });
});
