import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { siteConfig } from '@/lib/site';
import { checkRateLimit, getClientIp, tooManyRequestsResponse } from '@/lib/rate-limit';
import { PRODUCT_MAX_CART_QUANTITY, isProductUnit, normalizeProductQuantity } from '@/lib/product-units';
import { createPaymentPreference, isMercadoPagoEnabled } from '@/lib/mercadopago';
import { readJsonBody } from '@/lib/request-body';
import { sanitizeText } from '@/lib/sanitize';
import { formatArs } from '@/lib/format-price';
import { ValidationError, parseCustomerPayload } from '@/lib/validation';

export const runtime = 'nodejs';

// Un carrito real no tiene 200 productos distintos; el tope corta el spam de pedidos.
const MAX_CART_LINES = 60;
const CHECKOUT_LIMIT = 12;
const CHECKOUT_WINDOW_MS = 10 * 60 * 1000;

type CartItem = {
  id: number;
  quantity: number;
};

type OrderRow = {
  id: number;
  total: number;
  items: unknown;
  mpPreferenceId: string | null;
};

/** Prisma marca las violaciones de índice único con el código P2002. */
function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * Respuesta para un pedido que ya existía (reintento).
 *
 * Se reconstruye el link de pago a partir del id de preferencia guardado, que es
 * la URL canónica de Checkout Pro. Así un reintento manda al cliente al MISMO
 * link de pago y no se generan preferencias nuevas por cada toque.
 */
