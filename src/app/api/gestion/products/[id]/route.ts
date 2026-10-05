import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ValidationError, parseProductPayload } from '@/lib/validation';
import { parseNumericId } from '@/lib/route-params';
import { invalidarProductos } from '@/lib/products';
import { readJsonBody } from '@/lib/request-body';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Prisma marca con P2025 un update/delete sobre un registro que no existe. */
function isNotFoundError(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2025';
}

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
    invalidarProductos();

    return NextResponse.json(product);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'El producto no existe.' }, { status: 404 });
    }
    console.error('Error en PUT /api/gestion/products/:id:', error);
    return NextResponse.json({ error: 'Error al actualizar el producto.' }, { status: 500 });
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
    invalidarProductos();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'El producto no existe.' }, { status: 404 });
    }
    console.error('Error en DELETE /api/gestion/products/:id:', error);
    return NextResponse.json({ error: 'Error al eliminar el producto.' }, { status: 500 });
  }
}