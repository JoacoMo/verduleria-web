import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const products = await prisma.product.findMany({ orderBy: { id: 'asc' } });
    return NextResponse.json(products);
  } catch (error) {
    console.error('Error en GET /api/products:', error);
    return NextResponse.json({ error: 'Error al obtener los productos.' }, { status: 500 });
  }
}