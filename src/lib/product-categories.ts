/**
 * Categorías del catálogo.
 *
 * "Ofertas" se mantiene como categoría por compatibilidad con productos ya
 * cargados, pero una oferta ahora es un precio de oferta con vencimiento sobre
 * cualquier producto (src/lib/pricing.ts). El filtro "Ofertas" de la tienda
 * muestra ambas cosas: la categoría y los productos con oferta vigente.
 */
export const PRODUCT_CATEGORIES = ['Bolsones', 'Frutas', 'Verduras', 'Almacén', 'Ofertas'] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === 'string' && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

/** "Bolsones, Frutas, Verduras, Almacén u Ofertas", para mensajes de error. */
export function listCategories() {
  const all = [...PRODUCT_CATEGORIES];
  const last = all.pop();
  return `${all.join(', ')} u ${last}`;
}

/** Filtro de la tienda: una categoría o todas. */
export type CategoryFilter = ProductCategory | 'Todas';
