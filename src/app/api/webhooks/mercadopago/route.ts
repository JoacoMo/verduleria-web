import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPayment, verifyWebhookSignature } from '@/lib/mercadopago';

export const runtime = 'nodejs';

// Mapa de estados de Mercado Pago a los estados que ya usa el panel.
const STATUS_BY_MP_STATUS: Record<string, 'paid' | 'pending' | 'cancelled' | 'failed'> = {
  approved: 'paid',
  authorized: 'pending',
  in_process: 'pending',
  in_mediation: 'pending',
  pending: 'pending',
  rejected: 'failed',
  cancelled: 'cancelled',
  refunded: 'cancelled',
  charged_back: 'cancelled',
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const dataId = url.searchParams.get('data.id') ?? url.searchParams.get('id');

  const signatureOk = verifyWebhookSignature({
    signatureHeader: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'),
    dataId,
  });

  if (!signatureOk) {
    console.error('Webhook de Mercado Pago con firma inválida.');
    return NextResponse.json({ error: 'Firma inválida.' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const topic = body.type ?? body.topic ?? url.searchParams.get('type');

    // Solo nos interesan las notificaciones de pago.
    if (topic !== 'payment') {
      return NextResponse.json({ received: true });
    }

    const paymentId = String(body.data?.id ?? dataId ?? '');
    if (!paymentId) {
      return NextResponse.json({ error: 'Falta el id del pago.' }, { status: 400 });
    }

    // Nunca confiamos en el cuerpo del webhook para el estado: lo consultamos
    // contra la API de MP con nuestro token.
    const payment = await getPayment(paymentId);
    if (!payment) {
      return NextResponse.json({ error: 'No se pudo consultar el pago.' }, { status: 502 });
    }

    const orderId = Number(payment.external_reference);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      console.error('Pago sin external_reference válido:', paymentId);
      return NextResponse.json({ received: true });
    }

    const nextStatus = STATUS_BY_MP_STATUS[payment.status] ?? 'pending';

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      console.error('Webhook para un pedido inexistente:', orderId);
      return NextResponse.json({ received: true });
    }

    // Un pedido ya confirmado a mano no se pisa con una notificación posterior.
    if (order.status === 'paid' && nextStatus !== 'cancelled') {
      return NextResponse.json({ received: true });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: nextStatus, mpPaymentId: paymentId },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error en POST /api/webhooks/mercadopago:', error);
    return NextResponse.json({ error: 'Error procesando la notificación.' }, { status: 500 });
  }
}
