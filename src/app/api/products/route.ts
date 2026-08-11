import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getCachedProducts, invalidarProductos } from '@/lib/products';

export const runtime = 'nodejs';

const DEFAULT_PRODUCT_SEED = [
  { name: 'Tomate', price: 800, image: '/product-placeholder.svg', unit: 'kg', category: 'Verduras' },
  { name: 'Papa', price: 500, image: '/product-placeholder.svg', unit: 'kg', category: 'Verduras' },
  { name: 'Ajo', price: 1200, image: '/product-placeholder.svg', unit: 'unidad', category: 'Verduras' },
];

const DEFAULT_PRODUCTS_FALLBACK = [
  { id: -1, name: 'Tomate', price: 800, image: '/product-placeholder.svg', unit: 'kg', category: 'Verduras', available: true },
  { id: -2, name: 'Papa', price: 500, image: '/product-placeholder.svg', unit: 'kg', category: 'Verduras', available: true },
  { id: -3, name: 'Ajo', price: 1200, image: '/product-placeholder.svg', unit: 'unidad', category: 'Verduras', available: true },
];

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, 'publicRead');
  if (limited) return limited;

  try {
    const products = await getCachedProducts();

    // Base recién creada: se siembran los productos por defecto y se tira la
    // caché para que la próxima lectura los tome.
    if (products.length === 0) {
      await prisma.product.createMany({ data: DEFAULT_PRODUCT_SEED });
      invalidarProductos();
      return NextResponse.json(DEFAULT_PRODUCTS_FALLBACK);
    }

    return NextResponse.json(products);
  } catch (error) {
    console.error('Error en GET /api/products:', error);
    return NextResponse.json(DEFAULT_PRODUCTS_FALLBACK, { status: 200 });
  }
}