import { NextResponse } from 'next/server';
import { sanitizeId } from '@/lib/sanitize';
import { hasPrismaCode, prisma } from '@/lib/prisma';
import { siteConfig } from '@/lib/site';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/request-body';
import { formatArs } from '@/lib/format-price';
import { buildOrderLines, computeTotals, detectPriceChanges, roundMoney, type OrderLine } from '@/lib/pricing';
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
    yaExistia: true,
  }));
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Crea un pedido.
 *
 * El orden de los pasos importa (ver comentarios): el reintento se resuelve
 * antes que cualquier validación de precios, y nada se escribe hasta que el
 * pedido está completo y es exactamente lo que el cliente vio.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, 'checkout', 'Estás haciendo muchos pedidos seguidos. Esperá unos minutos.');
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

    // Si el dueño cambió un precio (o venció una oferta) mientras el cliente
    // armaba el pedido, NO se crea el pedido: se le muestra la diferencia y él
    // decide. Nunca se le cobra un precio que no vio.
    const priceChanges = detectPriceChanges(cart, lines);
    if (priceChanges.length > 0) {
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
    const totals = computeTotals(lines, isDelivery, siteConfig);

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

    // ---- 6. Crear el pedido ----
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
