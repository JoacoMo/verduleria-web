import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getArgentinaParts } from '@/lib/store-hours';
import {
  MAX_OVERDUE_ORDERS,
  OPEN_ORDER_STATUSES,
  ORDER_RECORD_SELECT,
  firstSlotIdOf,
  getOrdersDayRange,
  toOrderRecord,
} from '@/lib/order-lifecycle';

export const runtime = 'nodejs';
// Depende de la hora (qué es "hoy"): nunca se cachea.
export const dynamic = 'force-dynamic';

/**
 * Pendientes de días anteriores: pedidos abiertos (pendientes o con problema)
 * creados antes de hoy (hora argentina), del más viejo al más nuevo, hasta
 * MAX_OVERDUE_ORDERS. Responde OrderRecord[].
 *
 * Es lo que se quedó sin resolver: un envío en efectivo que se entregó y no se
 * marcó pagado, un retiro que nadie vino a buscar, una transferencia que no
 * llegó. "Por cobrar" solo mira el día elegido, así que sin esta lista esos
 * pedidos no se veían (y el cron cancelaba los de transferencia a los 7 días).
 *
 * No incluye los que igual figuran en la lista de hoy o de un día que todavía
 * no llegó, para no mostrarlos dos veces como "atrasados" cuando no lo están:
 * - envíos con turno de hoy o más adelante;
 * - retiros que entraron ayer después del corte, que se arman hoy.
 */
export async function GET(request: Request) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminRead');
  if (limited) return limited;

  const today = getArgentinaParts().date;
  const { dayStart, pickupCarryFrom } = getOrdersDayRange(today);

  try {
    // Usa el índice (status, createdAt).
    const orders = await prisma.order.findMany({
      where: {
        status: { in: [...OPEN_ORDER_STATUSES] },
        createdAt: { lt: dayStart },
        AND: [
          // Sin turno, o con un turno de un día que ya pasó. (Con NOT sobre una
          // columna que puede ser NULL, Postgres descartaría también los retiros.)
          { OR: [{ deliverySlot: null }, { deliverySlot: { lt: firstSlotIdOf(today) } }] },
          { NOT: { deliveryMethod: 'pickup', createdAt: { gte: pickupCarryFrom } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_OVERDUE_ORDERS,
      select: ORDER_RECORD_SELECT,
    });
    return NextResponse.json(orders.map(toOrderRecord));
  } catch (error) {
    console.error('Error en GET /api/gestion/orders/atrasados:', error);
    return NextResponse.json({ error: 'Error al obtener los pedidos pendientes de días anteriores.' }, { status: 500 });
  }
}
