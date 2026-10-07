import type { Product } from './types';

/**
 * Orden del catálogo: los disponibles primero y, dentro de cada grupo,
 * alfabético en castellano.
 *
 * Se ordena acá y no con ORDER BY porque el orden de Postgres depende de la
 * collation con la que se creó la base (C.UTF-8, en_US.utf8...): con una,
 * "Ñame" y "ají" quedaban después de "Zapallo"; con otra, "Producto 10" antes
 * que "Producto 1". Así el catálogo se ve igual en cualquier base.
 *
 * - Sin distinguir mayúsculas ni tildes: "ají" va junto a "Ajo".
 * - La ñ va después de la n, como en el diccionario.
 * - Los números se comparan como números: "Bolsón 2 kg" antes que "Bolsón 10 kg".
 */
const NAME_COLLATOR = new Intl.Collator('es-AR', { sensitivity: 'base', numeric: true });

export function compareProductNames(a: string, b: string) {
  return NAME_COLLATOR.compare(a, b);
}

/** Con nombres iguales desempata el id, para que el orden no cambie entre lecturas. */
export function compareProducts(a: Pick<Product, 'id' | 'name' | 'available'>, b: Pick<Product, 'id' | 'name' | 'available'>) {
  if (a.available !== b.available) return a.available ? -1 : 1;
  return compareProductNames(a.name, b.name) || a.id - b.id;
}
