import { isProductUnit } from './product-units';
import { isProductCategory, type ProductCategory } from './product-categories';
import { sanitizeNumber, sanitizeText } from './sanitize';

const MAX_NAME_LENGTH = 120;
const MAX_IMAGE_URL_LENGTH = 2048;
// Techo de cordura: ningún producto de verdulería vale más que esto, y evita
// que un error de tipeo (o un request armado a mano) meta un precio absurdo.
const MAX_PRICE = 10_000_000;

export type ProductCreatePayload = {
  name: string;
  price: number;
  image: string;
  unit: 'kg' | 'g' | 'unidad';
  category: ProductCategory;
  available: boolean;
};

export type ProductUpdatePayload = Partial<ProductCreatePayload>;

type ProductPayloadInput = {
  name?: unknown;
  price?: unknown;
  image?: unknown;
  unit?: unknown;
  category?: unknown;
  available?: unknown;
};

/**
 * La imagen es opcional, pero si viene tiene que ser una URL http(s) o una ruta
 * relativa del propio sitio. Sin esto se podían guardar cosas como `javascript:...`
 * o `data:text/html,...`, que después terminan renderizadas en la tienda.
 */
function parseImageUrl(value: unknown) {
  const image = sanitizeText(value, { maxLength: MAX_IMAGE_URL_LENGTH, singleLine: true }) ?? '';
  if (!image) return '';

  // Ruta relativa propia (ej: /product-placeholder.svg). Se descarta `//host`
  // porque es una URL protocol-relative a otro dominio.
  if (image.startsWith('/') && !image.startsWith('//')) {
    return image;
  }

  let parsed: URL;
  try {
    parsed = new URL(image);
  } catch {
    throw new Error('La imagen debe ser una URL válida o una ruta que empiece con "/".');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('La imagen solo puede ser una URL http o https.');
  }

  return parsed.toString();
}

export function parseProductPayload(payload: unknown, options?: { partial?: false }): ProductCreatePayload;
export function parseProductPayload(payload: unknown, options: { partial: true }): ProductUpdatePayload;
export function parseProductPayload(payload: unknown, options: { partial?: boolean } = {}) {
  const body = (payload ?? {}) as ProductPayloadInput;
  const partial = options.partial ?? false;
  const data: ProductUpdatePayload = {};

  if (!partial || body.name !== undefined) {
    const name = sanitizeText(body.name, { maxLength: MAX_NAME_LENGTH, singleLine: true });
    if (!name) {
      throw new Error('El nombre del producto es obligatorio.');
    }
    data.name = name;
  }

  if (!partial || body.price !== undefined) {
    const price = sanitizeNumber(body.price, { min: 0, max: MAX_PRICE, decimals: 2 });
    if (price === null) {
      throw new Error(`El precio debe ser un número entre 0 y ${MAX_PRICE}.`);
    }
    data.price = price;
  }

  if (!partial || body.image !== undefined) {
    data.image = parseImageUrl(body.image);
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

  if (!partial || body.available !== undefined) {
    // Al crear, si no viene el campo el producto nace disponible.
    if (body.available === undefined) {
      data.available = true;
    } else if (typeof body.available === 'boolean') {
      data.available = body.available;
    } else {
      throw new Error('La disponibilidad debe ser verdadero o falso.');
    }
  }

  return data;
}