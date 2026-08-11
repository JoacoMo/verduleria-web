import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseNumericId } from '@/lib/route-params';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, "adminWrite");
  if (limited) return limited;

  try {
    const orderId = parseNumericId((await context.params).id);
    if (orderId === null) {
      return NextResponse.json({ error: 'Id de pedido inválido.' }, { status: 400 });
    }

    await prisma.order.delete({ where: { id: orderId } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error en DELETE /api/gestion/orders/:id:', error);
    return NextResponse.json({ error: 'No se pudo eliminar el pedido.' }, { status: 500 });
  }
}
