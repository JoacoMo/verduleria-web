import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  const orderId = Number((await context.params).id);

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    }
    if (order.status !== 'pending') {
      return NextResponse.json({ error: `El pedido ya está en estado "${order.status}".` }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      const items = order.items as Array<{ id: number; quantity: number }>;
      for (const item of items) {
        await tx.product.update({
          where: { id: item.id },
          data: { stock: { decrement: item.quantity } },
        });
      }

      await tx.order.update({ where: { id: orderId }, data: { status: 'paid' } });
    });

    return NextResponse.json({ message: 'Pedido confirmado y stock actualizado.' });
  } catch (error) {
    console.error('Error al confirmar pedido:', error);
    return NextResponse.json({ error: 'No se pudo confirmar el pedido.' }, { status: 500 });
  }
}