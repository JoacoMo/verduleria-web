import { OPENING_WINDOWS, formatMinutes, getArgentinaParts } from './store-hours';

/**
 * Turnos de entrega a domicilio.
 *
 * El local reparte en dos franjas fijas. Un turno se ofrece un día solo si cae
 * dentro del horario de atención de ese día (así el domingo, que se cierra a las
 * 14, solo aparece el de 13 a 14) y si todavía falta al menos
 * SLOT_ORDER_LEAD_MINUTES para que empiece, que es el tiempo de armar el pedido.
 *
 * El id del turno es "YYYY-MM-DDTHH" (ej. "2026-10-06T13"): legible en la base y
 * fácil de validar en el servidor recalculando la lista de turnos disponibles.
 */
export const DELIVERY_WINDOWS: Array<{ start: number; end: number }> = [
  { start: 13 * 60, end: 14 * 60 },
  { start: 19 * 60, end: 20 * 60 },
];

/** Con cuánta anticipación mínima hay que pedir para un turno (en minutos). */
export const SLOT_ORDER_LEAD_MINUTES = 60;

/** Hasta cuántos días para adelante se ofrecen turnos. */
const MAX_DAYS_AHEAD = 7;

export type DeliverySlot = {
  id: string;
  /** "YYYY-MM-DD" (hora argentina). */
  date: string;
  start: number;
  end: number;
  /** "Hoy de 13 a 14 h", "Mañana de 19 a 20 h", "Jueves 9/10 de 13 a 14 h". */
  label: string;
};

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function windowLabel(start: number, end: number) {
  const short = (minutes: number) => (minutes % 60 === 0 ? String(minutes / 60) : formatMinutes(minutes));
  return `de ${short(start)} a ${short(end)} h`;
}

/** Suma días a una fecha "YYYY-MM-DD" sin depender de la zona horaria del servidor. */
function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    date: shifted.toISOString().slice(0, 10),
    dayIndex: shifted.getUTCDay(),
    dayOfMonth: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
  };
}

function dayLabel(offset: number, dayIndex: number, dayOfMonth: number, month: number) {
  if (offset === 0) return 'Hoy';
  if (offset === 1) return 'Mañana';
  return `${DAY_NAMES[dayIndex]} ${dayOfMonth}/${month}`;
}

function isWithinOpeningHours(dayIndex: number, start: number, end: number) {
  return (OPENING_WINDOWS[dayIndex] ?? []).some(([open, close]) => start >= open && end <= close);
}

/** Próximos turnos que todavía se pueden elegir, en orden. */
export function getUpcomingSlots(now: Date = new Date(), count = 4): DeliverySlot[] {
  const today = getArgentinaParts(now);
  const slots: DeliverySlot[] = [];

  for (let offset = 0; offset <= MAX_DAYS_AHEAD && slots.length < count; offset += 1) {
    const day = addDays(today.date, offset);
    for (const { start, end } of DELIVERY_WINDOWS) {
      if (!isWithinOpeningHours(day.dayIndex, start, end)) continue;
      if (offset === 0 && today.minutesOfDay > start - SLOT_ORDER_LEAD_MINUTES) continue;

      slots.push({
        id: `${day.date}T${String(Math.floor(start / 60)).padStart(2, '0')}`,
        date: day.date,
        start,
        end,
        label: `${dayLabel(offset, day.dayIndex, day.dayOfMonth, day.month)} ${windowLabel(start, end)}`,
      });
      if (slots.length >= count) break;
    }
  }

  return slots;
}

/** El turno elegido sigue disponible (se valida en el servidor al hacer el pedido). */
export function findAvailableSlot(slotId: unknown, now: Date = new Date()): DeliverySlot | null {
  if (typeof slotId !== 'string') return null;
  return getUpcomingSlots(now, 2 * DELIVERY_WINDOWS.length * (MAX_DAYS_AHEAD + 1)).find((slot) => slot.id === slotId) ?? null;
}

const SLOT_ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/;

/**
 * Texto de un turno ya guardado ("Lunes 6/10 de 13 a 14 h"), para el panel y los
 * mensajes. No mira si el turno sigue vigente.
 */
export function describeSlot(slotId: string | null | undefined): string | null {
  if (!slotId) return null;
  const match = SLOT_ID_PATTERN.exec(slotId);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  const window = DELIVERY_WINDOWS.find((item) => item.start === Number(hour) * 60);
  if (!window) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return `${DAY_NAMES[date.getUTCDay()]} ${Number(day)}/${Number(month)} ${windowLabel(window.start, window.end)}`;
}

/** "13 a 14 h y 19 a 20 h", para textos informativos. */
export const DELIVERY_WINDOWS_TEXT = DELIVERY_WINDOWS
  .map(({ start, end }) => windowLabel(start, end).replace(/^de /, ''))
  .join(' y ');
