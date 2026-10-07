import type { Prisma } from '@prisma/client';
import { PRODUCT_MAX_CART_QUANTITY, formatProductQuantity, isProductUnit, normalizeWeighedQuantity } from './product-units';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, isPaymentMethod, type OrderStatus } from './order-options';
import { DELIVERY_WINDOWS, describeSlot, findAvailableSlot, type DeliverySlot } from './delivery-slots';
import { roundMoney, sumLines } from './pricing';
import { pickupCutoffMinutes } from './store-hours';
import { ValidationError, type OrderAdjustmentItem } from './validation';
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
 * mpPreferenceId se lee solo para saber si el pedido tenía link de Mercado Pago
 * (toOrderRecord lo convierte en un sí/no; el id no sale).
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
  mpPreferenceId: true,
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
  mpPreferenceId: string | null;
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

/**
 * Subtotal guardado, salvo en los pedidos que creó la versión anterior mientras
 * se publicaba esta: la migración les dejó el valor por defecto (0) y en esa
 * versión el envío no entraba en el total, así que el subtotal es el total.
 */
function storedSubtotal(row: Pick<OrderRecordRow, 'subtotal' | 'shippingCost' | 'total'>) {
  if (row.subtotal > 0 || row.total <= 0) return row.subtotal;
  return roundMoney(row.total - row.shippingCost);
}

export function toOrderRecord(row: OrderRecordRow): OrderRecord {
  return {
    id: row.id,
    items: parseStoredOrderItems(row.items),
    subtotal: storedSubtotal(row),
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
    mercadoPagoLink: row.mpPreferenceId !== null,
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
 * - Lo que va por peso se guarda con la precisión de la balanza (5 g), no con
 *   la de 50 g del carrito: el total final tiene que ser el del peso real.
 * - El envío no se recalcula: se mantiene lo que se le informó al cliente.
 */
export function applyOrderAdjustment(
  storedItems: OrderItem[],
  requested: OrderAdjustmentItem[],
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

    const quantity = normalizeWeighedQuantity(requestedQuantity, item.unit);
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

/**
 * Un pedido abierto (pendiente o con problema) de más de esta antigüedad se da
 * por abandonado y lo cancela el cron, salvo que esté en efectivo o ya pesado
 * (ver /api/cron/limpiar-pedidos).
 */
export const STALE_PENDING_DAYS = 7;
/** Los cancelados se borran pasado este plazo desde que se cancelaron (no hay nada que cobrar ni reclamar). */
export const CLOSED_ORDER_RETENTION_DAYS = 90;
/** Tope de la lista "Pendientes de días anteriores" del panel. */
export const MAX_OVERDUE_ORDERS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function getCleanupCutoffs(now: Date = new Date()) {
  return {
    /** Abiertos creados antes de esto: se cancelan (createdAt). */
    cancelStaleBefore: new Date(now.getTime() - STALE_PENDING_DAYS * DAY_MS),
    /** Cancelados que no se tocan desde antes de esto: se borran (updatedAt = cuándo se cancelaron). */
    deleteCancelledBefore: new Date(now.getTime() - CLOSED_ORDER_RETENTION_DAYS * DAY_MS),
  };
}

/**
 * Id de turno ("2026-10-06T13") para un día y una franja. El mismo formato que
 * arma getUpcomingSlots (delivery-slots.ts).
 */
function slotIdFor(date: string, startMinutes: number) {
  return `${date}T${String(Math.floor(startMinutes / 60)).padStart(2, '0')}`;
}

export type OrdersDayRange = {
  /** 00:00 del día en Córdoba (Argentina es UTC-3 todo el año). */
  dayStart: Date;
  dayEnd: Date;
  /**
   * Desde cuándo un retiro del día anterior se arma este día: los que entraron
   * después del corte de ese día (pickupCutoffMinutes: 19:00, o el cierre si es
   * antes, como el domingo a las 14:00) se preparan al día siguiente.
   */
  pickupCarryFrom: Date;
  /**
   * Rango de ids de turno del día ("YYYY-MM-DDT00" a "YYYY-MM-DDT23"). Por rango
   * y no por igualdad contra las franjas actuales: si algún día cambian los
   * horarios, los envíos ya tomados con la franja vieja siguen apareciendo en su
   * día. Usa el índice de deliverySlot igual.
   */
  slotRange: { gte: string; lte: string };
};

/**
 * Rango de "los pedidos del día" del panel para una fecha "YYYY-MM-DD" (hora
 * argentina): los que entraron ese día, los que se entregan ese día y los
 * retiros que entraron el día anterior después del corte.
 */
export function getOrdersDayRange(date: string): OrdersDayRange {
  const dayStart = new Date(`${date}T00:00:00-03:00`);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  // Día de la semana de la fecha pedida (al mediodía UTC no hay dudas de cuál es).
  const dayIndex = new Date(`${date}T12:00:00Z`).getUTCDay();
  const previousDayIndex = (dayIndex + 6) % 7;
  const pickupCarryFrom = new Date(dayStart.getTime() - (24 * 60 - pickupCutoffMinutes(previousDayIndex)) * MINUTE_MS);
  return {
    dayStart,
    dayEnd,
    pickupCarryFrom,
    slotRange: { gte: slotIdFor(date, 0), lte: `${date}T23` },
  };
}

/**
 * Primer id de turno posible de un día ("2026-10-06T00"). Los ids tienen todos
 * el mismo formato y largo, así que comparar como texto es comparar por fecha.
 */
export function firstSlotIdOf(date: string) {
  return slotIdFor(date, 0);
}
