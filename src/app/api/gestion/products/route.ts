import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ValidationError, parseProductPayload } from '@/lib/validation';
import { invalidarProductos } from '@/lib/products';
import { readJsonBody } from '@/lib/request-body';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, 'adminWrite');
  if (limited) return limited;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  try {
    const data = parseProductPayload(parsed.data);
    const product = await prisma.product.create({ data });
    invalidarProductos();
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    // Solo los errores de validación tienen un mensaje pensado para el usuario;
    // cualquier otro (Prisma, red) se loguea y se responde genérico.
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error en POST /api/gestion/products:', error);
    return NextResponse.json({ error: 'Error al crear el producto.' }, { status: 500 });
  }
}