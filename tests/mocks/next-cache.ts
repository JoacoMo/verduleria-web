import { vi } from 'vitest';

/**
 * Reemplazo de `next/cache` para los tests.
 *
 * Fuera del servidor de Next, `revalidateTag` explota porque no hay "store" de
 * generación estática, y `unstable_cache` necesita la caché incremental. Acá:
 * - `unstable_cache` es un passthrough: cada lectura va directo a la base de test.
 * - `revalidateTag` es un espía, para verificar que el panel invalida el catálogo
 *   después de cada cambio (`invalidarProductos()`).
 */
export const unstable_cache = <T extends (...args: never[]) => unknown>(fn: T): T => fn;

export const revalidateTag = vi.fn((_tag: string) => undefined);

export const revalidatePath = vi.fn((_path: string) => undefined);

export const unstable_noStore = vi.fn(() => undefined);
