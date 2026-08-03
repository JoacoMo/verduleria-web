import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { siteConfig } from '@/lib/site';

export const runtime = 'nodejs';

type CartItem = {
  id: number;
  quantity: number;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const cart = Array.isArray(body.cart) ? (body.cart as CartItem[]) : [];

    if (cart.length === 0) {
      return NextResponse.json({ error: 'El carrito está vacío.' }, { status: 400 });
    }

    const productIds = cart.map((item) => item.id);
    const dbProducts = await prisma.product.findMany({ where: { id: { in: productIds } } });

    const itemsForOrder: Array<{ id: number; name: string; price: number; quantity: number }> = [];
    const sinStock: string[] = [];
    let total = 0;

    for (const cartItem of cart) {
      const product = dbProducts.find((item) => item.id === cartItem.id);
      if (!product) continue;

      if (product.stock < cartItem.quantity) {
        sinStock.push(product.name);
        continue;
      }

      itemsForOrder.push({
        id: product.id,
        name: product.name,
        price: product.price,
        quantity: cartItem.quantity,
      });
      total += product.price * cartItem.quantity;
    }

    if (sinStock.length > 0) {
      return NextResponse.json({ error: `Sin stock suficiente: ${sinStock.join(', ')}` }, { status: 409 });
    }

    if (itemsForOrder.length === 0) {
      return NextResponse.json({ error: 'No hay productos válidos en el carrito.' }, { status: 400 });
    }

    const order = await prisma.order.create({
      data: {
        items: itemsForOrder,
        total,
        status: 'pending',
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