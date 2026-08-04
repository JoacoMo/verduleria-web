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

  const rounded = Math.round(quantity / step) * step;
  return Number(rounded.toFixed(2));
}