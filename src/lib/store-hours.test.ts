import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OPENING_WINDOWS,
  ORDER_CUTOFF_LABEL,
  STORE_HOURS_TEXT,
  TIMEZONE,
  formatMinutes,
  getArgentinaParts,
  getOpeningHoursSpecification,
  isPastOrderCutoff,
  isStoreOpenNow,
} from './store-hours';

const at = (localIso: string) => new Date(`${localIso}-03:00`);

afterEach(() => {
  vi.useRealTimers();
});

describe('textos derivados', () => {
  it('formatMinutes', () => {
    expect(formatMinutes(0)).toBe('0:00');
    expect(formatMinutes(545)).toBe('9:05');
    expect(formatMinutes(21 * 60 + 30)).toBe('21:30');
  });

  it('horarios para mostrar y corte de pedidos', () => {
    expect(TIMEZONE).toBe('America/Argentina/Cordoba');
    expect(STORE_HOURS_TEXT).toEqual({
      weekday: 'Lunes a sábado de 8:00 a 14:00 y de 17:30 a 21:30',
      sunday: 'Domingos de 9:00 a 14:00',
    });
    expect(ORDER_CUTOFF_LABEL).toBe('19:00');
  });

  it('hay ventanas para los 7 días', () => {
    expect(Object.keys(OPENING_WINDOWS).map(Number).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('OpeningHoursSpecification agrupa los días con la misma ventana', () => {
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    expect(getOpeningHoursSpecification()).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: weekdays, opens: '08:00', closes: '14:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: weekdays, opens: '17:30', closes: '21:30' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Sunday'], opens: '09:00', closes: '14:00' },
    ]);
  });
});

describe('getArgentinaParts', () => {
  it('convierte a la fecha y hora de Córdoba', () => {
    expect(getArgentinaParts(new Date('2026-10-05T15:00:00Z'))).toEqual({ date: '2026-10-05', dayIndex: 1, minutesOfDay: 720 });
  });

  it('a las 02:59 UTC todavía es el día anterior en Córdoba', () => {
    expect(getArgentinaParts(new Date('2026-10-06T02:59:00Z'))).toEqual({ date: '2026-10-05', dayIndex: 1, minutesOfDay: 1439 });
    expect(getArgentinaParts(new Date('2026-10-06T03:00:00Z'))).toEqual({ date: '2026-10-06', dayIndex: 2, minutesOfDay: 0 });
  });

  it('fin de año y día bisiesto', () => {
    expect(getArgentinaParts(new Date('2027-01-01T02:00:00Z')).date).toBe('2026-12-31');
    expect(getArgentinaParts(at('2028-02-29T10:15:00'))).toEqual({ date: '2028-02-29', dayIndex: 2, minutesOfDay: 615 });
  });

  it('no depende de la zona horaria del servidor', () => {
    const instant = new Date('2026-10-06T02:30:00Z');
    for (const zone of ['UTC', 'Asia/Tokyo', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
      vi.stubEnv('TZ', zone);
      expect(getArgentinaParts(instant), zone).toEqual({ date: '2026-10-05', dayIndex: 1, minutesOfDay: 1410 });
    }
  });

  it('usa el reloj del sistema si no se pasa la hora', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-10-05T08:30:00'));
    expect(getArgentinaParts()).toEqual({ date: '2026-10-05', dayIndex: 1, minutesOfDay: 510 });
  });
});

describe('isStoreOpenNow', () => {
  it.each([
    ['2026-10-05T07:59:00', false],
    ['2026-10-05T08:00:00', true],
    ['2026-10-05T13:59:00', true],
    ['2026-10-05T14:00:00', false],
    ['2026-10-05T17:29:00', false],
    ['2026-10-05T17:30:00', true],
    ['2026-10-05T21:29:00', true],
    ['2026-10-05T21:30:00', false],
    ['2026-10-10T20:00:00', true], // sábado
    ['2026-10-11T08:59:00', false], // domingo
    ['2026-10-11T09:00:00', true],
    ['2026-10-11T13:59:00', true],
    ['2026-10-11T14:00:00', false],
    ['2026-10-11T18:00:00', false],
  ])('%s (hora de Córdoba) → %s', (local, open) => {
    expect(isStoreOpenNow(at(local))).toBe(open);
  });
});

describe('isPastOrderCutoff', () => {
  it.each([
    ['2026-10-05T00:00:00', false],
    ['2026-10-05T18:59:00', false],
    ['2026-10-05T19:00:00', true],
    ['2026-10-05T23:59:00', true],
  ])('%s → %s', (local, past) => {
    expect(isPastOrderCutoff(at(local))).toBe(past);
  });
});
