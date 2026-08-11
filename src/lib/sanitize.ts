/**
 * Limpieza de datos que entran por request antes de guardarlos.
 *
 * Prisma ya parametriza todas las consultas, así que esto NO es contra inyección
 * SQL (esa está cubierta por el driver). Sirve para otra cosa: que no entren a la
 * base cadenas gigantes, caracteres de control, bytes nulos o texto invisible que
 * después rompe el panel, el mensaje de WhatsApp o el JSON-LD.
 */

// Se construyen con RegExp + códigos numéricos en vez de escribir los caracteres
// literales en el archivo: así el fuente queda legible y no lleva bytes de control.
function charRange(from: number, to: number) {
  return `\\u${from.toString(16).padStart(4, '0')}-\\u${to.toString(16).padStart(4, '0')}`;
}

/** Caracteres de control C0/C1, salvo tab (09), salto de línea (0A) y retorno (0D). */
const CONTROL_CHARS = new RegExp(
  `[${charRange(0x00, 0x08)}\\u000b\\u000c${charRange(0x0e, 0x1f)}${charRange(0x7f, 0x9f)}]`,
  'g',
);

/** Invisibles usados para disfrazar texto: zero-width, overrides de dirección y BOM. */
const INVISIBLE_CHARS = new RegExp(
  `[${charRange(0x200b, 0x200f)}${charRange(0x202a, 0x202e)}${charRange(0x2060, 0x2064)}\\ufeff]`,
  'g',
);

export type SanitizeTextOptions = {
  maxLength: number;
  /** Si es true, colapsa cualquier espacio en blanco (incluidos saltos) a un espacio. */
  singleLine?: boolean;
};

/**
 * Devuelve el texto limpio, o null si lo que llegó no era un string.
 * No lanza: el que llama decide si un vacío es error.
 */
export function sanitizeText(value: unknown, options: SanitizeTextOptions): string | null {
  if (typeof value !== 'string') return null;

  let clean = value
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '');

  if (options.singleLine) {
    clean = clean.replace(/\s+/g, ' ');
  }

  clean = clean.trim();

  if (clean.length > options.maxLength) {
    clean = clean.slice(0, options.maxLength).trim();
  }

  return clean;
}

/**
 * Número finito dentro de un rango. Devuelve null si no es válido.
 * Rechaza NaN, Infinity y strings vacíos (que Number() convertiría en 0).
 */
export function sanitizeNumber(value: unknown, options: { min: number; max: number; decimals?: number }): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < options.min || parsed > options.max) return null;

  if (options.decimals === undefined) return parsed;
  return Number(parsed.toFixed(options.decimals));
}

/** Entero positivo (ids de rutas y de carrito). */
export function sanitizeId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > Number.MAX_SAFE_INTEGER) return null;
  return parsed;
}
