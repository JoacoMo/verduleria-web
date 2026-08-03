import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return NextResponse.json(orders);
  } catch (error) {
    console.error('Error en GET /api/admin/orders:', error);
    return NextResponse.json({ error: 'Error al obtener los pedidos.' }, { status: 500 });
  }
}