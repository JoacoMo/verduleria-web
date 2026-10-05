/**
 * Unidades de venta: ÚNICA fuente de verdad para cantidades en toda la app.
 *
 * Hay dos familias:
 * - Por peso (kg, g): admiten fracciones y en el carrito se pueden ver en kilos
 *   o en gramos. El total es estimado hasta que se pesa el pedido.
 * - Por cantidad (unidad, atado, bandeja): siempre números enteros.
 */
export const PRODUCT_UNITS = ['kg', 'g', 'unidad', 'atado', 'bandeja'] as const;

export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const WEIGHT_UNITS = ['kg', 'g'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/** Etiqueta corta para "$ 800 / kg". */
export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  kg: 'kg',
  g: 'g',
  unidad: 'unidad',
  atado: 'atado',
  bandeja: 'bandeja',
};

/** Nombre para el formulario del panel ("Kilo", "Atado"). */
export const PRODUCT_UNIT_NAMES: Record<ProductUnit, string> = {
  kg: 'Kilo',
  g: 'Gramo',
  unidad: 'Unidad',
  atado: 'Atado',
  bandeja: 'Bandeja',
};

export const PRODUCT_DEFAULT_CART_QUANTITY: Record<ProductUnit, number> = {
  kg: 1,
  g: 100,
  unidad: 1,
  atado: 1,
  bandeja: 1,
};

/** Paso de los botones +/-. */
export const PRODUCT_CART_STEP: Record<ProductUnit, number> = {
  kg: 0.25,
  g: 100,
  unidad: 1,
  atado: 1,
  bandeja: 1,
};

/**
 * Tope por producto en un mismo pedido. Es una verdulería de barrio: nadie pide
 * 400 kg de tomate por la web. Sirve para que nadie pueda inflar un pedido con
 * cantidades absurdas mandando el request a mano.
 */
export const PRODUCT_MAX_CART_QUANTITY: Record<ProductUnit, number> = {
  kg: 100,
  g: 50000,
  unidad: 200,
  atado: 100,
  bandeja: 100,
};

/** Código UN/CEFACT para schema.org (KGM = kilo, GRM = gramo, C62 = unidad). */
export const PRODUCT_UNIT_CODES: Record<ProductUnit, string> = {
  kg: 'KGM',
  g: 'GRM',
  unidad: 'C62',
  atado: 'C62',
  bandeja: 'C62',
};

/**
 * Precisión real de una balanza de verdulería (50 g). Lo que va por peso NO se
 * redondea al paso del botón (250 g / 100 g): en el carrito se puede pasar a
 * gramos y pedir 300 g o 350 g. Antes el servidor lo llevaba a 250 g (o a 0 g, y
 * esa línea se descartaba del pedido).
 */
const KG_PRECISION = 0.05;
const G_PRECISION = 50;

const PLURALS: Record<'unidad' | 'atado' | 'bandeja', [string, string]> = {
  unidad: ['unidad', 'unidades'],
  atado: ['atado', 'atados'],
  bandeja: ['bandeja', 'bandejas'],
};

export function isProductUnit(value: unknown): value is ProductUnit {
  return typeof value === 'string' && PRODUCT_UNITS.includes(value as ProductUnit);
}

/** kg o g: se vende por peso, el total final depende de la balanza. */
export function isWeightUnit(unit: ProductUnit): unit is WeightUnit {
  return unit === 'kg' || unit === 'g';
}

export function formatProductQuantity(quantity: number, unit: ProductUnit) {
  if (unit === 'kg') {
    const formatted = Number.isInteger(quantity) ? quantity.toFixed(0) : quantity.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${formatted.replace('.', ',')} kg`;
  }

  if (unit === 'g') {
    return `${Math.round(quantity)} g`;
  }

  const count = Math.round(quantity);
  const [singular, plural] = PLURALS[unit];
  return `${count} ${count === 1 ? singular : plural}`;
}

export function normalizeProductQuantity(quantity: number, unit: ProductUnit) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }

  if (unit === 'kg') {
    const rounded = Math.round(quantity / KG_PRECISION) * KG_PRECISION;
    return Math.max(KG_PRECISION, Number(rounded.toFixed(2)));
  }

  if (unit === 'g') {
    return Math.max(G_PRECISION, Math.round(quantity / G_PRECISION) * G_PRECISION);
  }

  return Math.max(1, Math.round(quantity));
}

/** Peso aproximado en kilos de una línea (0 para lo que va por cantidad). */
export function lineWeightKg(line: { unit: ProductUnit; quantity: number }) {
  if (line.unit === 'kg') return line.quantity;
  if (line.unit === 'g') return line.quantity / 1000;
  return 0;
}
