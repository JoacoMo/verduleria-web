import { isProductUnit } from './product-units';
import { isProductCategory, type ProductCategory } from './product-categories';
import { sanitizeNumber, sanitizeText } from './sanitize';
import { isReplacementPolicy, type ReplacementPolicy } from './order-options';

/**
 * Error de validación con un mensaje pensado para mostrarle al usuario.
 *
 * Se separa de un Error común para que los handlers sepan qué mensajes se pueden
 * devolver tal cual: antes cualquier error (incluidos los de Prisma, que traen
 * nombres de tablas y columnas) se mandaba al cliente como 400.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

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
    throw new ValidationError('La imagen debe ser una URL válida o una ruta que empiece con "/".');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('La imagen solo puede ser una URL http o https.');
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
      throw new ValidationError('El nombre del producto es obligatorio.');
    }
    data.name = name;
  }

  if (!partial || body.price !== undefined) {
    const price = sanitizeNumber(body.price, { min: 0, max: MAX_PRICE, decimals: 2 });
    if (price === null) {
      throw new ValidationError(`El precio debe ser un número entre 0 y ${MAX_PRICE}.`);
    }
    data.price = price;
  }

  if (!partial || body.image !== undefined) {
    data.image = parseImageUrl(body.image);
  }

  if (!partial || body.unit !== undefined) {
    if (!isProductUnit(body.unit)) {
      throw new ValidationError('La unidad debe ser kg, g o unidad.');
    }
    data.unit = body.unit;
  }

  if (!partial || body.category !== undefined) {
    if (!isProductCategory(body.category)) {
      throw new ValidationError('La categoría debe ser Frutas, Verduras, Almacén u Ofertas.');
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
      throw new ValidationError('La disponibilidad debe ser verdadero o falso.');
    }
  }

  return data;
}
const MAX_CUSTOMER_NAME_LENGTH = 80;
const MAX_ADDRESS_LENGTH = 200;
const MAX_NOTES_LENGTH = 500;

export type CustomerPayload = {
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  notes: string | null;
  replacementPolicy: ReplacementPolicy;
};

/**
 * Teléfono argentino "razonable": se quedan solo los dígitos y se exige un largo
 * de entre 8 y 15 (de un fijo local a un celular con +54 9). No se intenta
 * validar la numeración real: alcanza con que el dueño pueda escribirle.
 */
function parsePhone(value: unknown) {
  const raw = sanitizeText(value, { maxLength: 40, singleLine: true }) ?? '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw new ValidationError('Ingresá un teléfono válido (con código de área, sin el 15).');
  }
  return digits;
}

/**
 * Datos de contacto y entrega que manda el checkout.
 * La dirección es obligatoria solo si el pedido es con envío.
 */
export function parseCustomerPayload(payload: unknown, options: { isDelivery: boolean }): CustomerPayload {
  const body = (payload ?? {}) as Record<string, unknown>;

  const customerName = sanitizeText(body.customerName, { maxLength: MAX_CUSTOMER_NAME_LENGTH, singleLine: true });
  if (!customerName || customerName.length < 2) {
    throw new ValidationError('Ingresá tu nombre para saber de quién es el pedido.');
  }

  const customerPhone = parsePhone(body.customerPhone);

  const address = sanitizeText(body.customerAddress, { maxLength: MAX_ADDRESS_LENGTH, singleLine: true }) || null;
  if (options.isDelivery && (!address || address.length < 5)) {
    throw new ValidationError('Para el envío necesitamos la dirección (calle, número y barrio).');
  }

  const notes = sanitizeText(body.notes, { maxLength: MAX_NOTES_LENGTH }) || null;

  // Si no viene, se asume la opción más común (reemplazar por similar).
  const replacementPolicy = isReplacementPolicy(body.replacementPolicy) ? body.replacementPolicy : 'replace';

  return {
    customerName,
    customerPhone,
    customerAddress: options.isDelivery ? address : null,
    notes,
    replacementPolicy,
  };
}
