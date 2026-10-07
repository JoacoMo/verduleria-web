import type { OrderItem } from '@/lib/types';
import {
  PRODUCT_MAX_CART_QUANTITY,
  formatProductQuantity,
  normalizeWeighedQuantity,
  type ProductUnit,
} from '@/lib/product-units';
import { roundMoney, sumLines } from '@/lib/pricing';
import { formatQuantityInput, parseQuantityInput } from './format';

/**
 * Lógica pura del editor de pesos reales ("Ajustar pesos"): qué se guarda de
 * cada línea, el total que va a quedar y qué cambió si el pedido se modificó
 * desde otro lado mientras estaba abierto. El componente solo la pinta.
 */

/**
 * Paso de los botones -/+: la precisión de la balanza (5 g), la misma con la
 * que se guarda (normalizeWeighedQuantity, en el servidor y acá). Lo que va por
 * cantidad es siempre entero.
 */
export const ADJUST_STEP: Record<ProductUnit, number> = {
  kg: 0.005,
  g: 5,
  unidad: 1,
  atado: 1,
  bandeja: 1,
};

export type AdjustDraft = { text: string; removed: boolean };
export type AdjustDrafts = Record<number, AdjustDraft>;
export type AdjustedItem = { id: number; quantity: number };

/** Lo que muestra el editor al abrirse: lo que hay guardado en el pedido. */
export function initialDrafts(items: OrderItem[]): AdjustDrafts {
  return Object.fromEntries(items.map((item) => [item.id, { text: formatQuantityInput(item.quantity, item.unit), removed: false }]));
}

/**
 * Un toque de -/+ desde `current`. Primero se lleva al paso (11,237 → 11,235)
 * para que el botón siempre deje un valor que se guarda tal cual.
 */
export function stepAdjustQuantity(current: number, unit: ProductUnit, direction: 1 | -1) {
  const step = ADJUST_STEP[unit];
  const base = Number.isFinite(current) ? Math.round(current / step) * step : 0;
  const next = Math.max(0, base + direction * step);
  return unit === 'kg' ? Number(next.toFixed(3)) : Math.round(next);
}

export type AdjustLine = {
  item: OrderItem;
  draft: AdjustDraft;
  /** Error de lo tipeado, o null. */
  problem: string | null;
  /** Se saca del pedido (botón de tacho o cantidad 0). */
  removed: boolean;
  /** Lo que se va a guardar (0 si se saca o si lo tipeado no sirve). */
  quantity: number;
  /** Lo tipeado no estaba en el paso de la balanza y se guarda redondeado. */
  rounded: boolean;
};

export function buildAdjustLines(items: OrderItem[], drafts: AdjustDrafts): AdjustLine[] {
  return items.map((item) => {
    const draft = drafts[item.id] ?? { text: formatQuantityInput(item.quantity, item.unit), removed: false };
    const parsed = parseQuantityInput(draft.text, item.unit);
    const max = PRODUCT_MAX_CART_QUANTITY[item.unit];

    let problem: string | null = null;
    if (!draft.removed) {
      if (parsed === null) problem = 'Poné la cantidad (o sacalo del pedido).';
      else if (Number.isNaN(parsed)) problem = 'Escribí un número.';
      else if (parsed > max) problem = `Es demasiado: máximo ${formatProductQuantity(max, item.unit)}.`;
    }

    // Un 0 es lo mismo que sacarlo (así lo toma el servidor).
    const removed = draft.removed || parsed === 0;
    const quantity = removed || problem || parsed === null ? 0 : normalizeWeighedQuantity(parsed, item.unit);
    const rounded = !removed && !problem && parsed !== null && Math.abs(quantity - parsed) > 1e-9;
    return { item, draft, problem, removed, quantity, rounded };
  });
}

export type AdjustTotals = {
  subtotal: number;
  total: number;
  allRemoved: boolean;
  hasProblems: boolean;
};

