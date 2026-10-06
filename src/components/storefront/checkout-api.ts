import type { DeliverySlot } from '@/lib/delivery-slots';
import { isPaymentMethod, type DeliveryMethod, type PaymentMethod } from '@/lib/order-options';
import { sumLines, type PriceChange } from '@/lib/pricing';
import { isProductUnit } from '@/lib/product-units';
import type { CheckoutResponse, OrderItem } from '@/lib/types';
import type { CustomerForm } from './types';

export type CheckoutRequest = {
  /** price = precio unitario que vio el cliente; el servidor lo compara con el vigente. */
  cart: Array<{ id: number; quantity: number; price: number }>;
  deliveryMethod: DeliveryMethod;
  deliverySlot: string | null;
  paymentMethod: PaymentMethod;
  customer: CustomerForm;
  idempotencyKey: string;
};

/** Resultado del POST /api/checkout ya interpretado, para que la tienda haga un switch. */
export type CheckoutOutcome =
  | { kind: 'ok'; data: CheckoutResponse }
  | { kind: 'price-changed'; message: string; changes: PriceChange[] }
  | { kind: 'unavailable'; message: string; ids: number[] }
  | { kind: 'slot'; message: string; availableSlots: DeliverySlot[] }
  /** 429: muchos intentos seguidos, o el tope de pedidos por teléfono. */
  | { kind: 'rate-limited'; message: string }
  /** 503 con mensaje: el tope global de pedidos por hora (spam). */
  | { kind: 'busy'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'network' }
  | { kind: 'server-error' };

/**
 * Con mala señal un fetch puede quedar colgado minutos. Pasado este tiempo se
 * corta y se le ofrece reintentar (con la misma clave de idempotencia, así que si
 * el pedido sí había llegado no se duplica).
 */
const CHECKOUT_TIMEOUT_MS = 25_000;

const RATE_LIMITED_MESSAGE = 'Estás haciendo muchos pedidos seguidos. Esperá unos minutos y probá de nuevo.';
const INVALID_MESSAGE = 'No pudimos procesar el pedido. Revisá los datos y probá de nuevo.';

type ErrorBody = {
  error?: unknown;
  code?: unknown;
  priceChanges?: unknown;
  unavailableIds?: unknown;
  availableSlots?: unknown;
};

function isOrderItem(value: unknown): value is OrderItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<OrderItem>;
  return typeof item.id === 'number'
    && typeof item.name === 'string'
    && typeof item.price === 'number'
    && typeof item.quantity === 'number'
    && isProductUnit(item.unit);
}

/**
 * Valida la respuesta exitosa y completa lo que falte con lo que se pidió. Un
 * reintento (yaExistia) devuelve un pedido guardado, y uno muy viejo puede no
 * traer todos los campos: no por eso hay que mostrarle un error al cliente.
 */
function toCheckoutResponse(data: unknown, request: CheckoutRequest): CheckoutResponse | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Partial<Record<keyof CheckoutResponse, unknown>>;
  if (typeof value.orderId !== 'number' || typeof value.total !== 'number') return null;

  const items = Array.isArray(value.items) ? value.items.filter(isOrderItem) : [];
  const subtotal = typeof value.subtotal === 'number' ? value.subtotal : sumLines(items);
  const text = (field: unknown) => (typeof field === 'string' ? field : '');

  return {
    orderId: value.orderId,
    items,
    subtotal,
    shippingCost: typeof value.shippingCost === 'number' ? value.shippingCost : Math.max(0, value.total - subtotal),
    total: value.total,
    paymentMethod: isPaymentMethod(value.paymentMethod) ? value.paymentMethod : request.paymentMethod,
    deliveryMethod: value.deliveryMethod === 'delivery' || value.deliveryMethod === 'pickup'
      ? value.deliveryMethod
      : request.deliveryMethod,
    deliverySlot: isDeliverySlot(value.deliverySlot) ? value.deliverySlot : null,
    transferAlias: text(value.transferAlias),
    transferCbu: text(value.transferCbu),
    whatsappNumber: text(value.whatsappNumber),
    storeName: text(value.storeName),
    yaExistia: value.yaExistia === true,
    // Precios que bajaron entre que el cliente armó el carrito y confirmó: se
    // cobra el menor y se le avisa en la confirmación. Solo bajas (las subas
    // frenan el pedido con un 409).
    priceDrops: Array.isArray(value.priceDrops)
      ? value.priceDrops.filter(isPriceChange).filter((change) => change.currentPrice < change.previousPrice)
      : [],
    // Hora del servidor en que se creó el pedido; vacía si una respuesta vieja no la trae.
    createdAt: typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt)) ? value.createdAt : '',
  };
}

