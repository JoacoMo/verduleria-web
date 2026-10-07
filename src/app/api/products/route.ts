import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getCachedProducts, toPublicProducts } from '@/lib/products';

export const runtime = 'nodejs';

/**
 * Catálogo público (lo usa el panel para listar; la tienda lo recibe ya
 * renderizado desde el servidor).
 *
 * Antes, con la tabla vacía, este GET sembraba productos de ejemplo y ante un
 * error de base devolvía productos inventados con 200. Las dos cosas eran
 * peligrosas en producción: un GET público escribía en la base, y una caída
 * mostraba precios falsos que alguien podía intentar pedir. Ahora la siembra
 * vive solo en prisma/seed.js y un error es un error.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, 'publicRead');
  if (limited) return limited;

  try {
    const products = await getCachedProducts();
    // createdAt no le sirve a nadie afuera: se responde solo lo que se muestra.
    return NextResponse.json(toPublicProducts(products));
  } catch (error) {
    console.error('Error en GET /api/products:', error);
    return NextResponse.json({ error: 'No se pudo cargar el catálogo. Probá de nuevo en un rato.' }, { status: 500 });
  }
}
