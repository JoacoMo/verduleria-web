import { PRODUCT_UNITS, isProductUnit, type ProductUnit } from './product-units';
import { isProductCategory, listCategories, type ProductCategory } from './product-categories';
import { sanitizeId, sanitizeNumber, sanitizeText } from './sanitize';
import {
  isPaymentMethod,
  isReplacementPolicy,
  type DeliveryMethod,
  type PaymentMethod,
  type ReplacementPolicy,
} from './order-options';
import { findAvailableSlot, getUpcomingSlots, type DeliverySlot } from './delivery-slots';
import { formatArs } from './format-price';

/**
 * Validación de lo que entra por request.
 *
 * Todo acá es puro (sin base ni reloj implícito: la hora entra por parámetro)
 * para poder testearlo sin levantar nada. Los handlers llaman a estas funciones,
 * atrapan ValidationError y la devuelven como 400; cualquier otro error es un
 * bug o una caída y se responde genérico.
 */

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

/**
 * Error en un ítem puntual de una lista (actualización masiva de productos).
 * Lleva la posición para que el script que llamó sepa qué fila corregir.
 */
export class ItemValidationError extends ValidationError {
  readonly index: number;

  constructor(message: string, index: number) {
    super(message);
    this.name = 'ItemValidationError';
    this.index = index;
  }
}

/* -------------------------------------------------------------------------- */
/* Fechas                                                                     */
/* -------------------------------------------------------------------------- */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "YYYY-MM-DD" que existe en el calendario. El regex solo no alcanza: dejaría
 * pasar un 2026-02-30, que `new Date` convierte en silencio al 2 de marzo.
 */
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Argentina usa UTC-3 todo el año (no tiene horario de verano desde 2009), así
 * que el fin de un día local se puede escribir con el offset fijo.
 */
export function endOfArgentinaDay(date: string) {
  return new Date(`${date}T23:59:59.999-03:00`);
}

/* -------------------------------------------------------------------------- */
/* Productos                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_NAME_LENGTH = 120;
const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_DESCRIPTION_LENGTH = 500;
// Techo de cordura: ningún producto de verdulería vale más que esto, y evita
// que un error de tipeo (o un request armado a mano) meta un precio absurdo.
const MAX_PRICE = 10_000_000;
// Una oferta que "vence" en 2062 casi seguro es un error de tipeo de 2026.
const MAX_OFFER_DAYS_AHEAD = 366;

export type ProductCreatePayload = {
  name: string;
  price: number;
  image: string;
  unit: ProductUnit;
  category: ProductCategory;
  description: string | null;
  offerPrice: number | null;
  /** Fin del día elegido, hora argentina. */
  offerEndsAt: Date | null;
  available: boolean;
};

export type ProductUpdatePayload = Partial<ProductCreatePayload>;

type ProductPayloadInput = {
  name?: unknown;
  price?: unknown;
  image?: unknown;
  unit?: unknown;
  category?: unknown;
  description?: unknown;
  offerPrice?: unknown;
  offerEndsAt?: unknown;
  available?: unknown;
};

/** "kg, g, unidad, atado o bandeja", para mensajes de error. */
function listUnits() {
  const all = [...PRODUCT_UNITS];
  const last = all.pop();
  return `${all.join(', ')} o ${last}`;
}

// Letras o números de cualquier idioma. Se arma con new RegExp para no depender
// del target de TypeScript con la bandera "u".
const LETTER_OR_DIGIT = new RegExp('[\\p{L}\\p{N}]', 'gu');

/** Cuántas letras o dígitos tiene un texto: un nombre hecho solo de símbolos o espacios raros no sirve. */
function countLettersOrDigits(text: string) {
  return text.match(LETTER_OR_DIGIT)?.length ?? 0;
}

