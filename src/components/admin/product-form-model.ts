import type { Product, ProductPayload } from '@/lib/types';
import type { ProductUnit } from '@/lib/product-units';
import type { ProductCategory } from '@/lib/product-categories';
import { formatArs } from '@/lib/format-price';
import { roundMoney } from '@/lib/pricing';
import { formatMoneyInput, parseMoneyInput, shiftDate, toArgentinaDate } from './format';
import { errorFromBody } from './api';

/**
 * Validación del formulario de producto en el navegador.
 *
 * El servidor valida todo de nuevo (src/lib/validation.ts); esto existe para
 * que el dueño vea el error al lado del campo mientras escribe, en vez de un
 * cartel después de apretar "Guardar". Los topes son los mismos del servidor.
 */

export const MAX_NAME_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 500;
const MAX_PRICE = 10_000_000;
const MAX_OFFER_DAYS_AHEAD = 366;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ProductFormState = {
  name: string;
  price: string;
  unit: ProductUnit;
  category: ProductCategory;
  description: string;
  offerPrice: string;
  /** "YYYY-MM-DD" o vacío. */
  offerEndsAt: string;
  image: string;
};

export type ProductFormErrors = Partial<Record<keyof ProductFormState, string>>;

export const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: '',
  price: '',
  unit: 'kg',
  category: 'Verduras',
  description: '',
  offerPrice: '',
  offerEndsAt: '',
  image: '',
};

/** Oferta que ya venció al abrir el formulario (para avisarle al dueño). */
export type ExpiredOffer = { offerPrice: number; endedOn: string };

/**
 * Producto guardado → formulario. Una oferta vencida NO se precarga: si se
 * mandara de nuevo su fecha, el servidor rechazaría el guardado ("la fecha ya
 * pasó") aunque el dueño solo quisiera cambiar la foto. Se avisa aparte.
 */
export function productToFormState(product: Product, now: Date = new Date()): { form: ProductFormState; expiredOffer: ExpiredOffer | null } {
  const form: ProductFormState = {
    name: product.name,
    price: formatMoneyInput(product.price),
    unit: product.unit,
    category: product.category,
    description: product.description ?? '',
    offerPrice: '',
    offerEndsAt: '',
    image: product.image ?? '',
  };

  if (product.offerPrice === null || product.offerPrice === undefined) {
    return { form, expiredOffer: null };
  }

  const endsAt = product.offerEndsAt ? new Date(product.offerEndsAt) : null;
  if (endsAt && endsAt.getTime() <= now.getTime()) {
    return { form, expiredOffer: { offerPrice: product.offerPrice, endedOn: toArgentinaDate(endsAt) } };
  }

  form.offerPrice = formatMoneyInput(product.offerPrice);
  form.offerEndsAt = endsAt ? toArgentinaDate(endsAt) : '';
  return { form, expiredOffer: null };
}

export type OfferValidation = {
  errors: Pick<ProductFormErrors, 'offerPrice' | 'offerEndsAt'>;
  offerPrice: number | null;
  offerEndsAt: string | null;
};

/** Último día que se puede elegir como vencimiento (el servidor permite hasta un año). */
export function maxOfferDate(today: string) {
  return shiftDate(today, MAX_OFFER_DAYS_AHEAD - 1);
}

/**
 * Precio de oferta y vencimiento. `price` es el precio normal ya parseado (o
 * null si todavía no es válido: en ese caso no se compara).
 */
export function validateOffer(price: number | null, offerText: string, dateText: string, today: string): OfferValidation {
  const errors: OfferValidation['errors'] = {};
  const parsedOffer = parseMoneyInput(offerText);
  let offerPrice: number | null = null;

  if (parsedOffer === null) {
    if (dateText) errors.offerEndsAt = 'Para ponerle vencimiento, cargá también el precio de oferta.';
  } else if (Number.isNaN(parsedOffer)) {
    errors.offerPrice = 'Escribí el precio de oferta en números (ej: 1200).';
  } else if (price !== null && !Number.isNaN(price) && parsedOffer >= price) {
    errors.offerPrice = `La oferta tiene que ser menor que el precio normal (${formatArs(price)}).`;
  } else {
    offerPrice = roundMoney(parsedOffer);
  }

  let offerEndsAt: string | null = null;
  if (dateText && parsedOffer !== null) {
    if (!DATE_PATTERN.test(dateText)) {
      errors.offerEndsAt = 'Elegí una fecha válida.';
    } else if (dateText < today) {
      errors.offerEndsAt = 'Esa fecha ya pasó.';
    } else if (dateText > maxOfferDate(today)) {
      errors.offerEndsAt = 'La oferta no puede durar más de un año.';
    } else {
      offerEndsAt = dateText;
    }
  }

  return { errors, offerPrice, offerEndsAt };
}

