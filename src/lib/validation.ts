import { isProductUnit } from './product-units';
import { isProductCategory, type ProductCategory } from './product-categories';

export type ProductCreatePayload = {
  name: string;
  price: number;
  image: string;
  unit: 'kg' | 'g' | 'unidad';
  category: ProductCategory;
};

export type ProductUpdatePayload = Partial<ProductCreatePayload>;

type ProductPayloadInput = {
  name?: unknown;
  price?: unknown;
  image?: unknown;
  unit?: unknown;
  category?: unknown;
};

export function parseProductPayload(payload: unknown, options?: { partial?: false }): ProductCreatePayload;
export function parseProductPayload(payload: unknown, options: { partial: true }): ProductUpdatePayload;
export function parseProductPayload(payload: unknown, options: { partial?: boolean } = {}) {
  const body = (payload ?? {}) as ProductPayloadInput;
  const partial = options.partial ?? false;
  const data: ProductUpdatePayload = {};

  if (!partial || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      throw new Error('El nombre del producto es obligatorio.');
    }
    data.name = name;
  }

  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('El precio debe ser un número válido mayor o igual a 0.');
    }
    data.price = price;
  }

  if (!partial || body.image !== undefined) {
    data.image = typeof body.image === 'string' ? body.image.trim() : '';
  }

  if (!partial || body.unit !== undefined) {
    if (!isProductUnit(body.unit)) {
      throw new Error('La unidad debe ser kg, g o unidad.');
    }
    data.unit = body.unit;
  }

  if (!partial || body.category !== undefined) {
    if (!isProductCategory(body.category)) {
      throw new Error('La categoría debe ser Frutas, Verduras, Almacén u Ofertas.');
    }
    data.category = body.category;
  }

  return data;
}