/**
 * La imagen es opcional, pero si viene tiene que ser una URL http(s) o una ruta
 * relativa del propio sitio. Sin esto se podían guardar cosas como `javascript:...`
 * o `data:text/html,...`, que después terminan renderizadas en la tienda.
 */
function parseImageUrl(value: unknown) {
  const image = sanitizeText(value, { maxLength: MAX_IMAGE_URL_LENGTH, singleLine: true }) ?? '';
  if (!image) return '';

  // Ruta relativa propia (ej: /product-placeholder.svg). Se resuelve contra un
  // origen ficticio y se exige que siga siendo ese origen: así se descartan
  // `//host` y también `/\host`, que el navegador convierte en `//host`.
  if (image.startsWith('/')) {
    const base = 'https://ruta-relativa.invalid';
    let resolved: URL;
    try {
      resolved = new URL(image, base);
    } catch {
      throw new ValidationError('La imagen debe ser una URL válida o una ruta que empiece con "/".');
    }
    if (image.includes('\\') || resolved.origin !== base) {
      throw new ValidationError('La ruta de la imagen tiene que ser un archivo del propio sitio (ej: /product-placeholder.svg).');
    }
    return `${resolved.pathname}${resolved.search}`;
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

// Un precio de $ 0 es siempre un error de tipeo: con retiro no hay mínimo, así
// que cualquiera podía hacer pedidos de $ 0. Se exige más de 0.
function parsePrice(value: unknown) {
  const price = sanitizeNumber(value, { min: 0, max: MAX_PRICE, decimals: 2 });
  if (price === null || price <= 0) {
    throw new ValidationError(`El precio debe ser un número mayor a 0 y hasta ${formatArs(MAX_PRICE)}.`);
  }
  return price;
}

/** undefined = no vino (no tocar); null o "" = sin oferta. */
export function parseOfferPrice(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const offerPrice = sanitizeNumber(value, { min: 0, max: MAX_PRICE, decimals: 2 });
  if (offerPrice === null || offerPrice <= 0) {
    throw new ValidationError(`El precio de oferta debe ser mayor a 0 y hasta ${formatArs(MAX_PRICE)}. Para sacar la oferta, dejalo vacío.`);
  }
  return offerPrice;
}

/**
 * Vencimiento de la oferta: "YYYY-MM-DD" = vence al terminar ese día en
 * Córdoba. Así el dueño elige "hasta el domingo" y la oferta dura todo el
 * domingo, no hasta las 00:00 UTC (que serían las 21 h del sábado acá).
 *
 * undefined = no vino; null o "" = sin vencimiento.
 */
export function parseOfferEndsAt(value: unknown, now: Date = new Date()): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value.trim())) {
    throw new ValidationError('La fecha de vencimiento de la oferta tiene que tener el formato AAAA-MM-DD.');
  }
  const date = value.trim();
  if (!isValidCalendarDate(date)) {
    throw new ValidationError('La fecha de vencimiento de la oferta no existe. Revisala.');
  }

  const endsAt = endOfArgentinaDay(date);
  if (endsAt.getTime() <= now.getTime()) {
    throw new ValidationError('La fecha de vencimiento de la oferta ya pasó.');
  }
  if (endsAt.getTime() - now.getTime() > MAX_OFFER_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
    throw new ValidationError('La oferta no puede durar más de un año. Revisá la fecha de vencimiento.');
  }
  return endsAt;
}

/**
 * Saca los espacios y tabs del final de un renglón recorriendo de atrás para
 * adelante. Lineal a propósito: /[ \t]+$/ (o /[ \t]+\n/g) prueba desde cada
 * posición y con "a" + 99.000 espacios + "a" tardaba segundos (ReDoS).
 */
function trimLineEnd(line: string) {
  let end = line.length;
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
  return end === line.length ? line : line.slice(0, end);
}

/**
 * Renglones sin espacios al final y nunca más de un renglón en blanco seguido
 * (el equivalente lineal de .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')).
 */
