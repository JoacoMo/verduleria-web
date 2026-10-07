import type { CartLine } from './types';

/**
 * Claves de localStorage. El carrito sobrevive a cerrar la pestaña (en el celular
 * pasa todo el tiempo) y los datos de contacto se recuerdan para el próximo
 * pedido. No cambiar los nombres: hay clientes con carritos guardados así.
 */
export const STORAGE_KEYS = {
  cart: 'elpampa:carrito',
  lastOrder: 'elpampa:ultimo-pedido',
  customer: 'elpampa:cliente',
} as const;

export function readStorage<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Modo incógnito, storage bloqueado o JSON viejo roto: se arranca de cero.
    return null;
  }
}

export function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin storage la tienda funciona igual, solo no recuerda el carrito.
  }
}

/** Valida lo que haya quedado guardado: se descarta cualquier línea rara. */
export function toCartLines(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value
    .map((line) => ({ id: Number(line?.id), quantity: Number(line?.quantity) }))
    .filter((line) => {
      if (!Number.isInteger(line.id) || line.id <= 0) return false;
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) return false;
      if (seen.has(line.id)) return false;
      seen.add(line.id);
      return true;
    });
}
