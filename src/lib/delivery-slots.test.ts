import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DELIVERY_WINDOWS,
  DELIVERY_WINDOWS_TEXT,
  SLOT_ORDER_LEAD_MINUTES,
  describeSlot,
  findAvailableSlot,
  getUpcomingSlots,
} from './delivery-slots';

/**
 * Córdoba es UTC-3 todo el año: la hora local L es L+3 en UTC. Las fechas se
 * escriben con offset explícito para que se lea la hora del local.
 */
const at = (localIso: string) => new Date(`${localIso}-03:00`);

const ids = (now: Date, count?: number) => getUpcomingSlots(now, count).map((slot) => slot.id);
const labels = (now: Date, count?: number) => getUpcomingSlots(now, count).map((slot) => slot.label);

afterEach(() => {
  vi.useRealTimers();
});

describe('configuración', () => {
  it('dos franjas fijas y una hora de anticipación', () => {
    expect(DELIVERY_WINDOWS).toEqual([{ start: 780, end: 840 }, { start: 1140, end: 1200 }]);
    expect(SLOT_ORDER_LEAD_MINUTES).toBe(60);
    expect(DELIVERY_WINDOWS_TEXT).toBe('13 a 14 h y 19 a 20 h');
  });
});

describe('getUpcomingSlots: anticipación mínima en el borde (lunes 5/10/2026)', () => {
  it('11:59 → todavía entra el turno de las 13', () => {
    expect(ids(at('2026-10-05T11:59:00'))).toEqual(['2026-10-05T13', '2026-10-05T19', '2026-10-06T13', '2026-10-06T19']);
    expect(labels(at('2026-10-05T11:59:00'))).toEqual([
      'Hoy de 13 a 14 h',
      'Hoy de 19 a 20 h',
      'Mañana de 13 a 14 h',
      'Mañana de 19 a 20 h',
    ]);
  });

  it('12:00 en punto → el turno de las 13 sigue disponible (falta exactamente una hora)', () => {
    expect(ids(at('2026-10-05T12:00:00'))[0]).toBe('2026-10-05T13');
  });

  it('12:00:59 → la granularidad es de minutos: sigue disponible', () => {
    expect(ids(at('2026-10-05T12:00:59.999'))[0]).toBe('2026-10-05T13');
  });

  it('12:01 → el turno de las 13 ya no se ofrece', () => {
    expect(ids(at('2026-10-05T12:01:00'))[0]).toBe('2026-10-05T19');
  });

  it('17:59 y 18:00 → entra el de las 19', () => {
    expect(ids(at('2026-10-05T17:59:00'))[0]).toBe('2026-10-05T19');
    expect(ids(at('2026-10-05T18:00:00'))[0]).toBe('2026-10-05T19');
  });

  it('18:01 → el próximo es mañana a las 13', () => {
    expect(ids(at('2026-10-05T18:01:00'))).toEqual(['2026-10-06T13', '2026-10-06T19', '2026-10-07T13', '2026-10-07T19']);
    expect(labels(at('2026-10-05T18:01:00'), 3)).toEqual(['Mañana de 13 a 14 h', 'Mañana de 19 a 20 h', 'Miércoles 7/10 de 13 a 14 h']);
  });
});

describe('getUpcomingSlots: domingo, cambio de día y de año', () => {
  it('el domingo (cierra a las 14) solo tiene el turno de 13 a 14', () => {
    expect(ids(at('2026-10-11T10:00:00'))).toEqual(['2026-10-11T13', '2026-10-12T13', '2026-10-12T19', '2026-10-13T13']);
  });

  it('sábado a la noche: domingo solo al mediodía y después el lunes con fecha', () => {
    expect(labels(at('2026-10-10T19:30:00'))).toEqual([
      'Mañana de 13 a 14 h',
      'Lunes 12/10 de 13 a 14 h',
      'Lunes 12/10 de 19 a 20 h',
      'Martes 13/10 de 13 a 14 h',
    ]);
  });

  it('domingo después de las 12: ya no hay turnos ese día', () => {
    expect(ids(at('2026-10-11T12:01:00'))[0]).toBe('2026-10-12T13');
  });

  it('23:59 (en UTC ya es el día siguiente): el día sigue siendo el de Córdoba', () => {
    const now = at('2026-10-05T23:59:00');
    expect(now.toISOString()).toBe('2026-10-06T02:59:00.000Z');
    expect(getUpcomingSlots(now, 1)[0]).toMatchObject({ id: '2026-10-06T13', date: '2026-10-06', label: 'Mañana de 13 a 14 h' });
  });

  it('medianoche: el día nuevo arranca con sus dos turnos como "Hoy"', () => {
    expect(getUpcomingSlots(at('2026-10-06T00:00:00'), 2).map((slot) => [slot.id, slot.label])).toEqual([
      ['2026-10-06T13', 'Hoy de 13 a 14 h'],
      ['2026-10-06T19', 'Hoy de 19 a 20 h'],
    ]);
  });

  it('cambio de año', () => {
    expect(getUpcomingSlots(at('2026-12-31T20:00:00'), 3).map((slot) => [slot.id, slot.label])).toEqual([
      ['2027-01-01T13', 'Mañana de 13 a 14 h'],
      ['2027-01-01T19', 'Mañana de 19 a 20 h'],
      ['2027-01-02T13', 'Sábado 2/1 de 13 a 14 h'],
    ]);
  });

  it('respeta la cantidad pedida', () => {
    expect(getUpcomingSlots(at('2026-10-05T08:00:00'), 1)).toHaveLength(1);
    expect(getUpcomingSlots(at('2026-10-05T08:00:00'), 0)).toEqual([]);
    expect(getUpcomingSlots(at('2026-10-05T08:00:00'))).toHaveLength(4);
  });

  it('usa el reloj del sistema si no se pasa la hora', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-10-05T12:30:00'));
    expect(getUpcomingSlots()[0].id).toBe('2026-10-05T19');
  });
});

