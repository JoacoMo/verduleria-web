import type { OrderItem } from '@/lib/types';
import { isProductUnit } from '@/lib/product-units';
import type { AdjustDraft, AdjustDrafts } from './order-adjust-model';

/**
 * Borradores del editor de pesos en sessionStorage, uno por pedido.
 *
 * La sesión del panel dura 12 h: si vence con el editor abierto (login a las
 * 8:00, vence a las 20:00, en pleno turno de 19 a 20), el 401 manda al login y
 * antes se perdía lo que el dueño había tipeado con la balanza. Ahora cada
 * cambio queda acá y, al volver a entrar, el editor de ese pedido se abre solo
 * con lo que había cargado.
 *
 * Se guarda también la versión del pedido (updatedAt) y los productos sobre los
 * que se tipeó: si mientras tanto otro dispositivo ajustó el pedido, el editor
 * lo avisa en vez de pisarlo (ver order-adjust-editor.tsx).
 *
 * sessionStorage y no localStorage: es por pestaña y se borra al cerrarla, y
 * solo tiene cantidades (nada del cliente). Todo va en try/catch: en modo
 * privado estricto puede no existir, y el editor funciona igual sin esto.
 */

const KEY_PREFIX = 'adm-ajuste-';
/** Un borrador más viejo que esto ya no sirve (el pedido se armó o se cobró con otros pesos). */
export const ADJUST_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type StoredAdjustDraft = {
  orderId: number;
  /** updatedAt del pedido sobre el que se tipeó (null si el pedido no lo traía). */
  baseUpdatedAt: string | null;
  baseItems: OrderItem[];
  drafts: AdjustDrafts;
  /** ISO. */
  savedAt: string;
};

export function adjustDraftKey(orderId: number) {
  return `${KEY_PREFIX}${orderId}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseItem(value: unknown): OrderItem | null {
  if (!isObject(value)) return null;
  const { id, name, price, quantity, unit } = value;
  if (typeof id !== 'number' || !Number.isInteger(id) || typeof name !== 'string') return null;
  if (typeof price !== 'number' || !Number.isFinite(price) || typeof quantity !== 'number' || !Number.isFinite(quantity)) return null;
  if (!isProductUnit(unit)) return null;
  return { id, name, price, quantity, unit };
}

function parseDraft(value: unknown): AdjustDraft | null {
  if (!isObject(value) || typeof value.text !== 'string' || typeof value.removed !== 'boolean') return null;
  return { text: value.text.slice(0, 40), removed: value.removed };
}

/**
 * Lee un borrador guardado. Devuelve null si no es de ese pedido, si está
 * vencido o si no tiene la forma esperada (otra versión del panel, algo
 * editado a mano): en cualquier caso el editor arranca de lo guardado en el pedido.
 */
export function parseStoredAdjustDraft(raw: string | null, orderId: number, now: Date = new Date()): StoredAdjustDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value) || value.orderId !== orderId) return null;

  const savedAt = typeof value.savedAt === 'string' ? new Date(value.savedAt) : null;
  if (!savedAt || Number.isNaN(savedAt.getTime())) return null;
  const age = now.getTime() - savedAt.getTime();
  if (age < 0 || age > ADJUST_DRAFT_MAX_AGE_MS) return null;

  const baseUpdatedAt = value.baseUpdatedAt === null || typeof value.baseUpdatedAt === 'string' ? value.baseUpdatedAt : undefined;
  if (baseUpdatedAt === undefined || !Array.isArray(value.baseItems) || !isObject(value.drafts)) return null;

  const baseItems = value.baseItems.map(parseItem);
  if (baseItems.some((item) => item === null)) return null;

  const drafts: AdjustDrafts = {};
  for (const [key, rawDraft] of Object.entries(value.drafts)) {
    const id = Number(key);
    const draft = parseDraft(rawDraft);
    if (!Number.isInteger(id) || !draft) return null;
    drafts[id] = draft;
  }

  return { orderId, baseUpdatedAt, baseItems: baseItems as OrderItem[], drafts, savedAt: savedAt.toISOString() };
}

export function readAdjustDraft(orderId: number): StoredAdjustDraft | null {
  try {
    const key = adjustDraftKey(orderId);
    const draft = parseStoredAdjustDraft(window.sessionStorage.getItem(key), orderId);
    // Vencido o roto: se borra para que no vuelva a aparecer.
    if (!draft) window.sessionStorage.removeItem(key);
    return draft;
  } catch {
    return null;
  }
}

export function writeAdjustDraft(draft: Omit<StoredAdjustDraft, 'savedAt'>) {
  try {
    const stored: StoredAdjustDraft = { ...draft, savedAt: new Date().toISOString() };
    window.sessionStorage.setItem(adjustDraftKey(draft.orderId), JSON.stringify(stored));
  } catch {
    // Almacenamiento lleno o bloqueado: el editor sigue andando, solo no se recupera si vence la sesión.
  }
}

export function clearAdjustDraft(orderId: number) {
  try {
    window.sessionStorage.removeItem(adjustDraftKey(orderId));
  } catch {
    // Nada que borrar.
  }
}

/** Pedidos con pesos tipeados sin guardar en esta pestaña (solo borradores válidos). */
export function listAdjustDraftOrderIds(): number[] {
  const ids: number[] = [];
  try {
    const storage = window.sessionStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const orderId = Number(key.slice(KEY_PREFIX.length));
      if (Number.isInteger(orderId) && orderId > 0 && parseStoredAdjustDraft(storage.getItem(key), orderId)) ids.push(orderId);
    }
  } catch {
    // Sin almacenamiento: no hay borradores.
  }
  return ids.sort((a, b) => a - b);
}

/** Hay pesos tipeados sin guardar en esta pestaña (para avisarlo en el login). */
export function hasAdjustDrafts(): boolean {
  return listAdjustDraftOrderIds().length > 0;
}

/**
 * Borradores de pedidos que no están en pantalla (ni en la lista del día ni en
 * los pendientes de días anteriores): su tarjeta no se monta, así que el editor
 * no se puede abrir solo con lo cargado y hay que avisar dónde buscarlo.
 */
export function findHiddenDraftIds(draftIds: number[], shownOrders: Array<{ id: number }>): number[] {
  const shown = new Set(shownOrders.map((order) => order.id));
  return draftIds.filter((id) => !shown.has(id));
}

/** Aviso para los borradores que no están en pantalla. */
export function describeHiddenDrafts(ids: number[]): string {
  const list = ids.map((id) => `#${id}`);
  if (list.length === 1) {
    return `Quedaron pesos sin guardar del pedido ${list[0]}, que no figura en la lista de hoy. `
      + 'Si sigue pendiente, buscalo en el día de su entrega: ahí el editor aparece con lo que habías cargado.';
  }
  return `Quedaron pesos sin guardar de los pedidos ${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}, que no figuran en la lista de hoy. `
    + 'Si siguen pendientes, buscalos en el día de su entrega: ahí el editor aparece con lo que habías cargado.';
}
