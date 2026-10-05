import { TIMEZONE, getArgentinaParts } from '@/lib/store-hours';
import type { ProductUnit } from '@/lib/product-units';

/**
 * Formatos y parseos chicos del panel. Todo en hora de Córdoba: el dueño mira
 * el panel desde el celular y "hoy" tiene que ser el hoy del local, no el del
 * servidor ni el de un navegador con la zona horaria mal configurada.
 */

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "YYYY-MM-DD" de hoy en Córdoba. */
export function getArgentinaToday(now: Date = new Date()) {
  return getArgentinaParts(now).date;
}

/** "YYYY-MM-DD" (hora argentina) de un instante ISO. */
export function toArgentinaDate(value: string | Date) {
  return getArgentinaParts(value instanceof Date ? value : new Date(value)).date;
}

/** Suma días a una fecha "YYYY-MM-DD" sin depender de la zona horaria del navegador. */
export function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** "lunes 6/10". */
export function describeDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${DAY_NAMES[weekday]} ${day}/${month}`;
}

/** "Hoy", "Ayer", "Mañana" o "lunes 6/10". */
export function describeDateRelative(date: string, today: string) {
  if (date === today) return 'Hoy';
  if (date === shiftDate(today, -1)) return 'Ayer';
  if (date === shiftDate(today, 1)) return 'Mañana';
  const text = describeDate(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const timeFormatter = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "10:42" (hora argentina), o null si la fecha no sirve. */
export function formatTime(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return timeFormatter.format(date);
}

function cleanNumberText(raw: string) {
  // Se aceptan "$", espacios y espacios duros: el dueño copia precios de la
  // lista del mayorista o de la propia tienda.
  return raw.replace(/[$\s ]/g, '');
}

/**
 * Monto tipeado a mano. Acepta la forma argentina ("1.500", "1.500,50",
 * "1500,5") y la de la calculadora ("1500.5").
 *
 * Devuelve null si está vacío y NaN si no es un número.
 */
export function parseMoneyInput(raw: string): number | null {
  const text = cleanNumberText(raw);
  if (!text) return null;

  let normalized = text;
  if (text.includes(',')) {
    // Con coma, la coma es el decimal y los puntos son separadores de miles.
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // "1.500" en una verdulería son mil quinientos pesos, no uno y medio.
    normalized = text.replace(/\./g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/**
 * Cantidad tipeada (kilos, gramos, unidades). Acá el punto y la coma son
 * siempre decimales: "1.250" en la balanza es un kilo y cuarto.
 *
 * Devuelve null si está vacío y NaN si no es un número.
 */
export function parseQuantityInput(raw: string): number | null {
  const text = cleanNumberText(raw);
  if (!text) return null;
  const normalized = text.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized) && !/^\.\d+$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/** Valor inicial de un input de cantidad: coma decimal en kilos, enteros en el resto. */
export function formatQuantityInput(quantity: number, unit: ProductUnit) {
  if (unit === 'kg') {
    return String(Number(quantity.toFixed(2))).replace('.', ',');
  }
  return String(Math.round(quantity));
}

/** Valor inicial de un input de precio ("1500" o "1499,5"). */
export function formatMoneyInput(amount: number | null | undefined) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '';
  return String(amount).replace('.', ',');
}

/** Búsqueda de Google Maps para la dirección de un envío (el reparto se arma con esto). */
export function mapsSearchUrl(address: string, city = 'Córdoba, Argentina') {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, ${city}`)}`;
}

/** Primer nombre para el saludo ("Ana María Pérez" → "Ana"). */
export function firstName(fullName: string | null | undefined) {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}
