import { NextResponse } from 'next/server';
import { sanitizeId } from '@/lib/sanitize';
import { hasPrismaCode, prisma } from '@/lib/prisma';
import { siteConfig } from '@/lib/site';
import { ORDER_CAPS, enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { logSecurityEvent } from '@/lib/security-log';
import { readJsonBody } from '@/lib/request-body';
import { formatArs } from '@/lib/format-price';
import { buildOrderLines, computeTotals, detectPriceChanges, roundMoney, splitPriceChanges, type OrderLine } from '@/lib/pricing';
import { isProductUnit } from '@/lib/product-units';
import { isPaymentMethod } from '@/lib/order-options';
import type { DeliverySlot } from '@/lib/delivery-slots';
import { parseStoredOrderItems, slotFromId } from '@/lib/order-lifecycle';
import {
  ValidationError,
  checkDeliverySlot,
  parseCheckoutCart,
  parseCustomerPayload,
  parseDeliveryMethod,
  parseIdempotencyKey,
  parsePaymentMethod,
} from '@/lib/validation';
import type {
  CheckoutPriceChange,
  CheckoutPriceChangedResponse,
  CheckoutResponse,
  CheckoutSlotResponse,
  CheckoutUnavailableResponse,
  DeliveryMethod,
  OrderItem,
  PaymentMethod,
} from '@/lib/types';

export const runtime = 'nodejs';

type CheckoutBody = {
  cart?: unknown;
  deliveryMethod?: unknown;
  /** Pestañas viejas (antes de deliveryMethod). */
  isDelivery?: unknown;
  deliverySlot?: unknown;
  paymentMethod?: unknown;
  customer?: unknown;
  idempotencyKey?: unknown;
};

/** Lo que se lee de un pedido ya creado para responder un reintento. */
const EXISTING_ORDER_SELECT = {
  id: true,
  items: true,
  subtotal: true,
  shippingCost: true,
  total: true,
  paymentMethod: true,
  deliveryMethod: true,
  deliverySlot: true,
} as const;

type ExistingOrder = {
  id: number;
  items: unknown;
  subtotal: number;
  shippingCost: number;
  total: number;
  paymentMethod: string | null;
  deliveryMethod: string;
  deliverySlot: string | null;
};

/**
 * Respuesta del checkout. Solo lo que el navegador necesita para mostrar la
 * confirmación y armar el mensaje de WhatsApp: nada de la clave de
 * idempotencia ni de campos internos del pedido.
 */
function buildResponse(params: {
  orderId: number;
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  total: number;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  deliverySlot: DeliverySlot | null;
  priceDrops: CheckoutPriceChange[];
  yaExistia?: boolean;
}): CheckoutResponse {
  return {
    orderId: params.orderId,
    items: params.items,
    subtotal: params.subtotal,
    shippingCost: params.shippingCost,
    total: params.total,
    paymentMethod: params.paymentMethod,
    deliveryMethod: params.deliveryMethod,
    deliverySlot: params.deliverySlot,
    transferAlias: siteConfig.transferAlias,
    transferCbu: siteConfig.transferCbu,
    whatsappNumber: siteConfig.whatsappNumber,
    storeName: siteConfig.storeName,
    priceDrops: params.priceDrops,
    ...(params.yaExistia ? { yaExistia: true } : {}),
  };
}

function responseForExisting(order: ExistingOrder, now: Date) {
  return NextResponse.json(buildResponse({
    orderId: order.id,
    items: parseStoredOrderItems(order.items),
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    total: order.total,
    // Los pedidos anteriores a esta versión no guardaban el medio de pago.
    paymentMethod: isPaymentMethod(order.paymentMethod) ? order.paymentMethod : 'transfer',
    deliveryMethod: order.deliveryMethod === 'delivery' ? 'delivery' : 'pickup',
    deliverySlot: slotFromId(order.deliverySlot, now),
    // El pedido ya se creó con los precios de ese momento: no hay nada nuevo que avisar.
    priceDrops: [],
    yaExistia: true,
  }));
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

const PATH = '/api/checkout';
const TOO_MANY_ORDERS_MESSAGE = 'Estás haciendo muchos pedidos seguidos. Esperá unos minutos.';

/**
 * Topes de pedidos contados en la base (ver ORDER_CAPS): por teléfono y de toda
 * la tienda. Devuelve la respuesta de corte, o null si el pedido puede entrar.
 * A diferencia del rate limit en memoria, valen para todas las instancias y
 * todas las IPs: frenan el spam de pedidos falsos que taparía los reales.
 */
async function checkOrderCaps(request: Request, customerPhone: string, now: Date) {
  const [samePhone, lastHour] = await Promise.all([
    // Usa el índice (customerPhone, createdAt). Los cancelados no cuentan: si el
    // dueño cancela pedidos repetidos, el cliente puede volver a pedir.
    prisma.order.count({
      where: {
        customerPhone,
        createdAt: { gte: new Date(now.getTime() - ORDER_CAPS.perPhone.windowMs) },
        status: { not: 'cancelled' },
      },
    }),
    // Sin los cancelados: si llega spam y el dueño lo cancela desde el panel, la
    // tienda vuelve a aceptar pedidos al instante (igual que el tope por teléfono).
    prisma.order.count({
      where: {
        createdAt: { gte: new Date(now.getTime() - ORDER_CAPS.global.windowMs) },
        status: { not: 'cancelled' },
      },
    }),
  ]);

  const ip = getClientIp(request);
  if (samePhone >= ORDER_CAPS.perPhone.limit) {
    // Sin el teléfono en el log: es un dato personal y no hace falta para investigar.
    logSecurityEvent('rate_limit', { ip, path: PATH, method: 'POST', reason: `tope de ${ORDER_CAPS.perPhone.limit} pedidos por teléfono en 24 h` });
    return NextResponse.json(
      { error: 'Ya hiciste varios pedidos con este teléfono en las últimas 24 horas. Si necesitás otro, escribinos por WhatsApp.' },
      { status: 429 },
    );
  }
  if (lastHour >= ORDER_CAPS.global.limit) {
    logSecurityEvent('rate_limit', { ip, path: PATH, method: 'POST', reason: `tope global de ${ORDER_CAPS.global.limit} pedidos por hora` });
    return NextResponse.json(
      { error: 'Estamos recibiendo demasiados pedidos. Probá en unos minutos o escribinos por WhatsApp.' },
      { status: 503, headers: { 'Retry-After': '300' } },
    );
  }
  return null;
}

/**
 * Crea un pedido.
 *
 * El orden de los pasos importa (ver comentarios): el reintento se resuelve
 * antes que cualquier validación de precios, y nada se escribe hasta que el
 * pedido está completo y es exactamente lo que el cliente vio.
 */
export async function POST(request: Request) {
  // Cupo de INTENTOS (válidos o no): generoso, para que corregir el formulario o
  // un 409 de precios no deje a nadie afuera. Los pedidos creados tienen su
  // propio cupo, más chico, que se consume recién antes de grabar (paso 6).
  const limited = enforceRateLimit(request, 'checkout', TOO_MANY_ORDERS_MESSAGE);
  if (limited) return limited;

  const parsed = await readJsonBody<CheckoutBody>(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.data !== null && typeof parsed.data === 'object' ? parsed.data : {}) as CheckoutBody;

  // Una sola hora para todo el pedido: el turno y las ofertas se evalúan contra
  // el mismo instante.
  const now = new Date();

  try {
    // ---- 1. Idempotencia ----
    // Si el navegador ya mandó este pedido (doble toque, conexión lenta, botón
    // de recargar), se devuelve el que se creó. Va ANTES de validar precios y
    // turnos: un reintento no puede fallar porque justo cambió un precio o pasó
    // la hora del turno después de haberse registrado el pedido.
    const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
    const existing = await prisma.order.findUnique({ where: { idempotencyKey }, select: EXISTING_ORDER_SELECT });
    if (existing) {
      return responseForExisting(existing, now);
    }

    // ---- 2. Datos del cliente, entrega y pago ----
    const deliveryMethod = parseDeliveryMethod(body);
    const isDelivery = deliveryMethod === 'delivery';
    const customer = parseCustomerPayload(body.customer, { isDelivery });
    const paymentMethod = parsePaymentMethod(body.paymentMethod);

    // ---- 3. Turno ----
    // Se valida con la hora del servidor: el reloj del celular del cliente puede
    // estar mal, y una pestaña abierta desde la mañana puede traer un turno que ya pasó.
    const slotCheck = checkDeliverySlot(body.deliverySlot, deliveryMethod, now);
    if (!slotCheck.ok) {
      return NextResponse.json(
        { error: slotCheck.message, code: 'TURNO_NO_DISPONIBLE', availableSlots: slotCheck.availableSlots } satisfies CheckoutSlotResponse,
        { status: 400 },
      );
    }

    // ---- 4. Productos y precios del servidor ----
    const cart = parseCheckoutCart(body.cart);
    // Mismo criterio que buildOrderLines: un id gigante (fuera de un Int de la
    // base) o mal tipado (true, [1], "0x1") se descarta en vez de llegar a Prisma.
    const productIds = [...new Set(cart.map((item) => sanitizeId(item.id)).filter((id): id is number => id !== null))];

    // Directo de la base y no de la caché del catálogo: lo que se cobra tiene
    // que ser el precio de este momento.
    const rows = productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, price: true, unit: true, available: true, offerPrice: true, offerEndsAt: true },
        })
      : [];
    const products = rows.map((row) => ({ ...row, unit: isProductUnit(row.unit) ? row.unit : ('kg' as const) }));

    const { lines, missingIds, unavailable } = buildOrderLines(cart, products, now);

    // Sin stock o borrado del catálogo mientras el cliente armaba el carrito.
    // El front ya no deja agregarlos, pero no alcanza con esa validación.
    if (missingIds.length > 0 || unavailable.length > 0) {
      const parts: string[] = [];
      if (unavailable.length > 0) {
        parts.push(`Se quedaron sin stock: ${unavailable.map((product) => product.name).join(', ')}.`);
      }
      if (missingIds.length > 0) {
        parts.push(missingIds.length === 1 ? 'Un producto ya no está en el catálogo.' : 'Algunos productos ya no están en el catálogo.');
      }
      return NextResponse.json(
        {
          error: `${parts.join(' ')} Sacalos del carrito para seguir.`,
          code: 'SIN_STOCK',
          unavailableIds: [...unavailable.map((product) => product.id), ...missingIds],
        } satisfies CheckoutUnavailableResponse,
        { status: 409 },
      );
    }

    if (lines.length === 0) {
      return badRequest('No hay productos válidos en el carrito.');
    }

    // Si el dueño SUBIÓ un precio (o venció una oferta) mientras el cliente
    // armaba el pedido, NO se crea el pedido: se le muestra la diferencia y él
    // decide. Nunca se le cobra más de lo que vio. Si solo bajaron, se cobra el
    // precio menor sin frenarlo (no hace falta su aprobación) y se le avisa.
    // En el 409 van todos los cambios, también los que bajaron, para que el
    // carrito quede con el total que de verdad se va a cobrar.
    const priceChanges = detectPriceChanges(cart, lines);
    const { increases, drops: priceDrops } = splitPriceChanges(priceChanges);

    // Una baja también puede terminar cobrando MÁS: si deja el subtotal debajo
    // del umbral de envío gratis, se empieza a cobrar el envío; si lo deja
    // debajo del mínimo, el pedido no se puede hacer. Se comparan los totales
    // con los precios que vio el cliente y, si el total sube o el mínimo deja de
    // alcanzar, se frena igual que con una suba (el carrito se actualiza).
    const seenPrice = new Map(priceChanges.map((change) => [change.id, change.previousPrice]));
    const seenTotals = computeTotals(
      lines.map((line) => ({ ...line, price: seenPrice.get(line.id) ?? line.price })),
      isDelivery,
      siteConfig,
    );
    const currentTotals = computeTotals(lines, isDelivery, siteConfig);
    const dropsChangeTheDeal = priceDrops.length > 0 && (
      currentTotals.total > seenTotals.total
      || (currentTotals.belowDeliveryMinimum && !seenTotals.belowDeliveryMinimum)
    );

    if (increases.length > 0 || dropsChangeTheDeal) {
      return NextResponse.json(
        {
          error: 'Cambiaron algunos precios mientras armabas el pedido. Revisá el carrito antes de confirmar.',
          code: 'PRECIOS_CAMBIARON',
          priceChanges,
        } satisfies CheckoutPriceChangedResponse,
        { status: 409 },
      );
    }

    // ---- 5. Totales y mínimo de envío (sobre el subtotal, sin el envío) ----
    const totals = currentTotals;

    // Defensa en profundidad: la validación del panel ya no deja guardar precios
    // de $ 0, pero si alguno quedó cargado de antes no se registra un pedido gratis.
    const zeroPriced = lines.filter((line) => line.price <= 0);
    if (totals.subtotal <= 0 || zeroPriced.length > 0) {
      console.error('Error en POST /api/checkout: producto con precio 0 en el catálogo:', zeroPriced.map((line) => line.id));
      return badRequest('Hay un producto sin precio cargado. Escribinos por WhatsApp para hacer el pedido.');
    }
    if (totals.belowDeliveryMinimum) {
      const missing = roundMoney(siteConfig.deliveryMinPurchase - totals.subtotal);
      return badRequest(
        `El pedido mínimo para envío es ${formatArs(siteConfig.deliveryMinPurchase)} en productos. Te faltan ${formatArs(missing)}, o podés retirarlo en el local.`,
      );
    }

    // ---- 6. Topes de spam y crear el pedido ----
    // Recién acá, con el pedido completo y válido, se gasta el cupo de pedidos
    // creados (en memoria, por IP) y se miran los topes de la base.
    const createLimited = enforceRateLimit(request, 'checkoutCreate', TOO_MANY_ORDERS_MESSAGE);
    if (createLimited) return createLimited;
    const capped = await checkOrderCaps(request, customer.customerPhone, now);
    if (capped) return capped;

    const items: OrderLine[] = lines;
    try {
      const order = await prisma.order.create({
        data: {
          items,
          subtotal: totals.subtotal,
          shippingCost: totals.shippingCost,
          total: totals.total,
          status: 'pending',
          deliveryMethod,
          paymentMethod,
          deliverySlot: slotCheck.slot?.id ?? null,
          idempotencyKey,
          ...customer,
        },
        select: { id: true },
      });

      return NextResponse.json(buildResponse({
        orderId: order.id,
        // Los ítems como los calculó el servidor (precio vigente, cantidad
        // normalizada): el mensaje de WhatsApp se arma con esto y no con lo que
        // tenía el carrito.
        items,
        subtotal: totals.subtotal,
        shippingCost: totals.shippingCost,
        total: totals.total,
        paymentMethod,
        deliveryMethod,
        deliverySlot: slotCheck.slot,
        priceDrops,
      }));
    } catch (error) {
      // P2002 = violación de índice único. Pasa cuando dos requests con la misma
      // clave llegan tan juntos que ambos pasaron el findUnique de arriba. Gana
      // el primero; el segundo devuelve ese mismo pedido.
      if (hasPrismaCode(error, 'P2002')) {
        const winner = await prisma.order.findUnique({ where: { idempotencyKey }, select: EXISTING_ORDER_SELECT });
        if (winner) return responseForExisting(winner, now);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return badRequest(error.message);
    }
    console.error('Error en POST /api/checkout:', error);
    return NextResponse.json({ error: 'No se pudo registrar el pedido. Probá de nuevo en un rato.' }, { status: 500 });
  }
}
