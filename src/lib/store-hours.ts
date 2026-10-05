/**
 * Horarios del local: ÚNICA fuente de verdad.
 *
 * Antes los horarios estaban en tres lugares (texto en .env, estas ventanas y el
 * JSON-LD de la home) y podían contradecirse. Ahora todo se deriva de acá: el
 * texto que se muestra, los datos estructurados para Google, el "Abierto ahora" y
 * los turnos de entrega (src/lib/delivery-slots.ts).
 */
export const TIMEZONE = 'America/Argentina/Cordoba';

/** Ventana de atención en minutos desde las 00:00. */
export type TimeWindow = [start: number, end: number];

const WEEKDAY_WINDOWS: TimeWindow[] = [[8 * 60, 14 * 60], [17 * 60 + 30, 21 * 60 + 30]];
const SUNDAY_WINDOWS: TimeWindow[] = [[9 * 60, 14 * 60]];

// Por día (0 = domingo). Si cambian los horarios del local, se cambian acá y
// nada más.
export const OPENING_WINDOWS: Record<number, TimeWindow[]> = {
  0: SUNDAY_WINDOWS,
  1: WEEKDAY_WINDOWS,
  2: WEEKDAY_WINDOWS,
  3: WEEKDAY_WINDOWS,
  4: WEEKDAY_WINDOWS,
  5: WEEKDAY_WINDOWS,
  6: WEEKDAY_WINDOWS,
};

/** Pasados estos minutos del día, un pedido para retirar se prepara al día siguiente. */
const ORDER_CUTOFF_MINUTES = 19 * 60;

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

/** "19:00" para mostrar en la tienda. */
export const ORDER_CUTOFF_LABEL = formatMinutes(ORDER_CUTOFF_MINUTES);

function describeWindows(windows: TimeWindow[]) {
  return windows.map(([start, end]) => `de ${formatMinutes(start)} a ${formatMinutes(end)}`).join(' y ');
}

/** Texto de horarios para mostrar ("Lunes a sábado de 8:00 a 14:00 y de 17:30 a 21:30"). */
export const STORE_HOURS_TEXT = {
  weekday: `Lunes a sábado ${describeWindows(WEEKDAY_WINDOWS)}`,
  sunday: `Domingos ${describeWindows(SUNDAY_WINDOWS)}`,
};

const SCHEMA_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toHHMM(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Horarios en formato schema.org (OpeningHoursSpecification), agrupando los días
 * que comparten la misma ventana.
 */
export function getOpeningHoursSpecification() {
  const byWindow = new Map<string, { days: string[]; opens: string; closes: string }>();
  for (let day = 1; day <= 7; day += 1) {
    const dayIndex = day % 7; // lunes primero, domingo al final
    for (const [start, end] of OPENING_WINDOWS[dayIndex] ?? []) {
      const key = `${start}-${end}`;
      const entry = byWindow.get(key) ?? { days: [], opens: toHHMM(start), closes: toHHMM(end) };
      entry.days.push(SCHEMA_DAY_NAMES[dayIndex]);
      byWindow.set(key, entry);
    }
  }
  return [...byWindow.values()].map((entry) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: entry.days,
    opens: entry.opens,
    closes: entry.closes,
  }));
}

export type ArgentinaDateParts = {
  /** "YYYY-MM-DD" en hora argentina. */
  date: string;
  /** 0 = domingo. */
  dayIndex: number;
  minutesOfDay: number;
};

/** Fecha, día de la semana y minutos del día en Córdoba para un instante dado. */
export function getArgentinaParts(at: Date = new Date()): ArgentinaDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    dayIndex,
    minutesOfDay: hour * 60 + minute,
  };
}

export function isStoreOpenNow(at: Date = new Date()): boolean {
  const { dayIndex, minutesOfDay } = getArgentinaParts(at);
  const windows = OPENING_WINDOWS[dayIndex] ?? [];
  return windows.some(([start, end]) => minutesOfDay >= start && minutesOfDay < end);
}

export function isPastOrderCutoff(at: Date = new Date()): boolean {
  return getArgentinaParts(at).minutesOfDay >= ORDER_CUTOFF_MINUTES;
}