function tidyMultilineText(text: string) {
  const lines: string[] = [];
  let previousBlank = false;
  for (const raw of text.split('\n')) {
    const line = trimLineEnd(raw);
    const blank = line === '';
    if (blank && previousBlank) continue;
    lines.push(line);
    previousBlank = blank;
  }
  return lines.join('\n');
}

/** undefined = no vino; null o "" = sin descripción. */
function parseDescription(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError('La descripción tiene que ser texto.');
  }

  // Corte barato ANTES de cualquier regex o limpieza: nada legítimo se acerca a
  // esto (el tope real, después de limpiar, es MAX_DESCRIPTION_LENGTH).
  if (value.length > MAX_DESCRIPTION_LENGTH * 4) {
    throw new ValidationError(`La descripción puede tener hasta ${MAX_DESCRIPTION_LENGTH} caracteres (tiene ${value.length}).`);
  }

  // Se permiten saltos de línea (en los bolsones se usan para listar qué trae),
  // pero no más de una línea en blanco seguida. No se recorta en silencio: si
  // el texto es largo se avisa, para que el dueño no pierda el final sin darse cuenta.
  const clean = tidyMultilineText(sanitizeText(value.replace(/\r\n?/g, '\n'), { maxLength: Number.MAX_SAFE_INTEGER }) ?? '');

  if (clean.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(`La descripción puede tener hasta ${MAX_DESCRIPTION_LENGTH} caracteres (tiene ${clean.length}).`);
  }
  return clean || null;
}

/** Precio y oferta de un producto tal como están guardados. */
export type PricingState = {
  price: number;
  offerPrice: number | null;
  offerEndsAt: Date | null;
};

export type PricingChange = {
  price?: number;
  offerPrice?: number | null;
  offerEndsAt?: Date | null;
};

/**
 * Una oferta nueva no hereda un vencimiento que ya pasó.
 *
 * Si se carga un precio de oferta sin fecha y el producto tenía guardada la
 * fecha de una oferta anterior ya vencida, sin esto la oferta nueva "nacía
 * vencida": la API respondía OK y la tienda seguía cobrando el precio normal.
 * Se interpreta como lo que es: una oferta sin vencimiento. Muta `change`.
 */
export function dropExpiredOfferEndsAt(change: PricingChange, current: PricingState | null, now: Date = new Date()) {
  if (typeof change.offerPrice !== 'number' || change.offerEndsAt !== undefined) return;
  const savedEndsAt = current?.offerEndsAt;
  if (savedEndsAt && savedEndsAt.getTime() <= now.getTime()) {
    change.offerEndsAt = null;
  }
}

/** El cambio toca precio u oferta: hay que mirar cómo queda contra lo guardado. */
export function touchesPricing(change: PricingChange) {
  return change.price !== undefined || change.offerPrice !== undefined || change.offerEndsAt !== undefined;
}

/**
 * Verifica que la oferta que quedaría después del cambio tenga sentido:
 * el precio de oferta tiene que ser MENOR que el normal.
 *
 * Se compara contra el precio que quedaría, no contra el que vino: en una
 * edición parcial puede venir solo la oferta (y se compara con el precio
 * guardado) o solo el precio (y se compara con la oferta guardada). En ese
 * último caso solo importa si la oferta sigue vigente: una vencida no se cobra
 * nunca, y frenar un cambio de precio por una oferta vieja sería un estorbo.
 *
 * `current` es null al crear (todo viene en el cambio).
 */
