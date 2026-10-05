import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getArgentinaParts } from '@/lib/store-hours';
import { isValidCalendarDate } from '@/lib/validation';
import { MAX_ORDERS_PER_DAY } from '@/lib/order-options';
import { ORDER_RECORD_SELECT, toOrderRecord } from '@/lib/order-lifecycle';

export const runtime = 'nodejs';

// Argentina es UTC-3 todo el año (sin horario de verano).
const ARGENTINA_UTC_OFFSET = '-03:00';
const DAY_MS = 24 * 60 * 60 * 1000;
// Tope de cordura para una verdulería de barrio: si un día pasa de esto, hay
// algo raro (spam) y no queremos mandarle al celular del dueño una lista gigante.

/**
 * Pedidos de un día (?date=YYYY-MM-DD, hora argentina; sin fecha = hoy).
 *
 * "Los pedidos del día" son los que entraron ese día Y los que hay que entregar
 * ese día: un pedido hecho a la noche para el turno de las 13 h de mañana tiene
 * que aparecer mañana, que es cuando el dueño lo arma.
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

  const dayStart = new Date(`${date}T00:00:00${ARGENTINA_UTC_OFFSET}`);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  try {
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { createdAt: { gte: dayStart, lt: dayEnd } },
          // El id del turno empieza con la fecha ("2026-10-06T13").
          { deliverySlot: { startsWith: `${date}T` } },
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
