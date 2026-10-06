import type { OrderRecord } from '@/lib/types';
import { DELIVERY_WINDOWS } from '@/lib/delivery-slots';
import { formatMinutes, getArgentinaParts, pickupCutoffMinutes } from '@/lib/store-hours';
import { isWeightUnit, lineWeightKg } from '@/lib/product-units';
import { roundMoney } from '@/lib/pricing';
import { toArgentinaDate } from './format';

/**
 * Lógica pura de la lista de pedidos del panel: cómo se agrupan para armar el
 * reparto, el resumen del día y qué se puede hacer con cada pedido.
 */

/** Estados en los que el pedido todavía se puede confirmar, cancelar o ajustar. */
export function isOpenOrder(order: Pick<OrderRecord, 'status'>) {
  return order.status === 'pending' || order.status === 'failed';
}

export function hasWeightItems(order: Pick<OrderRecord, 'items'>) {
  return order.items.some((item) => isWeightUnit(item.unit));
}

/**
 * Tiene productos por peso y todavía no se cargaron los pesos reales: el total
 * es una estimación (lo que pidió el cliente, no lo que marcó la balanza). Con
 * esto no se puede avisar el "total final" ni dar por bueno el cobro sin aviso.
 */
export function isAwaitingWeights(order: Pick<OrderRecord, 'items' | 'adjustedAt'>) {
  return !order.adjustedAt && hasWeightItems(order);
}

/**
 * Cómo se llama el total de un pedido:
 * - "Total final" si el dueño ya cargó los pesos reales.
 * - "Total estimado" si tiene cosas por peso y todavía no se pesó.
 * - "Total" a secas si todo va por unidad (es exacto desde el principio).
 */
export function totalLabel(order: Pick<OrderRecord, 'items' | 'adjustedAt'>) {
  if (order.adjustedAt) return 'Total final';
  return isAwaitingWeights(order) ? 'Total estimado' : 'Total';
}

function isPickup(order: Pick<OrderRecord, 'deliveryMethod'>) {
  return order.deliveryMethod !== 'delivery';
}

/** "YYYY-MM-DD" (hora argentina) en que entró el pedido, o null si no se sabe. */
function createdDateOf(order: Pick<OrderRecord, 'createdAt'>) {
  if (!order.createdAt) return null;
  const created = new Date(order.createdAt);
  return Number.isNaN(created.getTime()) ? null : toArgentinaDate(created);
}

/**
 * Retiro que entró después del corte de su día (19:00, o el cierre del local si
 * es antes: el domingo, 14:00). No se arma ese día sino el siguiente, que es lo
 * que la tienda le promete al cliente (describePickupReady en store-hours.ts).
 */