function isPriceChange(value: unknown): value is PriceChange {
  if (!value || typeof value !== 'object') return false;
  const change = value as Partial<PriceChange>;
  return typeof change.id === 'number'
    && typeof change.name === 'string'
    && typeof change.previousPrice === 'number'
    && typeof change.currentPrice === 'number';
}

function isDeliverySlot(value: unknown): value is DeliverySlot {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Partial<DeliverySlot>;
  return typeof slot.id === 'string' && typeof slot.label === 'string';
}

/** Clave de idempotencia. crypto.randomUUID solo existe en contextos seguros (https). */
export function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Marca de "la respuesta no se pudo leer como JSON". */
export const UNREADABLE_BODY = Symbol('cuerpo ilegible');

/**
 * Traduce la respuesta del servidor (status + cuerpo ya leído) a un resultado.
 * Es pura (sin fetch ni window) para poder testear cada caso.
 */
export function interpretCheckoutResponse(
  status: number,
  data: unknown,
  request: CheckoutRequest,
): CheckoutOutcome {
  const ok = status >= 200 && status < 300;

  if (data === UNREADABLE_BODY) {
    // Si la respuesta era un 200 y se cortó a mitad de camino, el pedido puede
    // haberse creado: se trata como corte de red para reintentar con la misma clave.
    if (ok) return { kind: 'network' };
    if (status === 429) return { kind: 'rate-limited', message: RATE_LIMITED_MESSAGE };
    if (status >= 500) return { kind: 'server-error' };
    return { kind: 'invalid', message: INVALID_MESSAGE };
  }

  if (ok) {
    const order = toCheckoutResponse(data, request);
    return order ? { kind: 'ok', data: order } : { kind: 'server-error' };
  }

  const body = (data && typeof data === 'object' ? data : {}) as ErrorBody;
  const message = typeof body.error === 'string' && body.error.trim() ? body.error : '';

  if (status === 429) {
    return { kind: 'rate-limited', message: message || RATE_LIMITED_MESSAGE };
  }

  // El tope global de pedidos por hora responde 503 con un mensaje para el
  // cliente. Un 503 sin mensaje (de la plataforma) es un error común.
  if (status === 503 && message) {
    return { kind: 'busy', message };
  }

  if (body.code === 'PRECIOS_CAMBIARON' && Array.isArray(body.priceChanges)) {
    return {
      kind: 'price-changed',
      message: message || 'Cambiaron algunos precios mientras armabas el pedido.',
      changes: body.priceChanges.filter(isPriceChange),
    };
  }

  if (body.code === 'SIN_STOCK' && Array.isArray(body.unavailableIds)) {
    return {
      kind: 'unavailable',
      message: message || 'Algunos productos se quedaron sin stock.',
      ids: body.unavailableIds.map(Number).filter((id) => Number.isInteger(id) && id > 0),
    };
  }

  if (body.code === 'TURNO_NO_DISPONIBLE') {
    return {
      kind: 'slot',
      message: message || 'El turno que elegiste ya no está disponible.',
      availableSlots: Array.isArray(body.availableSlots) ? body.availableSlots.filter(isDeliverySlot) : [],
    };
  }

  if (status >= 400 && status < 500) {
    return { kind: 'invalid', message: message || INVALID_MESSAGE };
  }

  return { kind: 'server-error' };
}

export async function postCheckout(request: CheckoutRequest): Promise<CheckoutOutcome> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch {
      return { kind: 'network' };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = UNREADABLE_BODY;
    }
    return interpretCheckoutResponse(response.status, data, request);
  } finally {
    window.clearTimeout(timeout);
  }
}
