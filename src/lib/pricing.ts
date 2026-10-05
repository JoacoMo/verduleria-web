import { PRODUCT_MAX_CART_QUANTITY, normalizeProductQuantity, type ProductUnit } from './product-units';

/**
 * Cálculo de precios: ÚNICA fuente de verdad para el navegador y el servidor.
 *
 * El carrito usa estas funciones para mostrar el total al instante, y el checkout
 * las vuelve a correr en el servidor con los precios de la base: lo que diga el
 * navegador nunca define cuánto se cobra.
 *
 * Son funciones puras (reciben la configuración y la hora como parámetros) para
 * poder testearlas sin base ni reloj.
 */

export type PricedProduct = {
  id: number;
  name: string;
  price: number;
  unit: ProductUnit;
  available: boolean;
  offerPrice?: number | null;
  /** ISO 8601. null/undefined = la oferta no vence. */
  offerEndsAt?: string | Date | null;
};

export type OrderLine = {
  id: number;
  name: string;
  /** Precio unitario efectivamente cobrado (con oferta si estaba vigente). */
  price: number;
  quantity: number;
  unit: ProductUnit;
};

export type ShippingConfig = {
  /** Costo fijo del envío. */
  deliveryFee: number;
  /** Desde este subtotal el envío es gratis. */
  deliveryFreeThreshold: number;
  /** Subtotal mínimo para pedir con envío. */
  deliveryMinPurchase: number;
};

/** Redondeo a centavos para que 0,1 + 0,2 no termine en 0,30000000000000004. */
export function roundMoney(amount: number) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** La oferta está vigente: hay precio de oferta, es menor al normal y no venció. */
export function isOfferActive(product: Pick<PricedProduct, 'price' | 'offerPrice' | 'offerEndsAt'>, now: Date = new Date()) {
  const { offerPrice, offerEndsAt, price } = product;
  if (offerPrice === null || offerPrice === undefined || !Number.isFinite(offerPrice)) return false;
  if (offerPrice < 0 || offerPrice >= price) return false;
  if (offerEndsAt) {
    const endsAt = offerEndsAt instanceof Date ? offerEndsAt : new Date(offerEndsAt);
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= now.getTime()) return false;
  }
  return true;
}

/** Precio que se cobra hoy por la unidad de venta. */
export function getEffectivePrice(product: Pick<PricedProduct, 'price' | 'offerPrice' | 'offerEndsAt'>, now: Date = new Date()) {
  return isOfferActive(product, now) ? (product.offerPrice as number) : product.price;
}

/** Porcentaje de descuento redondeado, para el cartel "-15%". */
export function getDiscountPercent(product: Pick<PricedProduct, 'price' | 'offerPrice' | 'offerEndsAt'>, now: Date = new Date()) {
  if (!isOfferActive(product, now) || product.price <= 0) return 0;
  return Math.round((1 - (product.offerPrice as number) / product.price) * 100);
}

export function lineTotal(line: Pick<OrderLine, 'price' | 'quantity'>) {
  return roundMoney(line.price * line.quantity);
}

export function sumLines(lines: Array<Pick<OrderLine, 'price' | 'quantity'>>) {
  return roundMoney(lines.reduce((sum, line) => sum + lineTotal(line), 0));
}

/** Costo de envío para un subtotal: 0 si es retiro o si supera el umbral de envío gratis. */
export function getShippingCost(subtotal: number, isDelivery: boolean, config: ShippingConfig) {
  if (!isDelivery) return 0;
  return subtotal >= config.deliveryFreeThreshold ? 0 : config.deliveryFee;
}

export type OrderTotals = {
  subtotal: number;
  shippingCost: number;
  total: number;
  /** Con envío y por debajo del mínimo: no se puede pedir así. */
  belowDeliveryMinimum: boolean;
  /** Cuánto falta para el envío gratis (0 si ya se llegó o si es retiro). */
  missingForFreeShipping: number;
};

export function computeTotals(lines: Array<Pick<OrderLine, 'price' | 'quantity'>>, isDelivery: boolean, config: ShippingConfig): OrderTotals {
  const subtotal = sumLines(lines);
  const shippingCost = getShippingCost(subtotal, isDelivery, config);
  return {
    subtotal,
    shippingCost,
    total: roundMoney(subtotal + shippingCost),
    belowDeliveryMinimum: isDelivery && subtotal < config.deliveryMinPurchase,
    missingForFreeShipping: isDelivery ? Math.max(0, roundMoney(config.deliveryFreeThreshold - subtotal)) : 0,
  };
}

export type CartRequestLine = { id: unknown; quantity: unknown };

export type BuildLinesResult = {
  lines: OrderLine[];
  /** Ids pedidos que no existen en el catálogo. */
  missingIds: number[];
  /** Productos pedidos que están marcados sin stock. */
  unavailable: PricedProduct[];
};

/**
 * Arma las líneas del pedido a partir de lo que mandó el navegador y del
 * catálogo vigente: precio efectivo del día, cantidad re-normalizada al paso de
 * la unidad y recortada al tope. Ids repetidos se toman una sola vez (gana la
 * primera aparición) y cantidades inválidas se descartan.
 */
export function buildOrderLines(cart: CartRequestLine[], products: PricedProduct[], now: Date = new Date()): BuildLinesResult {
  const byId = new Map(products.map((product) => [product.id, product]));
  const seen = new Set<number>();
  const lines: OrderLine[] = [];
  const missingIds: number[] = [];
  const unavailable: PricedProduct[] = [];

  for (const item of cart) {
    const id = Number(item?.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);

    const product = byId.get(id);
    if (!product) {
      missingIds.push(id);
      continue;
    }
    if (!product.available) {
      unavailable.push(product);
      continue;
    }

    const requested = typeof item.quantity === 'number' ? item.quantity : Number.NaN;
    const normalized = normalizeProductQuantity(requested, product.unit);
    if (normalized <= 0) continue;

    lines.push({
      id: product.id,
      name: product.name,
      price: getEffectivePrice(product, now),
      quantity: Math.min(normalized, PRODUCT_MAX_CART_QUANTITY[product.unit]),
      unit: product.unit,
    });
  }

  return { lines, missingIds, unavailable };
}

export type PriceChange = { id: number; name: string; previousPrice: number; currentPrice: number };

/**
 * Compara los precios que el cliente vio en el carrito con los que se cobrarían
 * ahora. Si el dueño cambió un precio (o venció una oferta) mientras el cliente
 * armaba el pedido, el checkout se frena y le muestra la diferencia antes de
 * registrar nada: nunca se le cobra un precio que no vio.
 */
export function detectPriceChanges(
  expected: Array<{ id: unknown; price: unknown }>,
  lines: OrderLine[],
): PriceChange[] {
  const expectedById = new Map<number, number>();
  for (const item of expected) {
    const id = Number(item?.id);
    const price = typeof item?.price === 'number' ? item.price : Number.NaN;
    if (Number.isInteger(id) && Number.isFinite(price)) expectedById.set(id, price);
  }

  return lines.flatMap((line) => {
    const previousPrice = expectedById.get(line.id);
    if (previousPrice === undefined) return [];
    return Math.abs(previousPrice - line.price) > 0.009
      ? [{ id: line.id, name: line.name, previousPrice, currentPrice: line.price }]
      : [];
  });
}