export function assertOfferConsistency(change: PricingChange, current: PricingState | null, now: Date = new Date()) {
  const price = change.price ?? current?.price;
  if (price === undefined) {
    throw new Error('assertOfferConsistency: falta el precio (ni en el cambio ni en lo guardado).');
  }
  const offerPrice = change.offerPrice !== undefined ? change.offerPrice : (current?.offerPrice ?? null);
  const offerEndsAt = change.offerEndsAt !== undefined ? change.offerEndsAt : (current?.offerEndsAt ?? null);

  if (offerPrice === null) {
    if (change.offerEndsAt) {
      throw new ValidationError('Para ponerle vencimiento a la oferta, cargá también el precio de oferta.');
    }
    return;
  }

  const offerSent = change.offerPrice !== undefined;
  const offerStillRunning = offerEndsAt === null || offerEndsAt.getTime() > now.getTime();
  if (!offerSent && !offerStillRunning) return;

  if (offerPrice >= price) {
    throw new ValidationError(
      offerSent
        ? `El precio de oferta (${formatArs(offerPrice)}) tiene que ser menor que el precio normal (${formatArs(price)}).`
        : `El precio nuevo (${formatArs(price)}) tiene que ser mayor que el de la oferta vigente (${formatArs(offerPrice)}). Cambiá o sacá la oferta.`,
    );
  }
}

/**
 * Valida y normaliza el cuerpo de crear (completo) o editar (parcial) un producto.
 *
 * Al crear, la regla oferta < precio se chequea acá mismo. Al editar, el handler
 * tiene que llamar a `assertOfferConsistency` con lo que está guardado, porque
 * puede venir solo uno de los dos precios.
 *
 * Poner `offerPrice: null` saca la oferta y también su vencimiento.
 */
export function parseProductPayload(payload: unknown, options?: { partial?: false; now?: Date }): ProductCreatePayload;
export function parseProductPayload(payload: unknown, options: { partial: true; now?: Date }): ProductUpdatePayload;
export function parseProductPayload(payload: unknown, options: { partial?: boolean; now?: Date } = {}) {
  const body = (payload !== null && typeof payload === 'object' ? payload : {}) as ProductPayloadInput;
  const partial = options.partial ?? false;
  const now = options.now ?? new Date();
  const data: ProductUpdatePayload = {};

  if (!partial || body.name !== undefined) {
    const name = sanitizeText(body.name, { maxLength: MAX_NAME_LENGTH, singleLine: true });
    if (!name || countLettersOrDigits(name) === 0) {
      throw new ValidationError('El nombre del producto es obligatorio.');
    }
    data.name = name;
  }

  if (!partial || body.price !== undefined) {
    data.price = parsePrice(body.price);
  }

  if (!partial || body.image !== undefined) {
    data.image = parseImageUrl(body.image);
  }

  if (!partial || body.unit !== undefined) {
    if (!isProductUnit(body.unit)) {
      throw new ValidationError(`La unidad debe ser ${listUnits()}.`);
    }
    data.unit = body.unit;
  }

  if (!partial || body.category !== undefined) {
    if (!isProductCategory(body.category)) {
      throw new ValidationError(`La categoría debe ser ${listCategories()}.`);
    }
    data.category = body.category;
  }

  const description = parseDescription(body.description);
  if (description !== undefined) data.description = description;
  else if (!partial) data.description = null;

  const offerPrice = parseOfferPrice(body.offerPrice);
  if (offerPrice !== undefined) data.offerPrice = offerPrice;
  else if (!partial) data.offerPrice = null;

  if (data.offerPrice === null) {
    // Sin precio de oferta no hay vencimiento que guardar: se limpia para que no
    // quede una fecha suelta que después "reviva" si se carga otra oferta. La
    // fecha que venga ni se mira: si el formulario trae una vieja, sacar la
    // oferta no tiene que fallar porque "la fecha ya pasó".
    data.offerEndsAt = null;
  } else {
    const offerEndsAt = parseOfferEndsAt(body.offerEndsAt, now);
    if (offerEndsAt !== undefined) data.offerEndsAt = offerEndsAt;
    else if (!partial) data.offerEndsAt = null;
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

  if (!partial) {
    assertOfferConsistency(data, null, now);
  }

  return data;
}

/* -------------------------------------------------------------------------- */
/* Actualización masiva de productos (POST /api/gestion/products/bulk)        */
/* -------------------------------------------------------------------------- */

export const MAX_BULK_UPDATES = 500;

export type BulkProductChange = {
  price?: number;
  available?: boolean;
  offerPrice?: number | null;
  offerEndsAt?: Date | null;
};

export type BulkProductUpdate = { id: number; data: BulkProductChange };

function parseBulkItem(raw: unknown, now: Date): BulkProductUpdate {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Cada actualización tiene que ser un objeto con "id".');
  }
  const item = raw as Record<string, unknown>;

  const id = sanitizeId(item.id);
  if (id === null) {
    throw new ValidationError('Falta el id del producto o no es un número entero positivo.');
  }

  const data: BulkProductChange = {};
  if (item.price !== undefined) data.price = parsePrice(item.price);
  if (item.available !== undefined) {
    if (typeof item.available !== 'boolean') {
      throw new ValidationError('La disponibilidad debe ser verdadero o falso.');
    }
    data.available = item.available;
  }
  const offerPrice = parseOfferPrice(item.offerPrice);
  if (offerPrice !== undefined) data.offerPrice = offerPrice;
  if (offerPrice === null) {
    // Igual que en el formulario: sacar la oferta limpia el vencimiento.
    data.offerEndsAt = null;
  } else {
    const offerEndsAt = parseOfferEndsAt(item.offerEndsAt, now);
    if (offerEndsAt !== undefined) data.offerEndsAt = offerEndsAt;
  }

  if (Object.keys(data).length === 0) {
    throw new ValidationError('No trae ningún cambio (price, available, offerPrice u offerEndsAt).');
  }
  return { id, data };
}

