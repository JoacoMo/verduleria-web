import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseNumericId } from '@/lib/route-params';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  const orderId = parseNumericId((await context.params).id);
  if (orderId === null) {
    return NextResponse.json({ error: 'Id de pedido inválido.' }, { status: 400 });
  }

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    }
    if (order.status !== 'pending') {
      return NextResponse.json({ error: `El pedido ya está en estado "${order.status}".` }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: 'paid' } });
    });

    return NextResponse.json({ message: 'Pedido confirmado.' });
  } catch (error) {
    console.error('Error al confirmar pedido:', error);
    return NextResponse.json({ error: 'No se pudo confirmar el pedido.' }, { status: 500 });
  }
}