import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const DEFAULT_PRODUCT_SEED = [
  { name: 'Tomate', price: 800, image: '/product-placeholder.svg', unit: 'kg' },
  { name: 'Papa', price: 500, image: '/product-placeholder.svg', unit: 'kg' },
  { name: 'Ajo', price: 1200, image: '/product-placeholder.svg', unit: 'unidad' },
];

const DEFAULT_PRODUCTS_FALLBACK = [
  { id: -1, name: 'Tomate', price: 800, image: '/product-placeholder.svg', unit: 'kg' },
  { id: -2, name: 'Papa', price: 500, image: '/product-placeholder.svg', unit: 'kg' },
  { id: -3, name: 'Ajo', price: 1200, image: '/product-placeholder.svg', unit: 'unidad' },
];

export async function GET() {
  try {
    const products = await prisma.product.findMany({ orderBy: { id: 'asc' } });
    if (products.length === 0) {
      await prisma.product.createMany({ data: DEFAULT_PRODUCT_SEED });
      const seededProducts = await prisma.product.findMany({ orderBy: { id: 'asc' } });
      return NextResponse.json(seededProducts);
    }
    return NextResponse.json(products);
  } catch (error) {
    console.error('Error en GET /api/products:', error);
    return NextResponse.json(DEFAULT_PRODUCTS_FALLBACK, { status: 200 });
  }
}