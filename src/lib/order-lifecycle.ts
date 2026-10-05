import type { Prisma } from '@prisma/client';
import { PRODUCT_MAX_CART_QUANTITY, formatProductQuantity, isProductUnit, normalizeProductQuantity } from './product-units';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, isPaymentMethod, type OrderStatus } from './order-options';
import { DELIVERY_WINDOWS, describeSlot, findAvailableSlot, type DeliverySlot } from './delivery-slots';
import { roundMoney, sumLines } from './pricing';
import { ValidationError, type OrderAdjustmentRequest } from './validation';
import type { OrderItem, OrderRecord } from './types';

/**
 * Lógica de pedidos que no depende de la base: lectura de lo guardado, ajuste
 * de pesos reales y plazos de limpieza. Separada de los handlers para poder
 * testearla sin Prisma.
 */

/**
 * Estados en los que el dueño todavía puede tocar un pedido (confirmar,
 * cancelar, ajustar pesos). 'failed' entra porque es un pedido con problema que
 * igual se puede resolver a mano.
 */
export const OPEN_ORDER_STATUSES = ['pending', 'failed'] as const satisfies readonly OrderStatus[];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** Mensaje del 409 cuando el pedido ya no está en un estado que se pueda tocar. */
export function describeStatusConflict(status: string) {
  const label = isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : status;
  return `El pedido ya figura como "${label}".`;
}

/**
 * Columnas que necesita el panel. Se eligen a mano para que nunca salgan en una
 * respuesta la clave de idempotencia ni columnas históricas que ya no se usan.
 */
export const ORDER_RECORD_SELECT = {
  id: true,
  items: true,
  subtotal: true,
  shippingCost: true,
  total: true,
  status: true,
  deliveryMethod: true,
  paymentMethod: true,
  deliverySlot: true,
  adjustedAt: true,
  customerName: true,
  customerPhone: true,
  customerAddress: true,
  notes: true,
  replacementPolicy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderSelect;

export type OrderRecordRow = {
  id: number;
  items: unknown;
  subtotal: number;
  shippingCost: number;
  total: number;
  status: string;
  deliveryMethod: string;
  paymentMethod: string | null;
  deliverySlot: string | null;
  adjustedAt: Date | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  notes: string | null;
  replacementPolicy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Ítems guardados en el JSON del pedido. Es una foto tomada al pedir, así que
 * se lee con tolerancia: lo que no tenga la forma esperada se descarta en vez de
 * romper el panel entero por un pedido viejo.
 */
export function parseStoredOrderItems(value: unknown): OrderItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): OrderItem[] => {
    if (raw === null || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const { id, price, quantity } = item;
    if (typeof id !== 'number' || !Number.isInteger(id)) return [];
    if (typeof price !== 'number' || !Number.isFinite(price)) return [];
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return [];
    return [{
      id,
      name: typeof item.name === 'string' ? item.name : `Producto ${id}`,
      price,
      quantity,
      unit: isProductUnit(item.unit) ? item.unit : 'kg',
    }];
  });
}

export function toOrderRecord(row: OrderRecordRow): OrderRecord {
  return {
    id: row.id,
    items: parseStoredOrderItems(row.items),
    subtotal: row.subtotal,
    shippingCost: row.shippingCost,
    total: row.total,
    status: isOrderStatus(row.status) ? row.status : 'pending',
    deliveryMethod: row.deliveryMethod === 'delivery' ? 'delivery' : 'pickup',
    paymentMethod: isPaymentMethod(row.paymentMethod) ? row.paymentMethod : null,
    deliverySlot: row.deliverySlot,
    adjustedAt: row.adjustedAt ? row.adjustedAt.toISOString() : null,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerAddress: row.customerAddress,
    notes: row.notes,
    replacementPolicy: row.replacementPolicy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SLOT_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/;

/**
 * Turno guardado como objeto completo, para responder un reintento del
 * checkout. Si todavía está en la lista de disponibles se usa ese (con la
 * etiqueta "Hoy"/"Mañana"); si no, se arma con la fecha.
 */
export function slotFromId(slotId: string | null, now: Date = new Date()): DeliverySlot | null {
  if (!slotId) return null;
  const available = findAvailableSlot(slotId, now);
  if (available) return available;

  const match = SLOT_ID_PATTERN.exec(slotId);
  const label = describeSlot(slotId);
  if (!match || !label) return null;
  const window = DELIVERY_WINDOWS.find((item) => item.start === Number(match[2]) * 60);
  if (!window) return null;
  return { id: slotId, date: match[1], start: window.start, end: window.end, label };
}

export type AdjustedOrder = {
  items: OrderItem[];
  subtotal: number;
  total: number;
};

/**
 * Ajuste con los pesos reales: el dueño pesa y carga lo que efectivamente se
 * lleva el cliente.
 *
 * - Solo se pueden tocar ítems que ya estaban en el pedido (no se agregan
 *   productos nuevos desde acá).
 * - El precio unitario es el guardado al pedir: si el catálogo cambió después,
 *   al cliente se le respeta el precio que vio.
 * - Cantidad 0, o un ítem que no viene, = se saca del pedido. Tiene que quedar
 *   al menos uno (si no, lo que corresponde es cancelarlo).
 * - El envío no se recalcula: se mantiene lo que se le informó al cliente.
 */
export function applyOrderAdjustment(
  storedItems: OrderItem[],
  requested: OrderAdjustmentRequest,
  shippingCost: number,
): AdjustedOrder {
  const storedIds = new Set(storedItems.map((item) => item.id));
  const requestedById = new Map<number, number>();
  for (const { id, quantity } of requested) {
    if (!storedIds.has(id)) {
      throw new ValidationError(`El producto ${id} no estaba en el pedido. Solo se pueden ajustar los que pidió el cliente.`);
    }
    requestedById.set(id, quantity);
  }

  const items = storedItems.flatMap((item): OrderItem[] => {
    const requestedQuantity = requestedById.get(item.id);
    if (requestedQuantity === undefined || requestedQuantity === 0) return [];

    const quantity = normalizeProductQuantity(requestedQuantity, item.unit);
    const max = PRODUCT_MAX_CART_QUANTITY[item.unit];
    if (quantity > max) {
      throw new ValidationError(`La cantidad de ${item.name} es demasiado grande (máximo ${formatProductQuantity(max, item.unit)}).`);
    }
    return [{ ...item, quantity }];
  });

  if (items.length === 0) {
    throw new ValidationError('El pedido tiene que quedar con al menos un producto. Si no se lleva nada, cancelalo.');
  }

  const subtotal = sumLines(items);
  return { items, subtotal, total: roundMoney(subtotal + shippingCost) };
}

/** Un pedido sin cobrar de más de esta antigüedad se da por abandonado. */
export const STALE_PENDING_DAYS = 7;
/** Los cancelados y con problema se borran pasado este plazo (no hay nada que cobrar ni reclamar). */
export const CLOSED_ORDER_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function getCleanupCutoffs(now: Date = new Date()) {
  return {
    cancelPendingBefore: new Date(now.getTime() - STALE_PENDING_DAYS * DAY_MS),
    deleteClosedBefore: new Date(now.getTime() - CLOSED_ORDER_RETENTION_DAYS * DAY_MS),
  };
}
