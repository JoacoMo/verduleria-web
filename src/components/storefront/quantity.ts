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

/** "1.500" / "1,500" / "12.000.000": grupos de miles, sin decimales. */
const THOUSANDS_ONLY = /^\d{1,3}([.,]\d{3})+$/;
/** "1.500,5": miles con punto y coma decimal, como se escribe en la Argentina. */
const THOUSANDS_WITH_DECIMALS = /^\d{1,3}(\.\d{3})+,\d+$/;
/** Lo único que se acepta al final: dígitos con, a lo sumo, un punto decimal. */
const PLAIN_DECIMAL = /^(\d+\.?\d*|\.\d+)$/;

/**
 * Lee lo que el cliente escribió a mano, en la unidad que está viendo.
 *
 * - En kg vale la coma o el punto decimal: "1,5" y "1.5" son 1,5 kg (según el
 *   teclado del celular sale uno u otro). "1.500" también es 1,5 kg.
 * - En gramos y en unidades no hay decimales que tengan sentido, así que "1.500"
 *   o "1,500" son mil quinientos, como se escribe acá (antes quedaba en 1,5 g y
 *   se subía al mínimo de 50 g).
 * - "1.500,5" se lee como 1500,5 en cualquier unidad.
 *
 * Devuelve NaN si no es un número común (vacío, negativo, "1e3", "0x10"...).
 */
export function parseQuantityInput(text: string, displayUnit: ProductUnit) {
  let cleaned = text.trim().replace(/\s/g, '');
  if (!cleaned) return Number.NaN;

  if (THOUSANDS_WITH_DECIMALS.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (displayUnit !== 'kg' && THOUSANDS_ONLY.test(cleaned)) {
    cleaned = cleaned.replace(/[.,]/g, '');
  } else {
    cleaned = cleaned.replace(',', '.');
  }

  return PLAIN_DECIMAL.test(cleaned) ? Number(cleaned) : Number.NaN;
}

/** Valor para el campo de texto: "1,5" (sin la unidad, que va al lado). */
export function formatQuantityInput(quantity: number, displayUnit: ProductUnit) {
  if (displayUnit === 'kg') {
    return String(Number(quantity.toFixed(3))).replace('.', ',');
  }
  return String(Math.round(quantity));
}
