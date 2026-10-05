import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { prisma } from './prisma';
import { isProductUnit } from './product-units';
import { isProductCategory } from './product-categories';
import type { Product } from './types';
import type { Product as ProductRow } from '@prisma/client';

/**
 * Lectura del catálogo, cacheada.
 *
 * Por qué existe: la base está en São Paulo y una consulta de productos tarda
 * ~200 ms. La home se renderiza por request (lo obliga la CSP con nonce), así que
 * sin caché cada visita pagaba esos 200 ms antes de mostrar nada, y encima el
 * cliente pedía /api/products y pagaba otros 200 ms.
 *
 * Con la caché, el catálogo se lee de la base una vez por minuto como mucho, sin
 * importar cuánta gente entre. También le saca presión a la base si alguien
 * intenta tirar el sitio a fuerza de recargar.
 *
 * La caché NO se queda vieja: cada vez que el dueño toca un producto desde el
 * panel se llama a `invalidarProductos()` y la próxima lectura va a la base. O sea
 * que un cambio de precio o de stock se ve al instante, no en un minuto.
 */
export const PRODUCTS_CACHE_TAG = 'productos';

const CACHE_SECONDS = 60;

/**
 * Los no disponibles van al final; dentro de cada grupo, alfabético.
 *
 * Es UNA sola consulta sin relaciones (no hay N+1 posible: categoría e imagen son
 * columnas del producto). Con un catálogo de verdulería (cientos de filas como
 * mucho) Postgres la resuelve con un seq scan más rápido que cualquier índice, y
 * encima queda cacheada: no hace falta indexar name/category/available.
 */
const PRODUCT_ORDER = [{ available: 'desc' as const }, { name: 'asc' as const }];

/**
 * Fila de la base → Product. Prisma devuelve unit/category como string y las
 * fechas como Date; se acota acá para que todo el resto de la app (y las
 * respuestas del panel) reciba el tipo ya validado y serializable.
 */
export function toProduct(product: ProductRow): Product {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    image: product.image,
    unit: isProductUnit(product.unit) ? product.unit : 'kg',
    category: isProductCategory(product.category) ? product.category : 'Almacén',
    description: product.description,
    offerPrice: product.offerPrice,
    offerEndsAt: product.offerEndsAt ? product.offerEndsAt.toISOString() : null,
    available: product.available,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

async function fetchProductsFromDb(): Promise<Product[]> {
  const products = await prisma.product.findMany({ orderBy: PRODUCT_ORDER });
  return products.map(toProduct);
}

export const getCachedProducts = unstable_cache(
  fetchProductsFromDb,
  ['productos-listado'],
  { tags: [PRODUCTS_CACHE_TAG], revalidate: CACHE_SECONDS },
);

/**
 * Tira la caché del catálogo. Se llama desde el panel después de crear, editar,
 * borrar o cambiar la disponibilidad de un producto.
 */
export function invalidarProductos() {
  revalidateTag(PRODUCTS_CACHE_TAG);
}
