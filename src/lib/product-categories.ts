export const PRODUCT_CATEGORIES = ['Frutas', 'Verduras', 'Almacén', 'Ofertas'] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === 'string' && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}
