import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';

export const runtime = 'nodejs';

const ARGENTINA_UTC_OFFSET = '-03:00';

function isValidDateParam(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function getArgentinaTodayDateParam() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');
  const date = dateParam && isValidDateParam(dateParam) ? dateParam : getArgentinaTodayDateParam();

  const dayStart = new Date(`${date}T00:00:00${ARGENTINA_UTC_OFFSET}`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  try {
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(orders);
  } catch (error) {
    console.error('Error en GET /api/admin/orders:', error);
    return NextResponse.json({ error: 'Error al obtener los pedidos.' }, { status: 500 });
  }
}