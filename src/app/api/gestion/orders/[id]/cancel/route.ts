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

  try {
    const orderId = parseNumericId((await context.params).id);
    if (orderId === null) {
      return NextResponse.json({ error: 'Id de pedido inválido.' }, { status: 400 });
    }

    // El cambio de estado es condicional y en una sola sentencia: si justo entre
    // que el dueño abrió el panel y tocó el botón llegó el webhook de Mercado
    // Pago (o se tocó dos veces), no se pisa un estado que ya cambió.
    const result = await prisma.order.updateMany({
      // 'failed' también entra: si el pago con tarjeta se rechazó y el cliente
      // terminó pagando por transferencia, el dueño tiene que poder confirmarlo.
      where: { id: orderId, status: { in: ['pending', 'failed'] } },
      data: { status: 'cancelled' },
    });

    if (result.count === 0) {
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (!order) {
        return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
      }
      return NextResponse.json({ error: `El pedido ya está en estado "${order.status}".` }, { status: 409 });
    }

    return NextResponse.json({ message: 'Pedido cancelado.' });
  } catch (error) {
    console.error('Error al cancelar pedido:', error);
    return NextResponse.json({ error: 'No se pudo cancelar el pedido.' }, { status: 500 });
  }
}