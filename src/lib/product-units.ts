export const PRODUCT_UNITS = ['kg', 'g', 'unidad'] as const;

export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  kg: 'kg',
  g: 'g',
  unidad: 'unidad',
};

export const PRODUCT_DEFAULT_CART_QUANTITY: Record<ProductUnit, number> = {
  kg: 1,
  g: 100,
  unidad: 1,
};

export const PRODUCT_CART_STEP: Record<ProductUnit, number> = {
  kg: 0.25,
  g: 100,
  unidad: 1,
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
};

/** Precisión mínima para cantidades en kilos (50 g). */
const KG_PRECISION = 0.05;

export function isProductUnit(value: unknown): value is ProductUnit {
  return typeof value === 'string' && PRODUCT_UNITS.includes(value as ProductUnit);
}

export function formatProductQuantity(quantity: number, unit: ProductUnit) {
  if (unit === 'kg') {
    const formatted = Number.isInteger(quantity) ? quantity.toFixed(0) : quantity.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${formatted} kg`;
  }

  if (unit === 'g') {
    return `${Math.round(quantity)} g`;
  }

  return `${Math.round(quantity)} unidad${Math.round(quantity) === 1 ? '' : 'es'}`;
}

export function normalizeProductQuantity(quantity: number, unit: ProductUnit) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }

  const step = PRODUCT_CART_STEP[unit];
  if (unit === 'g' || unit === 'unidad') {
    return Math.max(step, Math.round(quantity / step) * step);
  }

  // Lo que va por kilo NO se redondea al paso del botón (250 g): en el carrito
  // se puede pasar a gramos y pedir 300 g o 100 g. Antes el servidor lo llevaba a
  // 250 g y 0 g respectivamente (y una línea de 0 se descartaba del pedido).
  // Se redondea a 50 g, que es la precisión real de una balanza de verdulería.
  const rounded = Math.round(quantity / KG_PRECISION) * KG_PRECISION;
  return Math.max(KG_PRECISION, Number(rounded.toFixed(2)));
}