/**
 * Mensaje de una subida de foto que falló. Un 413 que no trae el JSON de
 * nuestra API es el corte de Vercel (más de 4,5 MB, FUNCTION_PAYLOAD_TOO_LARGE):
 * antes se mostraba "No se pudo subir la imagen", que no dice qué hacer.
 */
export const IMAGE_TOO_LARGE_MESSAGE = 'La imagen es muy pesada. Probá con otra foto o con una captura de menor tamaño.';

export function uploadErrorMessage(status: number, body: unknown, fallback: string) {
  const serverMessage = errorFromBody(body, '');
  if (serverMessage) return serverMessage;
  return status === 413 ? IMAGE_TOO_LARGE_MESSAGE : fallback;
}

function validateImage(image: string) {
  if (!image) return null;
  // Igual que el servidor: "/\otro-sitio" el navegador lo resuelve como "//otro-sitio".
  if (!image.includes('\\') && image.startsWith('/') && !image.startsWith('//')) return null;
  if (/^https?:\/\/\S+$/i.test(image)) return null;
  return 'Poné una dirección que empiece con https:// o subí una foto.';
}

/** Valida todo el formulario y, si está bien, arma el cuerpo para la API. */
export function validateProductForm(form: ProductFormState, today: string): { errors: ProductFormErrors; payload: ProductPayload | null } {
  const errors: ProductFormErrors = {};

  const name = form.name.trim();
  if (!name) errors.name = 'Poné el nombre del producto.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = `El nombre puede tener hasta ${MAX_NAME_LENGTH} caracteres.`;

  const price = parseMoneyInput(form.price);
  if (price === null) errors.price = 'Poné el precio.';
  else if (Number.isNaN(price)) errors.price = 'Escribí el precio en números (ej: 1500).';
  else if (price > MAX_PRICE) errors.price = 'El precio es demasiado alto. Revisalo.';

  const description = form.description.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `La descripción puede tener hasta ${MAX_DESCRIPTION_LENGTH} caracteres (tiene ${description.length}).`;
  }

  const image = form.image.trim();
  const imageError = validateImage(image);
  if (imageError) errors.image = imageError;

  const validPrice = price !== null && !Number.isNaN(price) ? price : null;
  const offer = validateOffer(validPrice, form.offerPrice, form.offerEndsAt, today);
  Object.assign(errors, offer.errors);

  if (Object.keys(errors).length > 0 || validPrice === null) {
    return { errors, payload: null };
  }

  return {
    errors,
    payload: {
      name,
      price: roundMoney(validPrice),
      unit: form.unit,
      category: form.category,
      image,
      // Vacío = null explícito: así al editar se borra lo que había.
      description: description || null,
      offerPrice: offer.offerPrice,
      offerEndsAt: offer.offerPrice === null ? null : offer.offerEndsAt,
    },
  };
}

/** "-20%" de una oferta sobre el precio normal (0 si no aplica). */
export function discountPercent(price: number | null, offerPrice: number | null) {
  if (price === null || offerPrice === null || Number.isNaN(price) || Number.isNaN(offerPrice)) return 0;
  if (price <= 0 || offerPrice >= price) return 0;
  return Math.round((1 - offerPrice / price) * 100);
}

/**
 * Precio con un descuento redondeado a $10 (los precios de verdulería son
 * redondos). Si el redondeo lo deja igual al precio normal (productos muy
 * baratos), se usa el valor exacto.
 */
export function discountedPrice(price: number, percent: number) {
  const exact = roundMoney(price * (1 - percent / 100));
  const rounded = Math.round(exact / 10) * 10;
  return rounded > 0 && rounded < price ? rounded : exact;
}
