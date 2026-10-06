import { NextResponse } from 'next/server';
import { hasPrismaCode, prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseNumericId } from '@/lib/route-params';
import { readJsonBody } from '@/lib/request-body';
import { ValidationError, parseOrderAdjustment } from '@/lib/validation';
import {
  OPEN_ORDER_STATUSES,
  ORDER_RECORD_SELECT,
  applyOrderAdjustment,
  describeStatusConflict,
  parseStoredOrderItems,
  toOrderRecord,
} from '@/lib/order-lifecycle';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

const NOT_FOUND_MESSAGE = 'Pedido no encontrado.';
const CHANGED_MESSAGE = 'El pedido cambió mientras lo editabas. Recargá para ver la última versión.';

/**
 * Ajuste con los pesos reales.
 *
 * En lo que va por peso el total del pedido es estimado: el dueño pesa, carga
 * acá lo que realmente se lleva el cliente y le manda el total final por
 * WhatsApp (que es lo que se transfiere).
 *
 * Body: { items: [{ id, quantity }], expectedUpdatedAt }. expectedUpdatedAt es
 * el updatedAt del pedido que tenía el panel al abrir el editor (obligatorio):
 * si el pedido cambió desde entonces (otro dispositivo cargó otros pesos, o se
 * confirmó o canceló), responde 409 y no pisa nada. Antes se comparaba contra
 * lo que el propio request acababa de leer, y un editor abierto hacía rato
 * pisaba en silencio el ajuste de otro.
 *
 * Las reglas del ajuste están en applyOrderAdjustment (order-lifecycle.ts).
 *
 * Responde el pedido actualizado (OrderRecord).
 */
export async function PUT(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  const orderId = parseNumericId((await context.params).id);
  if (orderId === null) {
    return NextResponse.json({ error: 'Id de pedido inválido.' }, { status: 400 });
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  try {
    const { items: requested, expectedUpdatedAt } = parseOrderAdjustment(parsed.data);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { items: true, status: true, shippingCost: true, updatedAt: true },
    });
    if (!order) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }
    if (!(OPEN_ORDER_STATUSES as readonly string[]).includes(order.status)) {
      return NextResponse.json(
        { error: `${describeStatusConflict(order.status)} Solo se pueden ajustar pedidos pendientes.` },
        { status: 409 },
      );
    }

    if (order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      return NextResponse.json({ error: CHANGED_MESSAGE }, { status: 409 });
    }

    const adjusted = applyOrderAdjustment(parseStoredOrderItems(order.items), requested, order.shippingCost);

    try {
      // Update condicional: además del estado, se exige que el pedido siga en la
      // versión que vio el panel (updatedAt). Si justo en el medio se confirmó,
      // se canceló o se ajustó desde otro lado, no se pisa: Prisma no encuentra
      // la fila y se responde 409 para que el panel recargue.
      const updated = await prisma.order.update({
        where: { id: orderId, status: { in: [...OPEN_ORDER_STATUSES] }, updatedAt: expectedUpdatedAt },
        data: {
          items: adjusted.items,
          subtotal: adjusted.subtotal,
          total: adjusted.total,
          adjustedAt: new Date(),
        },
        select: ORDER_RECORD_SELECT,
      });
      return NextResponse.json(toOrderRecord(updated));
    } catch (error) {
      if (!hasPrismaCode(error, 'P2025')) throw error;
      const stillThere = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
      return stillThere
        ? NextResponse.json({ error: CHANGED_MESSAGE }, { status: 409 })
        : NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error en PUT /api/gestion/orders/:id:', error);
    return NextResponse.json({ error: 'No se pudo ajustar el pedido.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  const orderId = parseNumericId((await context.params).id);
  if (orderId === null) {
    return NextResponse.json({ error: 'Id de pedido inválido.' }, { status: 400 });
  }

  try {
    await prisma.order.delete({ where: { id: orderId } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }
    console.error('Error en DELETE /api/gestion/orders/:id:', error);
    return NextResponse.json({ error: 'No se pudo eliminar el pedido.' }, { status: 500 });
  }
}
