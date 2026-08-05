const TIMEZONE = 'America/Argentina/Cordoba';
const ORDER_CUTOFF_MINUTES = 19 * 60;

// Ventanas de atención en minutos desde las 00:00, por día (0 = domingo).
// Si cambian los horarios del local, actualizar acá además de
// STORE_WEEKDAY_HOURS / STORE_SUNDAY_HOURS en .env (que son solo el texto que se muestra).
const OPENING_WINDOWS: Record<number, Array<[number, number]>> = {
  0: [[9 * 60, 14 * 60]],
  1: [[8 * 60, 14 * 60], [17 * 60 + 30, 21 * 60 + 30]],
  2: [[8 * 60, 14 * 60], [17 * 60 + 30, 21 * 60 + 30]],
  3: [[8 * 60, 14 * 60], [17 * 60 + 30, 21 * 60 + 30]],
  4: [[8 * 60, 14 * 60], [17 * 60 + 30, 21 * 60 + 30]],
  5: [[8 * 60, 14 * 60], [17 * 60 + 30, 21 * 60 + 30]],
  6: [[8 * 60, 14 * 60], [17 * 60 + 30, 21 * 60 + 30]],
};

function getArgentinaNowMinutes() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const weekdayShort = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayShort);

  return { dayIndex, minutesOfDay: hour * 60 + minute };
}

export function isStoreOpenNow(): boolean {
  const { dayIndex, minutesOfDay } = getArgentinaNowMinutes();
  const windows = OPENING_WINDOWS[dayIndex] ?? [];
  return windows.some(([start, end]) => minutesOfDay >= start && minutesOfDay < end);
}

export function isPastOrderCutoff(): boolean {
  return getArgentinaNowMinutes().minutesOfDay >= ORDER_CUTOFF_MINUTES;
}