describe('servidor en otra zona horaria (process.env.TZ)', () => {
  const zones = ['UTC', 'Asia/Tokyo', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Europe/Madrid'];
  const instants = ['2026-10-05T11:59:00', '2026-10-05T12:01:00', '2026-10-05T23:59:00', '2026-10-06T00:00:00', '2026-10-10T19:30:00'];

  it('los turnos no dependen de la zona del servidor', () => {
    const expected = instants.map((local) => ids(at(local)));
    const offsets = new Set<number>();
    for (const zone of zones) {
      vi.stubEnv('TZ', zone);
      // Prueba de que el cambio de TZ de verdad le llegó al proceso.
      offsets.add(new Date(2026, 0, 1).getTimezoneOffset());
      expect(instants.map((local) => ids(at(local))), zone).toEqual(expected);
      expect(describeSlot('2026-10-05T13'), zone).toBe('Lunes 5/10 de 13 a 14 h');
      expect(findAvailableSlot('2026-10-05T19', at('2026-10-05T17:00:00'))?.label, zone).toBe('Hoy de 19 a 20 h');
    }
    expect(offsets.size).toBeGreaterThan(1);
  });
});

describe('findAvailableSlot', () => {
  const now = at('2026-10-05T12:00:00');

  it('encuentra un turno vigente', () => {
    expect(findAvailableSlot('2026-10-05T13', now)).toEqual({
      id: '2026-10-05T13',
      date: '2026-10-05',
      start: 780,
      end: 840,
      label: 'Hoy de 13 a 14 h',
    });
  });

  it('llega hasta 7 días para adelante, no 8', () => {
    expect(findAvailableSlot('2026-10-12T19', now)?.label).toBe('Lunes 12/10 de 19 a 20 h');
    expect(findAvailableSlot('2026-10-13T13', now)).toBeNull();
  });

  it('rechaza turnos pasados, de ayer, inexistentes o mal escritos', () => {
    expect(findAvailableSlot('2026-10-05T13', at('2026-10-05T12:01:00'))).toBeNull();
    expect(findAvailableSlot('2026-10-04T13', now)).toBeNull();
    expect(findAvailableSlot('2026-10-05T15', now)).toBeNull();
    expect(findAvailableSlot('2026-10-11T19', now)).toBeNull(); // domingo a la noche
    expect(findAvailableSlot('2026-10-05T13:00', now)).toBeNull();
    expect(findAvailableSlot(' 2026-10-05T13', now)).toBeNull();
    expect(findAvailableSlot('', now)).toBeNull();
    expect(findAvailableSlot(null, now)).toBeNull();
    expect(findAvailableSlot(undefined, now)).toBeNull();
    expect(findAvailableSlot(20261005, now)).toBeNull();
    expect(findAvailableSlot({ id: '2026-10-05T13' }, now)).toBeNull();
  });
});

describe('describeSlot', () => {
  it('describe un turno guardado con día de la semana y fecha', () => {
    expect(describeSlot('2026-10-05T13')).toBe('Lunes 5/10 de 13 a 14 h');
    expect(describeSlot('2026-10-11T19')).toBe('Domingo 11/10 de 19 a 20 h');
    expect(describeSlot('2027-01-01T13')).toBe('Viernes 1/1 de 13 a 14 h');
  });

  it('null para vacío, formato inválido u hora que no es un turno', () => {
    expect(describeSlot(null)).toBeNull();
    expect(describeSlot(undefined)).toBeNull();
    expect(describeSlot('')).toBeNull();
    expect(describeSlot('mañana')).toBeNull();
    expect(describeSlot('2026-10-05T14')).toBeNull();
    expect(describeSlot('2026-10-05')).toBeNull();
  });
});