export function isAfterPickupCutoff(order: Pick<OrderRecord, 'deliveryMethod' | 'createdAt'>) {
  if (!isPickup(order) || !order.createdAt) return false;
  const created = new Date(order.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const { dayIndex, minutesOfDay } = getArgentinaParts(created);
  return minutesOfDay >= pickupCutoffMinutes(dayIndex);
}

/**
 * Mirando el día en que entró: un retiro que se arma recién al día siguiente
 * ("Se arma mañana"). El día siguiente ese mismo pedido aparece en su propio
 * grupo (ver groupOrdersByDelivery) y ahí ya no lleva la marca.
 */
export function isPickupForNextDay(order: Pick<OrderRecord, 'deliveryMethod' | 'createdAt'>, date: string) {
  return isAfterPickupCutoff(order) && createdDateOf(order) === date;
}

/**
 * Retiro que entró un día anterior al que se está mirando: el servidor lo trae
 * porque entró después del corte de ayer y se arma hoy.
 */
export function isCarriedPickup(order: Pick<OrderRecord, 'deliveryMethod' | 'createdAt'>, date: string) {
  if (!isPickup(order)) return false;
  const created = createdDateOf(order);
  return created !== null && created < date;
}

/** Peso aproximado del pedido en kilos (solo cuenta lo que va por peso). */
export function orderWeightKg(order: Pick<OrderRecord, 'items'>) {
  return Math.round(order.items.reduce((sum, item) => sum + lineWeightKg(item), 0) * 100) / 100;
}

const SLOT_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/;

type ParsedSlot = { date: string; start: number; end: number };

function parseSlot(slotId: string | null): ParsedSlot | null {
  if (!slotId) return null;
  const match = SLOT_ID_PATTERN.exec(slotId);
  if (!match) return null;
  const start = Number(match[2]) * 60;
  const window = DELIVERY_WINDOWS.find((item) => item.start === start);
  return window ? { date: match[1], start: window.start, end: window.end } : null;
}

/** "de 13 a 14 h". */
export function windowText(start: number, end: number) {
  const short = (minutes: number) => (minutes % 60 === 0 ? String(minutes / 60) : formatMinutes(minutes));
  return `de ${short(start)} a ${short(end)} h`;
}

export type OrderGroupKind = 'slot' | 'no-slot' | 'pickup-carry' | 'pickup' | 'other-day' | 'cancelled';

export type OrderGroup = {
  key: string;
  kind: OrderGroupKind;
  title: string;
  /** Aclaración corta debajo del título (qué hay que hacer con ese grupo), si hace falta. */
  hint?: string;
  orders: OrderRecord[];
};

function byCreatedAtAsc(a: OrderRecord, b: OrderRecord) {
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id - b.id;
}

/**
 * Agrupa los pedidos de un día como se arma el reparto: primero cada turno de
 * envío del día (en orden horario), después los envíos sin turno (pedidos
 * viejos), los retiros que entraron ayer después del corte (se arman hoy y son
 * los primeros que hay que tener listos), el resto de los retiros, los envíos
 * que se entregan otro día (entraron hoy para mañana, por ejemplo) y al final
 * los cancelados, que no hay que armar.
 *
 * Dentro de cada grupo, por orden de llegada: el que pidió primero se arma primero.
 * Los grupos vacíos no se devuelven.
 */
export function groupOrdersByDelivery(orders: OrderRecord[], date: string): OrderGroup[] {
  const bySlot = new Map<number, { slot: ParsedSlot; orders: OrderRecord[] }>();
  const noSlot: OrderRecord[] = [];
  const carriedPickup: OrderRecord[] = [];
  const pickup: OrderRecord[] = [];
  const otherDay: OrderRecord[] = [];
  const cancelled: OrderRecord[] = [];

  for (const order of orders) {
    if (order.status === 'cancelled') {
      cancelled.push(order);
      continue;
    }
    if (isPickup(order)) {
      (isCarriedPickup(order, date) ? carriedPickup : pickup).push(order);
      continue;
    }
    const slot = parseSlot(order.deliverySlot);
    if (!slot) {
      noSlot.push(order);
    } else if (slot.date !== date) {
      otherDay.push(order);
    } else {
      const entry = bySlot.get(slot.start) ?? { slot, orders: [] };
      entry.orders.push(order);
      bySlot.set(slot.start, entry);
    }
  }

  const groups: OrderGroup[] = [...bySlot.values()]
    .sort((a, b) => a.slot.start - b.slot.start)
    .map(({ slot, orders: slotOrders }) => ({
      key: `slot-${slot.start}`,
      kind: 'slot',
      title: `Envíos ${windowText(slot.start, slot.end)}`,
      orders: slotOrders.sort(byCreatedAtAsc),
    }));

  if (noSlot.length) groups.push({ key: 'no-slot', kind: 'no-slot', title: 'Envíos sin turno', orders: noSlot.sort(byCreatedAtAsc) });
  if (carriedPickup.length) {
    groups.push({
      key: 'pickup-carry',
      kind: 'pickup-carry',
      title: 'Retiros que entraron ayer después del horario',
      hint: 'Se arman hoy: el cliente los viene a buscar desde que abre el local.',
      orders: carriedPickup.sort(byCreatedAtAsc),
    });
  }
  if (pickup.length) groups.push({ key: 'pickup', kind: 'pickup', title: 'Retiros en el local', orders: pickup.sort(byCreatedAtAsc) });
  if (otherDay.length) {
    groups.push({
      key: 'other-day',
      kind: 'other-day',
      title: 'Envíos para otro día',
      orders: otherDay.sort((a, b) => (a.deliverySlot ?? '').localeCompare(b.deliverySlot ?? '') || byCreatedAtAsc(a, b)),
    });
  }
  if (cancelled.length) groups.push({ key: 'cancelled', kind: 'cancelled', title: 'Cancelados', orders: cancelled.sort(byCreatedAtAsc) });

  return groups;
}

export type DaySummary = {
  /** Pedidos que cuentan (todo menos los cancelados). */
  orderCount: number;
  cancelledCount: number;
  paidCount: number;
  paidTotal: number;
  /** Pendientes y con problema: lo que falta cobrar. */
  toCollectCount: number;
  toCollectTotal: number;
  /** Retiros que hay que tener listos ese día (incluye los que entraron ayer después del corte). */
  pickupCount: number;
  /** Retiros que entraron ese día después del corte: se arman al día siguiente. */
  nextDayPickupCount: number;
  /** Envíos de cada turno del día, en orden horario (incluye turnos con 0). */
  deliveriesBySlot: Array<{ key: string; label: string; count: number }>;
  /** Envíos sin turno o para otro día. */
  otherDeliveries: number;
};

/** Resumen del día para el dueño: cuánto entró, cuánto falta cobrar y cuántos envíos hay por turno. */
export function summarizeDay(orders: OrderRecord[], date: string): DaySummary {
  const summary: DaySummary = {
    orderCount: 0,
    cancelledCount: 0,
    paidCount: 0,
    paidTotal: 0,
    toCollectCount: 0,
    toCollectTotal: 0,
    pickupCount: 0,
    nextDayPickupCount: 0,
    deliveriesBySlot: DELIVERY_WINDOWS.map(({ start, end }) => ({ key: `slot-${start}`, label: windowText(start, end), count: 0 })),
    otherDeliveries: 0,
  };

  for (const order of orders) {
    if (order.status === 'cancelled') {
      summary.cancelledCount += 1;
      continue;
    }
    summary.orderCount += 1;

    if (order.status === 'paid') {
      summary.paidCount += 1;
      summary.paidTotal = roundMoney(summary.paidTotal + order.total);
    } else {
      summary.toCollectCount += 1;
      summary.toCollectTotal = roundMoney(summary.toCollectTotal + order.total);
    }

    if (isPickup(order)) {
      if (isPickupForNextDay(order, date)) summary.nextDayPickupCount += 1;
      else summary.pickupCount += 1;
      continue;
    }
    const slot = parseSlot(order.deliverySlot);
    const bucket = slot && slot.date === date ? summary.deliveriesBySlot.find((item) => item.key === `slot-${slot.start}`) : undefined;
    if (bucket) bucket.count += 1;
    else summary.otherDeliveries += 1;
  }

  return summary;
}

export type OverdueSummary = {
  count: number;
  /** Lo que falta cobrar de esos pedidos (con totales estimados si no se pesaron). */
  toCollectTotal: number;
  hasEstimated: boolean;
};

/**
 * Pendientes de días anteriores que no están ya en la lista del día que se está
 * mirando (para no mostrar dos tarjetas del mismo pedido) y su resumen.
 */
export function visibleOverdueOrders(overdue: OrderRecord[], dayOrders: OrderRecord[]) {
  const shown = new Set(dayOrders.map((order) => order.id));
  return overdue.filter((order) => isOpenOrder(order) && !shown.has(order.id));
}

export function summarizeOverdue(orders: OrderRecord[]): OverdueSummary {
  return orders.reduce<OverdueSummary>(
    (summary, order) => ({
      count: summary.count + 1,
      toCollectTotal: roundMoney(summary.toCollectTotal + order.total),
      hasEstimated: summary.hasEstimated || isAwaitingWeights(order),
    }),
    { count: 0, toCollectTotal: 0, hasEstimated: false },
  );
}
