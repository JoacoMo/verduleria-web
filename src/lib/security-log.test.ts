import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECURITY_LOG_SAMPLE_MS, clientSubject, logSecurityEvent, resetSecurityLogSampling } from './security-log';

const START = new Date('2026-10-05T15:00:00.000Z');

const errorLines = () => vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
const warnLines = () => vi.mocked(console.warn).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  resetSecurityLogSampling();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('logSecurityEvent', () => {
  it('una línea JSON con el evento, la hora y los detalles; los de ataque como error', () => {
    logSecurityEvent('token_invalido', { ip: '203.0.113.1', path: '/api/gestion/orders', method: 'GET', reason: 'firma inválida' });
    logSecurityEvent('login_ok', { ip: '203.0.113.1', path: '/api/gestion/login' });
    expect(errorLines()).toEqual([
      { secEvent: 'token_invalido', ts: START.toISOString(), ip: '203.0.113.1', path: '/api/gestion/orders', method: 'GET', reason: 'firma inválida' },
    ]);
    expect(warnLines()).toEqual([{ secEvent: 'login_ok', ts: START.toISOString(), ip: '203.0.113.1', path: '/api/gestion/login' }]);
  });

  // Era log flooding: cada 401 con una cookie basura, cada 429 y cada intento al
  // cron escribían su propia línea y tapaban los eventos que importan.
  it.each(['token_invalido', 'rate_limit', 'cron_no_autorizado', 'origen_bloqueado'] as const)(
    '%s: una línea por cliente por minuto, con la cuenta de los omitidos en la siguiente',
    (event) => {
      for (let i = 0; i < 500; i += 1) logSecurityEvent(event, { ip: '198.51.100.9', path: `/api/x${i}` });
      expect(errorLines()).toHaveLength(1);
      expect(errorLines()[0]).toMatchObject({ secEvent: event, ip: '198.51.100.9', path: '/api/x0' });
      expect(errorLines()[0]).not.toHaveProperty('repetidos');

      vi.setSystemTime(new Date(START.getTime() + SECURITY_LOG_SAMPLE_MS - 1));
      logSecurityEvent(event, { ip: '198.51.100.9' });
      expect(errorLines()).toHaveLength(1);

      vi.setSystemTime(new Date(START.getTime() + SECURITY_LOG_SAMPLE_MS));
      logSecurityEvent(event, { ip: '198.51.100.9' });
      expect(errorLines()).toHaveLength(2);
      expect(errorLines()[1]).toMatchObject({ secEvent: event, repetidos: 500 });
    },
  );

  it('el muestreo es por evento y por cliente', () => {
    logSecurityEvent('rate_limit', { ip: '198.51.100.1' });
    logSecurityEvent('rate_limit', { ip: '198.51.100.2' });
    logSecurityEvent('token_invalido', { ip: '198.51.100.1' });
    logSecurityEvent('rate_limit', { ip: '198.51.100.1' });
    expect(errorLines().map((line) => `${line.secEvent}:${line.ip}`)).toEqual([
      'rate_limit:198.51.100.1',
      'rate_limit:198.51.100.2',
      'token_invalido:198.51.100.1',
    ]);
  });

  it('en IPv6 cuenta como un solo cliente todo el /64 (no se esquiva rotando direcciones)', () => {
    for (let i = 1; i <= 50; i += 1) logSecurityEvent('token_invalido', { ip: `2001:db8:1:2::${i.toString(16)}` });
    logSecurityEvent('token_invalido', { ip: '2001:db8:1:3::1' });
    expect(errorLines().map((line) => line.ip)).toEqual(['2001:db8:1:2::1', '2001:db8:1:3::1']);
  });

  it('los de login y el de secreto débil no se muestrean', () => {
    for (let i = 0; i < 5; i += 1) {
      logSecurityEvent('login_fallido', { ip: '198.51.100.3' });
      logSecurityEvent('login_ok', { ip: '198.51.100.3' });
      logSecurityEvent('secreto_debil', { reason: 'corto' });
    }
    expect(warnLines()).toHaveLength(15);
  });

  it('si el reloj va para atrás, loguea (mejor de más que de menos)', () => {
    logSecurityEvent('rate_limit', { ip: '198.51.100.4' });
    vi.setSystemTime(new Date(START.getTime() - 1000));
    logSecurityEvent('rate_limit', { ip: '198.51.100.4' });
    expect(errorLines()).toHaveLength(2);
  });

  it('con miles de clientes distintos no crece sin tope: cada uno loguea una vez', () => {
    for (let i = 0; i < 6000; i += 1) logSecurityEvent('origen_bloqueado', { ip: `10.0.${i >> 8}.${i & 255}` });
    expect(errorLines()).toHaveLength(6000);
    // El más reciente sigue recordado.
    logSecurityEvent('origen_bloqueado', { ip: `10.0.${5999 >> 8}.${5999 & 255}` });
    expect(errorLines()).toHaveLength(6000);
  });
});

describe('clientSubject', () => {
  it('IPv4 igual; IPv6 por /64', () => {
    expect(clientSubject('203.0.113.9')).toBe('203.0.113.9');
    expect(clientSubject('2001:DB8:1:2::abcd')).toBe('2001:db8:1:2::/64');
    expect(clientSubject('::1')).toBe('0:0:0:0::/64');
    expect(clientSubject('desconocida')).toBe('desconocida');
  });
});
