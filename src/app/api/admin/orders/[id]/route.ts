import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  try {
    const orderId = Number((await context.params).id);
    await prisma.order.delete({ where: { id: orderId } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error en DELETE /api/admin/orders/:id:', error);
    return NextResponse.json({ error: 'No se pudo eliminar el pedido.' }, { status: 500 });
  }
}