/**
 * Primera pasada del bulk: forma de cada ítem, sin mirar la base. Si un ítem
 * está mal se corta todo (no se escribe nada) y se informa cuál.
 */
export function parseBulkProductUpdates(payload: unknown, now: Date = new Date()): BulkProductUpdate[] {
  const updates = (payload as { updates?: unknown } | null)?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new ValidationError('Mandá "updates" con al menos una actualización.');
  }
  if (updates.length > MAX_BULK_UPDATES) {
    throw new ValidationError(`Se pueden actualizar hasta ${MAX_BULK_UPDATES} productos por vez (vinieron ${updates.length}).`);
  }

  const seen = new Set<number>();
  return updates.map((raw, index) => {
    try {
      const update = parseBulkItem(raw, now);
      if (seen.has(update.id)) {
        throw new ValidationError('El mismo producto viene dos veces.');
      }
      seen.add(update.id);
      return update;
    } catch (error) {
      throw toItemError(error, index, raw);
    }
  });
}

function toItemError(error: unknown, index: number, raw: unknown) {
  if (!(error instanceof ValidationError) || error instanceof ItemValidationError) return error;
  const id = sanitizeId((raw as { id?: unknown } | null)?.id);
  return new ItemValidationError(`Ítem ${index + 1}${id ? ` (producto ${id})` : ''}: ${error.message}`, index);
}

export type ResolvedBulkUpdates = {
  writes: BulkProductUpdate[];
  /** Ids que no existen en el catálogo: se informan y se saltean. */
  notFound: number[];
};

/**
 * Segunda pasada del bulk, con los precios guardados: separa los ids que no
 * existen y aplica la regla oferta < precio contra cómo quedaría cada producto.
 */
export function resolveBulkUpdates(
  updates: BulkProductUpdate[],
  current: Map<number, PricingState>,
  now: Date = new Date(),
): ResolvedBulkUpdates {
  const writes: BulkProductUpdate[] = [];
  const notFound: number[] = [];

  updates.forEach((update, index) => {
    const saved = current.get(update.id);
    if (!saved) {
      notFound.push(update.id);
      return;
    }
    try {
      dropExpiredOfferEndsAt(update.data, saved, now);
      assertOfferConsistency(update.data, saved, now);
    } catch (error) {
      throw toItemError(error, index, update);
    }
    writes.push(update);
  });

  return { writes, notFound };
}

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

