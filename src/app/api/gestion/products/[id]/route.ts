import { NextResponse } from 'next/server';
import { hasPrismaCode, prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ValidationError, assertOfferConsistency, dropExpiredOfferEndsAt, parseProductPayload, touchesPricing } from '@/lib/validation';
import { parseNumericId } from '@/lib/route-params';
import { invalidarProductos, toProduct } from '@/lib/products';
import { readJsonBody } from '@/lib/request-body';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

const NOT_FOUND_MESSAGE = 'El producto no existe.';

export async function PUT(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  const productId = parseNumericId((await context.params).id);
  if (productId === null) {
    return NextResponse.json({ error: 'Id de producto inválido.' }, { status: 400 });
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  try {
    const now = new Date();
    const data = parseProductPayload(parsed.data, { partial: true, now });
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No hay cambios para guardar.' }, { status: 400 });
    }

    // Edición parcial: puede venir solo el precio o solo la oferta, así que la
    // regla oferta < precio se chequea contra cómo quedaría el producto.
    if (touchesPricing(data)) {
      const current = await prisma.product.findUnique({
        where: { id: productId },
        select: { price: true, offerPrice: true, offerEndsAt: true },
      });
      if (!current) {
        return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
      }
      dropExpiredOfferEndsAt(data, current, now);
      assertOfferConsistency(data, current, now);
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data,
    });
    invalidarProductos();

    return NextResponse.json(toProduct(product));
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (hasPrismaCode(error, 'P2025')) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }
    console.error('Error en PUT /api/gestion/products/:id:', error);
    return NextResponse.json({ error: 'Error al actualizar el producto.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  const productId = parseNumericId((await context.params).id);
  if (productId === null) {
    return NextResponse.json({ error: 'Id de producto inválido.' }, { status: 400 });
  }

  try {
    // Los pedidos guardan una foto de los ítems (JSON), así que borrar un
    // producto no rompe los pedidos que ya lo tenían.
    await prisma.product.delete({ where: { id: productId } });
    invalidarProductos();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }
    console.error('Error en DELETE /api/gestion/products/:id:', error);
    return NextResponse.json({ error: 'Error al eliminar el producto.' }, { status: 500 });
  }
}
