import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { name, message, email } = await request.json();
    console.log('Nuevo mensaje de contacto:', { name, email, message });
    return NextResponse.json({ message: 'Mensaje recibido, te vamos a contactar pronto.' });
  } catch (error) {
    console.error('Error en POST /api/contact:', error);
    return NextResponse.json({ error: 'No se pudo enviar el mensaje.' }, { status: 500 });
  }
}