const MAX_CUSTOMER_NAME_LENGTH = 80;
const MAX_ADDRESS_LENGTH = 200;
const MAX_NOTES_LENGTH = 500;
// Un carrito real no tiene 60 productos distintos; el tope corta el spam de pedidos.
export const MAX_CART_LINES = 60;

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
  const body = (payload !== null && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  const customerName = sanitizeText(body.customerName, { maxLength: MAX_CUSTOMER_NAME_LENGTH, singleLine: true });
  if (!customerName || countLettersOrDigits(customerName) < 2) {
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

/**
 * Retiro o envío. Una pestaña abierta antes del deploy manda `isDelivery`
 * (boolean) en vez de `deliveryMethod`: se acepta para no romperle el pedido.
 */
export function parseDeliveryMethod(body: { deliveryMethod?: unknown; isDelivery?: unknown }): DeliveryMethod {
  const { deliveryMethod } = body;
  if (deliveryMethod === 'pickup' || deliveryMethod === 'delivery') return deliveryMethod;
  if (deliveryMethod === undefined || deliveryMethod === null) {
    return body.isDelivery === true ? 'delivery' : 'pickup';
  }
  throw new ValidationError('Elegí si retirás en el local o te lo enviamos.');
}

/**
 * Medio de pago. Si no viene (pestaña abierta antes del deploy) se asume
 * transferencia. Cualquier otro valor (por ejemplo el pago con tarjeta que ya
 * no existe) se rechaza: mejor un mensaje claro que registrar un pedido que el
 * cliente cree que pagó de otra forma.
 */
export function parsePaymentMethod(value: unknown): PaymentMethod {
  if (value === undefined || value === null) return 'transfer';
  if (isPaymentMethod(value)) return value;
  throw new ValidationError('Elegí cómo vas a pagar: transferencia o efectivo.');
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

/**
 * Clave de idempotencia del navegador (crypto.randomUUID()).
 *
 * Se exige un mínimo de largo y solo caracteres seguros porque, si alguien
 * adivinara la clave de otro, el checkout le devolvería ESE pedido. Con un UUID
 * v4 (122 bits al azar) eso es imposible en la práctica; con "1234" no.
 */
export function parseIdempotencyKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ValidationError('No pudimos identificar el pedido. Recargá la página y probá de nuevo.');
  }
  return key;
}

export type SlotCheck =
  | { ok: true; slot: DeliverySlot | null }
  | { ok: false; message: string; availableSlots: DeliverySlot[] };

/**
 * Turno de entrega. Para retiro no hay turno (se ignora lo que venga). Para
 * envío tiene que ser uno de los que se ofrecen AHORA según la hora del
 * servidor: si el cliente dejó la pestaña abierta y el turno pasó, se le
 * devuelven los que siguen disponibles para que elija otro.
 */
export function checkDeliverySlot(value: unknown, deliveryMethod: DeliveryMethod, now: Date = new Date()): SlotCheck {
  if (deliveryMethod === 'pickup') return { ok: true, slot: null };

  const slot = findAvailableSlot(value, now);
  if (slot) return { ok: true, slot };

  const missing = value === undefined || value === null || value === '';
  return {
    ok: false,
    message: missing
      ? 'Elegí un turno de entrega.'
      : 'El turno que elegiste ya no está disponible. Elegí otro.',
    availableSlots: getUpcomingSlots(now),
  };
}

/** `price` es el precio unitario que vio el cliente (puede faltar en pestañas viejas). */
export type CheckoutCartItem = { id: unknown; quantity: unknown; price: unknown };

/**
 * Forma del carrito. Ids y cantidades se validan después contra el catálogo
 * (buildOrderLines), acá solo se corta lo que no puede ser un carrito.
 */
export function parseCheckoutCart(value: unknown): CheckoutCartItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('El carrito está vacío.');
  }
  if (value.length > MAX_CART_LINES) {
    throw new ValidationError('El carrito tiene demasiados productos.');
  }
  return value.filter(
    (item): item is CheckoutCartItem => item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

/* -------------------------------------------------------------------------- */
/* Ajuste de pedido con los pesos reales (PUT /api/gestion/orders/[id])       */
/* -------------------------------------------------------------------------- */

const MAX_ADJUSTMENT_ITEMS = 100;

export type OrderAdjustmentItem = { id: number; quantity: number };

export type OrderAdjustmentRequest = {
  items: OrderAdjustmentItem[];
  /**
   * El updatedAt del pedido que tenía el panel al abrir el editor. El ajuste
   * solo se graba si el pedido sigue en esa versión: si mientras tanto otro
   * dispositivo lo ajustó, confirmó o canceló, no se pisa en silencio.
   */
  expectedUpdatedAt: Date;
};

// toISOString() del panel ("2026-10-06T14:05:09.123Z"); se acepta también con offset.
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function parseExpectedUpdatedAt(value: unknown): Date {
  const date = typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value) ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new ValidationError('Falta la versión del pedido que estabas editando. Recargá el panel y volvé a cargar los pesos.');
  }
  return date;
}

