import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { parseProductPayload } from '@/lib/validation';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const data = parseProductPayload(await request.json(), { partial: true });
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No hay cambios para guardar.' }, { status: 400 });
    }

    const product = await prisma.product.update({
      where: { id: Number(id) },
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

  try {
    const { id } = await context.params;
    await prisma.product.delete({ where: { id: Number(id) } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error en DELETE /api/admin/products/:id:', error);
    return NextResponse.json({ error: 'Error al eliminar el producto.' }, { status: 500 });
  }
}