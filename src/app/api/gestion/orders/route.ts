import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getArgentinaParts } from '@/lib/store-hours';
import { isValidCalendarDate } from '@/lib/validation';
import { MAX_ORDERS_PER_DAY } from '@/lib/order-options';
import { ORDER_RECORD_SELECT, getOrdersDayRange, toOrderRecord } from '@/lib/order-lifecycle';

export const runtime = 'nodejs';

/**
 * Pedidos de un día (?date=YYYY-MM-DD, hora argentina; sin fecha = hoy).
 *
 * "Los pedidos del día" son los que entraron ese día Y los que hay que armar
 * ese día:
 * - un envío hecho a la noche para el turno de las 13 h de mañana aparece
 *   mañana, que es cuando el dueño lo arma;
 * - un retiro que entró ayer después del corte (19:00, o el cierre si es antes:
 *   el domingo a las 14) se prepara hoy, como le promete la tienda al cliente.
 *   Antes quedaba en "ayer" y nadie lo veía.
 *
 * Hasta MAX_ORDERS_PER_DAY, de los más nuevos a los más viejos (el panel avisa
 * si se llega al tope).
 */
export async function GET(request: Request) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminRead');
  if (limited) return limited;

  const dateParam = new URL(request.url).searchParams.get('date');
  // Rango de cordura: el panel nunca necesita pedidos fuera de esto, y un año
  // 9999 hacía que el fin del día cayera en el 10000, que Prisma no acepta (500).
  const year = dateParam !== null ? Number(dateParam.slice(0, 4)) : null;
  if (dateParam !== null && (!isValidCalendarDate(dateParam) || year === null || year < 2020 || year > 2100)) {
    return NextResponse.json({ error: 'Fecha inválida. Usá el formato AAAA-MM-DD.' }, { status: 400 });
  }
  const date = dateParam ?? getArgentinaParts().date;
  const { dayStart, dayEnd, pickupCarryFrom, slotIds } = getOrdersDayRange(date);

  try {
    // Cada rama del OR usa un índice: createdAt, deliverySlot (por igualdad,
    // que en un btree no depende de la collation como un startsWith) y otra vez
    // createdAt para los retiros que pasaron del día anterior.
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { createdAt: { gte: dayStart, lt: dayEnd } },
          { deliverySlot: { in: slotIds } },
          { deliveryMethod: 'pickup', createdAt: { gte: pickupCarryFrom, lt: dayStart } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_ORDERS_PER_DAY,
      select: ORDER_RECORD_SELECT,
    });
    return NextResponse.json(orders.map(toOrderRecord));
  } catch (error) {
    console.error('Error en GET /api/gestion/orders:', error);
    return NextResponse.json({ error: 'Error al obtener los pedidos.' }, { status: 500 });
  }
}
