import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { siteConfig } from '@/lib/site';
import { checkRateLimit, getClientIp, tooManyRequestsResponse } from '@/lib/rate-limit';
import { PRODUCT_MAX_CART_QUANTITY, isProductUnit, normalizeProductQuantity } from '@/lib/product-units';

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

  try {
    const body = await request.json();
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
        { error: `El pedido mínimo para envío es $${siteConfig.deliveryMinPurchase.toFixed(2)}.` },
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

    return NextResponse.json({
      orderId: order.id,
      total,
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