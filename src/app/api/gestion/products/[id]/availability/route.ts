import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseNumericId } from '@/lib/route-params';
import { readJsonBody } from '@/lib/request-body';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Marca un producto como disponible o no disponible.
 *
 * Va en su propia ruta en vez de reusar el PUT del producto porque es la acción
 * que más se usa del panel (se aprieta varias veces por día cuando se corta el
 * stock) y así el botón manda un solo campo, sin arrastrar precio ni nombre.
 */
export async function PUT(request: Request, context: RouteContext) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  const productId = parseNumericId((await context.params).id);
  if (productId === null) {
    return NextResponse.json({ error: 'Id de producto inválido.' }, { status: 400 });
  }

  const parsed = await readJsonBody<{ available?: unknown }>(request);
  if (!parsed.ok) return parsed.response;

  if (typeof parsed.data.available !== 'boolean') {
    return NextResponse.json({ error: 'La disponibilidad debe ser verdadero o falso.' }, { status: 400 });
  }

  try {
    const product = await prisma.product.update({
      where: { id: productId },
      data: { available: parsed.data.available },
    });

    return NextResponse.json(product);
  } catch (error) {
    console.error('Error en PUT /api/gestion/products/:id/availability:', error);
    return NextResponse.json({ error: 'No se pudo cambiar la disponibilidad.' }, { status: 400 });
  }
}
