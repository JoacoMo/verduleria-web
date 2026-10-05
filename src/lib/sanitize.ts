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

/**
 * Invisibles usados para disfrazar texto: soft hyphen, marcas y overrides (LRE..RLO)
 * y aislamientos (LRI..PDI) de dirección —los que usa "Trojan Source"—, zero-width,
 * rellenos Hangul, tags Unicode y BOM. Con estos se podían cargar nombres que no
 * se ven en el panel ni en el mensaje de WhatsApp.
 */
const INVISIBLE_CHARS = new RegExp(
  `[\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180e${charRange(0x200b, 0x200f)}${charRange(0x202a, 0x202e)}${charRange(0x2060, 0x206f)}\\u3164\\ufeff\\uffa0]|\\udb40[\\udc00-\\udc7f]`,
  'g',
);

/**
 * Surrogates UTF-16 sueltos (medio emoji). Un string así no se puede pasar a
 * UTF-8: Prisma lo rechaza y el pedido terminaba en un 500. Se matchean primero
 * los pares (y se dejan) y después los sueltos (y se sacan).
 */
function dropLoneSurrogates(text: string) {
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (match) => (match.length === 2 ? match : ''));
}

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

  let clean = dropLoneSurrogates(value)
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '');

  if (options.singleLine) {
    clean = clean.replace(/\s+/g, ' ');
  }

  clean = clean.trim();

  if (clean.length > options.maxLength) {
    // Si el corte cae en medio de un emoji, se saca la mitad que quedó colgada.
    clean = clean.slice(0, options.maxLength).replace(/[\uD800-\uDBFF]$/, '').trim();
  }

  return clean;
}

// Decimal común con punto ("12", "-3.5", ".5"). Nada de "0x10", "0b11", "1e3" ni
// "Infinity": Number() los acepta y un valor pegado de otro lado terminaba
// guardado como un precio distinto sin dar error.
const DECIMAL_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * Número finito dentro de un rango. Devuelve null si no es válido.
 * Acepta un number o un string decimal simple; rechaza NaN, Infinity y vacíos.
 */
export function sanitizeNumber(value: unknown, options: { min: number; max: number; decimals?: number }): number | null {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && DECIMAL_TEXT.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isFinite(parsed)) return null;
  if (parsed < options.min || parsed > options.max) return null;

  if (options.decimals === undefined) return parsed;
  return Number(parsed.toFixed(options.decimals));
}

/** Tope de una columna Int de Postgres (INT4): un id mayor hacía fallar a Prisma con un 500. */
export const MAX_DB_INT = 2_147_483_647;

/**
 * Entero positivo que entra en un Int de la base (ids de rutas y de carrito).
 * Acepta solo un number o un string de dígitos: nada de true, [5], "0x10" ni "1e3",
 * que Number() convertía en ids válidos y pegaban en otro producto.
 */
export function sanitizeId(value: unknown): number | null {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && /^\d{1,10}$/.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    return null;
  }
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_DB_INT) return null;
  return parsed;
}
