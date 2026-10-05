import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseNumericId } from '@/lib/route-params';
import { OPEN_ORDER_STATUSES, describeStatusConflict } from '@/lib/order-lifecycle';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Marca un pedido como pagado (el dueño ya vio la transferencia o cobró el efectivo). */
export async function PUT(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  const orderId = parseNumericId((await context.params).id);
  if (orderId === null) {
    return NextResponse.json({ error: 'Id de pedido inválido.' }, { status: 400 });
  }

  try {
    // El cambio de estado es condicional y en una sola sentencia: si el pedido
    // cambió entre que el dueño abrió el panel y tocó el botón (otra pestaña, el
    // limpiador diario o un doble toque), no se pisa un estado que ya cambió.
    // 'failed' también entra: es un pedido con problema que se resuelve a mano.
    const result = await prisma.order.updateMany({
      where: { id: orderId, status: { in: [...OPEN_ORDER_STATUSES] } },
      data: { status: 'paid' },
    });

    if (result.count === 0) {
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (!order) {
        return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
      }
      return NextResponse.json({ error: describeStatusConflict(order.status) }, { status: 409 });
    }

    return NextResponse.json({ message: 'Pedido confirmado.' });
  } catch (error) {
    console.error('Error en PUT /api/gestion/orders/:id/confirm:', error);
    return NextResponse.json({ error: 'No se pudo confirmar el pedido.' }, { status: 500 });
  }
}
