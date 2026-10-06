import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORDER_CAPS,
  RATE_LIMITS,
  checkRateLimit,
  enforceRateLimit,
  getClientIp,
  rateLimitBucketCount,
  rateLimitSubject,
  resetRateLimit,
} from './rate-limit';
import { resetSecurityLogSampling } from './security-log';

const START = new Date('2026-10-05T15:00:00.000Z');
let keyCounter = 0;
const uniqueKey = () => `test:${(keyCounter += 1)}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetSecurityLogSampling();
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

describe('checkRateLimit: tope de claves en memoria', () => {
  const MAX = 5000;
  const fill = (count: number, windowMs = 10 * 60 * 1000) => {
    for (let i = 0; i < count; i += 1) checkRateLimit(uniqueKey(), 8, windowMs);
  };

  it('nunca guarda más de 5000 claves, aunque estén todas vivas', () => {
    fill(MAX + 1000);
    expect(rateLimitBucketCount()).toBe(MAX);
  });

  // Era un bug: por encima de 5000 claves vivas cada request recorría el Map
  // entero sin liberar nada (20.000 claves: 2,4 s solo en esos recorridos).
  it('con el Map lleno, cada request cuesta lo mismo (no recorre todo)', () => {
    fill(MAX);
    const started = performance.now();
    fill(20_000);
    expect(performance.now() - started).toBeLessThan(500);
    expect(rateLimitBucketCount()).toBe(MAX);
  });

  it('se descartan las que hace más que no se usan: una clave que se sigue usando no se pierde', () => {
    fill(MAX);
    const attacker = uniqueKey();
    checkRateLimit(attacker, 1, 10 * 60 * 1000);
    expect(checkRateLimit(attacker, 1, 10 * 60 * 1000).ok).toBe(false);
    fill(4000);
    // Se volvió a usar: pasa al final y sigue bloqueada.
    expect(checkRateLimit(attacker, 1, 10 * 60 * 1000).ok).toBe(false);
    fill(4999);
    expect(checkRateLimit(attacker, 1, 10 * 60 * 1000).ok).toBe(false);
    // Si deja de aparecer y entran más de 5000 clientes nuevos, se olvida.
    fill(MAX);
    expect(checkRateLimit(attacker, 1, 10 * 60 * 1000).ok).toBe(true);
  });

  it('el barrido de vencidas libera lugar (como mucho cada 10 s)', () => {
    fill(MAX, 1000);
    vi.setSystemTime(new Date(START.getTime() + 11_000));
    fill(2);
    expect(rateLimitBucketCount()).toBe(2);
  });
});

describe('presets del checkout', () => {
  it('los intentos tienen un cupo generoso y los pedidos creados uno chico, aparte', () => {
    expect(RATE_LIMITS.checkout).toEqual({ limit: 30, windowMs: 10 * 60 * 1000 });
    expect(RATE_LIMITS.checkoutCreate).toEqual({ limit: 6, windowMs: 10 * 60 * 1000 });
    expect(ORDER_CAPS).toEqual({
      perPhone: { limit: 5, windowMs: 24 * 60 * 60 * 1000 },
      global: { limit: 150, windowMs: 60 * 60 * 1000 },
    });
  });

  it('gastar intentos no gasta el cupo de pedidos creados', () => {
    const request = () => new Request('http://localhost/api/checkout', { method: 'POST', headers: { 'x-forwarded-for': '192.0.2.77' } });
    for (let i = 0; i < RATE_LIMITS.checkout.limit; i += 1) expect(enforceRateLimit(request(), 'checkout')).toBeNull();
    expect(enforceRateLimit(request(), 'checkout')?.status).toBe(429);
    for (let i = 0; i < RATE_LIMITS.checkoutCreate.limit; i += 1) expect(enforceRateLimit(request(), 'checkoutCreate')).toBeNull();
    expect(enforceRateLimit(request(), 'checkoutCreate')?.status).toBe(429);
  });
});

describe('rateLimitSubject', () => {
  it('IPv4 igual; IPv6 agrupada por /64; IPv4 mapeada como IPv4', () => {
    expect(rateLimitSubject('203.0.113.9')).toBe('203.0.113.9');
    expect(rateLimitSubject('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitSubject('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(rateLimitSubject('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitSubject('::ffff:198.51.100.4')).toBe('198.51.100.4');
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

  // Era log flooding: cada 429 escribía su propia línea.
  it('una ráfaga de 429 del mismo cliente deja una sola línea por minuto', () => {
    const request = () => new Request('http://localhost/api/products', { headers: { 'x-forwarded-for': '198.51.100.250' } });
    for (let i = 0; i < RATE_LIMITS.publicRead.limit + 50; i += 1) enforceRateLimit(request(), 'publicRead');
    expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1);
  });

  it('los presets no comparten cupo (leer el catálogo no gasta el del checkout)', () => {
    const ip = '192.0.2.200';
    const request = () => new Request('http://localhost/api/x', { headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < RATE_LIMITS.checkout.limit; i += 1) enforceRateLimit(request(), 'checkout');
    expect(enforceRateLimit(request(), 'checkout')?.status).toBe(429);
    expect(enforceRateLimit(request(), 'publicRead')).toBeNull();
  });
});