function buildCheckoutResponse(order: OrderRow) {
  return {
    orderId: order.id,
    total: order.total,
    items: order.items,
    checkoutUrl: order.mpPreferenceId
      ? `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${order.mpPreferenceId}`
      : null,
    transferAlias: siteConfig.transferAlias,
    transferCbu: siteConfig.transferCbu,
    whatsappNumber: siteConfig.whatsappNumber,
    storeName: siteConfig.storeName,
    yaExistia: true,
  };
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(`checkout:${getClientIp(request)}`, CHECKOUT_LIMIT, CHECKOUT_WINDOW_MS);
  if (!rateLimit.ok) {
    return tooManyRequestsResponse(
      rateLimit.retryAfterSeconds,
      'Estás haciendo muchos pedidos seguidos. Esperá unos minutos.',
    );
  }

  const parsed = await readJsonBody<{
    cart?: unknown;
    isDelivery?: unknown;
    paymentMethod?: unknown;
    idempotencyKey?: unknown;
    customer?: unknown;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const cart = Array.isArray(body.cart) ? (body.cart as CartItem[]) : [];
    const deliveryMethod = body.isDelivery ? 'delivery' : 'pickup';

    // Sin nombre y teléfono el pedido llegaba al panel sin saber de quién era, y
    // si el cliente no mandaba el WhatsApp quedaba huérfano.
    let customer;
    try {
      customer = parseCustomerPayload(body.customer, { isDelivery: deliveryMethod === 'delivery' });
    } catch (error) {
      if (error instanceof ValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // Clave de idempotencia: se acota el largo y se limpia como cualquier otro
    // dato que entra por request. Si no viene, el checkout funciona igual (sin
    // protección contra duplicados), así que un cliente viejo no se rompe.
    const idempotencyKey = sanitizeText(body.idempotencyKey, { maxLength: 100, singleLine: true }) || null;

    if (cart.length === 0) {
      return NextResponse.json({ error: 'El carrito está vacío.' }, { status: 400 });
    }

    if (cart.length > MAX_CART_LINES) {
      return NextResponse.json({ error: 'El carrito tiene demasiados productos.' }, { status: 400 });
    }

    // Solo IDs enteros positivos, y sin repetir: si el mismo producto viene dos
    // veces se toma una sola línea (el carrito del front ya los agrupa).
    const productIds = [...new Set(
      cart
        .map((item) => Number(item.id))
        .filter((id) => Number.isInteger(id) && id > 0),
    )];

    if (productIds.length === 0) {
      return NextResponse.json({ error: 'No hay productos válidos en el carrito.' }, { status: 400 });
    }

    const dbProducts = await prisma.product.findMany({ where: { id: { in: productIds } } });

    const itemsForOrder: Array<{ id: number; name: string; price: number; quantity: number; unit: string }> = [];
    let total = 0;

    // Si algo quedó sin stock mientras el cliente armaba el carrito, se corta acá:
    // el front ya no deja agregarlos, pero no alcanza con esa validación.
    const unavailable = dbProducts.filter((product) => !product.available);
    if (unavailable.length > 0) {
      return NextResponse.json(
        {
          error: `Estos productos se quedaron sin stock: ${unavailable.map((p) => p.name).join(', ')}. Sacalos del carrito para seguir.`,
        },
        { status: 409 },
      );
    }

    for (const productId of productIds) {
      const product = dbProducts.find((item) => item.id === productId);
      if (!product) continue;

      const cartItem = cart.find((item) => Number(item.id) === productId);
      const unit = isProductUnit(product.unit) ? product.unit : 'kg';

      // La cantidad se re-normaliza en el servidor con los mismos pasos que usa el
      // carrito y se recorta al tope por unidad: no confiamos en lo que mandó el cliente.
      const requestedQuantity = Number(cartItem?.quantity);
      const normalizedQuantity = normalizeProductQuantity(requestedQuantity, unit);
      if (normalizedQuantity <= 0) continue;

      const quantity = Math.min(normalizedQuantity, PRODUCT_MAX_CART_QUANTITY[unit]);

      itemsForOrder.push({
        id: product.id,
        name: product.name,
        price: product.price,
        quantity,
        unit,
      });
      total += product.price * quantity;
    }

    total = Number(total.toFixed(2));

    if (itemsForOrder.length === 0) {
      return NextResponse.json({ error: 'No hay productos válidos en el carrito.' }, { status: 400 });
    }

    if (deliveryMethod === 'delivery' && total < siteConfig.deliveryMinPurchase) {
      return NextResponse.json(
        { error: `El pedido mínimo para envío es ${formatArs(siteConfig.deliveryMinPurchase)}.` },
        { status: 400 },
      );
    }

    // ---- Idempotencia ----
    // Si el navegador mandó una clave y ya existe un pedido con ella, es un
    // reintento (doble toque, conexión lenta, botón de recargar): se devuelve el
    // pedido que ya se había creado en vez de crear otro.
    if (idempotencyKey) {
      const existente = await prisma.order.findUnique({ where: { idempotencyKey } });
      if (existente) {
        return NextResponse.json(buildCheckoutResponse(existente));
      }
    }

    let order;
    try {
      order = await prisma.order.create({
        data: {
          items: itemsForOrder,
          total,
          status: 'pending',
          deliveryMethod,
          idempotencyKey,
          ...customer,
        },
      });
    } catch (error) {
      // P2002 = violación de índice único. Pasa cuando dos requests con la misma
      // clave llegan tan juntos que ambos pasaron el findUnique de arriba. Gana
      // el primero; el segundo devuelve ese mismo pedido.
      if (isUniqueConstraintError(error) && idempotencyKey) {
        const ganador = await prisma.order.findUnique({ where: { idempotencyKey } });
        if (ganador) {
          return NextResponse.json(buildCheckoutResponse(ganador));
        }
      }
      throw error;
    }

    // Si el cliente eligió pagar con tarjeta y Mercado Pago está configurado,
    // generamos la preferencia y devolvemos el link del checkout.
    //
    // La llamada a Mercado Pago queda FUERA de cualquier transacción de base a
    // propósito: mantener una transacción abierta mientras se espera una API
    // externa retiene locks todo ese tiempo y es una fuente clásica de bloqueos.
    let checkoutUrl: string | null = null;

    if (body.paymentMethod === 'mercadopago' && isMercadoPagoEnabled()) {
      try {
        const preference = await createPaymentPreference({
          orderId: order.id,
          items: itemsForOrder,
          total,
        });
        checkoutUrl = preference.checkoutUrl;
        await prisma.order.update({
          where: { id: order.id },
          data: { mpPreferenceId: preference.preferenceId },
        });
      } catch (error) {
        // El pedido ya quedó registrado: si falla el link de pago, el cliente
        // todavía puede pagar por transferencia, así que no rompemos el checkout.
        console.error('No se pudo crear la preferencia de pago:', error);
      }
    }

    return NextResponse.json({
      orderId: order.id,
      total,
      // Los ítems como los calculó el servidor (precio vigente, cantidad
      // normalizada): el mensaje de WhatsApp se arma con esto y no con lo que
      // tenía el carrito, que puede tener un precio viejo.
      items: itemsForOrder,
      checkoutUrl,
      transferAlias: siteConfig.transferAlias,
      transferCbu: siteConfig.transferCbu,
      whatsappNumber: siteConfig.whatsappNumber,
      storeName: siteConfig.storeName,
    });
  } catch (error) {
    console.error('Error en /api/checkout:', error);
    return NextResponse.json({ error: 'No se pudo registrar el pedido.' }, { status: 500 });
  }
}