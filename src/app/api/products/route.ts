import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const DEFAULT_PRODUCT_SEED = [
  { name: 'Tomate', price: 800, image: 'https://via.placeholder.com/300?text=Tomate', stock: 50 },
  { name: 'Papa', price: 500, image: 'https://via.placeholder.com/300?text=Papa', stock: 100 },
  { name: 'Lechuga', price: 600, image: 'https://via.placeholder.com/300?text=Lechuga', stock: 30 },
];

const DEFAULT_PRODUCTS_FALLBACK = [
  { id: -1, name: 'Tomate', price: 800, image: 'https://via.placeholder.com/300?text=Tomate', stock: 50 },
  { id: -2, name: 'Papa', price: 500, image: 'https://via.placeholder.com/300?text=Papa', stock: 100 },
  { id: -3, name: 'Lechuga', price: 600, image: 'https://via.placeholder.com/300?text=Lechuga', stock: 30 },
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