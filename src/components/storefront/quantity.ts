import {
  PRODUCT_CART_STEP,
  PRODUCT_MAX_CART_QUANTITY,
  isWeightUnit,
  normalizeProductQuantity,
  type ProductUnit,
} from '@/lib/product-units';

/**
 * Conversión entre la unidad del producto y la unidad en la que el cliente ve la
 * cantidad en el carrito. Solo lo que va por peso se puede ver en kilos o en
 * gramos; atado, bandeja y unidad son siempre enteros en su propia unidad.
 */
export function toDisplayQuantity(quantity: number, unit: ProductUnit, displayUnit: ProductUnit) {
  if (unit === 'kg' && displayUnit === 'g') return Math.round(quantity * 1000);
  if (unit === 'g' && displayUnit === 'kg') return Number((quantity / 1000).toFixed(3));
  return quantity;
}

export function fromDisplayQuantity(displayQuantity: number, unit: ProductUnit, displayUnit: ProductUnit) {
  if (unit === 'kg' && displayUnit === 'g') return displayQuantity / 1000;
  if (unit === 'g' && displayUnit === 'kg') return displayQuantity * 1000;
  return displayQuantity;
}

/** La unidad de visualización solo puede diferir de la del producto en lo que va por peso. */
export function resolveDisplayUnit(unit: ProductUnit, preferred: ProductUnit | undefined): ProductUnit {
  if (!isWeightUnit(unit) || !preferred || !isWeightUnit(preferred)) return unit;
  return preferred;
}

/** Normaliza (paso de la balanza / enteros) y recorta al tope por producto. */
export function clampQuantity(quantity: number, unit: ProductUnit) {
  const normalized = normalizeProductQuantity(quantity, unit);
  return Math.min(normalized, PRODUCT_MAX_CART_QUANTITY[unit]);
}

/** Paso de los botones +/- en la unidad que está viendo el cliente. */
export function displayStep(displayUnit: ProductUnit) {
  return PRODUCT_CART_STEP[displayUnit];
}

/**
 * Lee lo que el cliente escribió a mano. Acepta coma decimal ("1,5"), que es lo
 * que sale del teclado numérico en un celular configurado en español.
 */
export function parseQuantityInput(text: string) {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
}

/** Valor para el campo de texto: "1,5" (sin la unidad, que va al lado). */
export function formatQuantityInput(quantity: number, displayUnit: ProductUnit) {
  if (displayUnit === 'kg') {
    return String(Number(quantity.toFixed(3))).replace('.', ',');
  }
  return String(Math.round(quantity));
}
