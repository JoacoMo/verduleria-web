import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { siteConfig } from '@/lib/site';
import { checkRateLimit, getClientIp, tooManyRequestsResponse } from '@/lib/rate-limit';
import { PRODUCT_MAX_CART_QUANTITY, isProductUnit, normalizeProductQuantity } from '@/lib/product-units';
import { createPaymentPreference, isMercadoPagoEnabled } from '@/lib/mercadopago';
import { readJsonBody } from '@/lib/request-body';
import { formatArs } from '@/lib/format-price';

export const runtime = 'nodejs';

// Un carrito real no tiene 200 productos distintos; el tope corta el spam de pedidos.
const MAX_CART_LINES = 60;
const CHECKOUT_LIMIT = 12;
const CHECKOUT_WINDOW_MS = 10 * 60 * 1000;

type CartItem = {
  id: number;
  quantity: number;
};

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(`checkout:${getClientIp(request)}`, CHECKOUT_LIMIT, CHECKOUT_WINDOW_MS);
  if (!rateLimit.ok) {
    return tooManyRequestsResponse(
      rateLimit.retryAfterSeconds,
      'Estás haciendo muchos pedidos seguidos. Esperá unos minutos.',
    );
  }

  const parsed = await readJsonBody<{ cart?: unknown; isDelivery?: unknown; paymentMethod?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const cart = Array.isArray(body.cart) ? (body.cart as CartItem[]) : [];
    const deliveryMethod = body.isDelivery ? 'delivery' : 'pickup';

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

    const order = await prisma.order.create({
      data: {
        items: itemsForOrder,
        total,
        status: 'pending',
        deliveryMethod,
      },
    });

    // Si el cliente eligió pagar con tarjeta y Mercado Pago está configurado,
    // generamos la preferencia y devolvemos el link del checkout.
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