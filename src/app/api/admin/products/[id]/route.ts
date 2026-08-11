import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseProductPayload } from '@/lib/validation';
import { parseNumericId } from '@/lib/route-params';
import { readJsonBody } from '@/lib/request-body';

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
    const productId = parseNumericId((await context.params).id);
    if (productId === null) {
      return NextResponse.json({ error: 'Id de producto inválido.' }, { status: 400 });
    }

    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;

    const data = parseProductPayload(parsed.data, { partial: true });
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No hay cambios para guardar.' }, { status: 400 });
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data,
    });

    return NextResponse.json(product);
  } catch (error) {
    console.error('Error en PUT /api/admin/products/:id:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al actualizar el producto.' }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  try {
    const productId = parseNumericId((await context.params).id);
    if (productId === null) {
      return NextResponse.json({ error: 'Id de producto inválido.' }, { status: 400 });
    }

    await prisma.product.delete({ where: { id: productId } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error en DELETE /api/admin/products/:id:', error);
    return NextResponse.json({ error: 'Error al eliminar el producto.' }, { status: 500 });
  }
}