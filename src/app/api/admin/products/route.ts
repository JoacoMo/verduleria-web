import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { parseProductPayload } from '@/lib/validation';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  try {
    const data = parseProductPayload(await request.json());
    const product = await prisma.product.create({ data });
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error('Error en POST /api/admin/products:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al crear el producto.' }, { status: 400 });
  }
}