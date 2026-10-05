import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/request-body';
import { invalidarProductos } from '@/lib/products';
import {
  ItemValidationError,
  ValidationError,
  parseBulkProductUpdates,
  resolveBulkUpdates,
  type PricingState,
} from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * Actualización masiva de precios, stock y ofertas (la usa el script de
 * precios para cargar la lista del mercado de una sola vez).
 *
 * Body: { updates: [{ id, price?, available?, offerPrice?, offerEndsAt? }] }
 *
 * Es todo o nada: primero se valida cada ítem (forma y regla oferta < precio
 * contra lo guardado) y recién después se escribe, en UNA transacción. Si un
 * ítem está mal no se toca ningún producto y se responde cuál fue, así nunca
 * queda la lista de precios a medio cargar.
 *
 * Los ids que no existen no frenan el resto: se saltean y se informan.
 */
export async function POST(request: Request) {
  const auth = verifyAdminAuth(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  try {
    const now = new Date();
    const updates = parseBulkProductUpdates(parsed.data, now);

    const rows = await prisma.product.findMany({
      where: { id: { in: updates.map((update) => update.id) } },
      select: { id: true, price: true, offerPrice: true, offerEndsAt: true },
    });
    const current = new Map<number, PricingState>(rows.map(({ id, ...pricing }) => [id, pricing]));

    const { writes, notFound } = resolveBulkUpdates(updates, current, now);

    // updateMany (y no update) para que un producto borrado justo entre la
    // lectura y la escritura no tire abajo toda la transacción: cuenta 0 y se
    // informa como no encontrado.
    const results = writes.length > 0
      ? await prisma.$transaction(
          writes.map(({ id, data }) => prisma.product.updateMany({ where: { id }, data })),
        )
      : [];

    const vanished = writes.filter((_, index) => results[index]?.count === 0).map(({ id }) => id);
    const updated = results.reduce((sum, result) => sum + result.count, 0);

    // Una sola invalidación para toda la tanda, no una por producto.
    if (updated > 0) invalidarProductos();

    return NextResponse.json({ updated, notFound: [...notFound, ...vanished] });
  } catch (error) {
    if (error instanceof ItemValidationError) {
      return NextResponse.json({ error: error.message, index: error.index }, { status: 400 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error en POST /api/gestion/products/bulk:', error);
    return NextResponse.json({ error: 'No se pudieron actualizar los productos.' }, { status: 500 });
  }
}