/**
 * Forma del ajuste: `{ items: [{ id, quantity }], expectedUpdatedAt }`. Que los
 * ids sean del pedido y la normalización por unidad se resuelven con los ítems
 * guardados (applyOrderAdjustment en order-lifecycle.ts).
 */
export function parseOrderAdjustment(payload: unknown): OrderAdjustmentRequest {
  const body = (payload !== null && typeof payload === 'object' ? payload : {}) as { items?: unknown; expectedUpdatedAt?: unknown };
  const { items } = body;
  if (!Array.isArray(items)) {
    throw new ValidationError('Mandá la lista de productos del pedido con sus cantidades.');
  }
  if (items.length > MAX_ADJUSTMENT_ITEMS) {
    throw new ValidationError('El pedido tiene demasiados productos.');
  }

  const seen = new Set<number>();
  const parsedItems = items.map((raw): OrderAdjustmentItem => {
    const item = (raw !== null && typeof raw === 'object' ? raw : {}) as { id?: unknown; quantity?: unknown };
    const id = sanitizeId(item.id);
    if (id === null) {
      throw new ValidationError('Hay un producto sin id válido.');
    }
    if (seen.has(id)) {
      throw new ValidationError('Un producto aparece dos veces en el ajuste.');
    }
    seen.add(id);

    const quantity = sanitizeNumber(item.quantity, { min: 0, max: 1_000_000 });
    if (quantity === null) {
      throw new ValidationError('La cantidad de cada producto tiene que ser un número mayor o igual a 0.');
    }
    return { id, quantity };
  });

  return { items: parsedItems, expectedUpdatedAt: parseExpectedUpdatedAt(body.expectedUpdatedAt) };
}

/* -------------------------------------------------------------------------- */
/* Imágenes                                                                   */
/* -------------------------------------------------------------------------- */

export type AllowedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function asciiAt(bytes: Uint8Array, start: number, text: string) {
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[start + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Tipo real de una imagen según sus primeros bytes ("magic bytes").
 *
 * El tipo que declara el navegador (file.type) lo elige quien hace el request:
 * sin esto se podía subir un HTML con Content-Type image/png. Se reconocen solo
 * los tres formatos que acepta la tienda; cualquier otra cosa devuelve null.
 */
export function detectImageType(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    return 'image/png';
  }
  // WebP: "RIFF" + 4 bytes de tamaño + "WEBP".
  if (bytes.length >= 12 && asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) {
    return 'image/webp';
  }
  return null;
}