/** Subtotal y total que van a quedar (el envío no cambia con el ajuste). */
export function summarizeAdjustLines(lines: AdjustLine[], shippingCost: number): AdjustTotals {
  const kept = lines.filter((line) => !line.removed && !line.problem);
  const subtotal = sumLines(kept.map((line) => ({ price: line.item.price, quantity: line.quantity })));
  return {
    subtotal,
    total: roundMoney(subtotal + shippingCost),
    allRemoved: lines.every((line) => line.removed),
    hasProblems: lines.some((line) => line.problem !== null),
  };
}

/** Cuerpo de items para PUT /api/gestion/orders/[id] (0 = se saca). */
export function adjustmentItems(lines: AdjustLine[]): AdjustedItem[] {
  return lines.map((line) => ({ id: line.item.id, quantity: line.removed ? 0 : line.quantity }));
}

function isTouched(draft: AdjustDraft, original: AdjustDraft | undefined) {
  return !original || draft.removed || draft.text.trim() !== original.text;
}

/** El dueño tocó algo respecto de lo que había en el pedido (sirve para no guardar borradores vacíos). */
export function isDraftDirty(drafts: AdjustDrafts, baseItems: OrderItem[]) {
  const initial = initialDrafts(baseItems);
  return Object.entries(drafts).some(([id, draft]) => isTouched(draft, initial[Number(id)]));
}

/**
 * "Seguir con lo que cargué" después de que el pedido cambió desde otro lado:
 * queda lo que el dueño tocó en este editor y, en el resto de las líneas, lo
 * que está guardado ahora. Así no se pisa con el valor viejo una línea que el
 * dueño ni miró y que el otro dispositivo sí corrigió. Las líneas que ya no
 * están en el pedido se descartan (el servidor no deja ajustarlas).
 */
export function rebaseDrafts(drafts: AdjustDrafts, previousItems: OrderItem[], currentItems: OrderItem[]): AdjustDrafts {
  const before = initialDrafts(previousItems);
  const next = initialDrafts(currentItems);
  for (const item of currentItems) {
    const draft = drafts[item.id];
    if (draft && isTouched(draft, before[item.id])) next[item.id] = draft;
  }
  return next;
}

export type OrderItemChange =
  | { kind: 'changed'; id: number; name: string; unit: ProductUnit; before: number; after: number }
  | { kind: 'removed'; id: number; name: string }
  | { kind: 'added'; id: number; name: string; unit: ProductUnit; after: number };

/**
 * Qué cambió en los productos del pedido entre la versión que tenía el editor
 * al abrirse (`base`) y la que está guardada ahora (`current`): otro celular
 * cargó otros pesos o sacó algo.
 */
export function diffOrderItems(base: OrderItem[], current: OrderItem[]): OrderItemChange[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const baseIds = new Set(base.map((item) => item.id));
  const changes: OrderItemChange[] = [];

  for (const item of base) {
    const now = currentById.get(item.id);
    if (!now) changes.push({ kind: 'removed', id: item.id, name: item.name });
    else if (Math.abs(now.quantity - item.quantity) > 1e-9) {
      changes.push({ kind: 'changed', id: item.id, name: item.name, unit: now.unit, before: item.quantity, after: now.quantity });
    }
  }
  for (const item of current) {
    if (!baseIds.has(item.id)) changes.push({ kind: 'added', id: item.id, name: item.name, unit: item.unit, after: item.quantity });
  }
  return changes;
}

/** "Zapallo: ahora 12 kg (antes 12,5 kg)". */
export function describeItemChange(change: OrderItemChange) {
  if (change.kind === 'removed') return `${change.name}: lo sacaron del pedido`;
  if (change.kind === 'added') return `${change.name}: ahora figura ${formatProductQuantity(change.after, change.unit)}`;
  return `${change.name}: ahora ${formatProductQuantity(change.after, change.unit)} (antes ${formatProductQuantity(change.before, change.unit)})`;
}
