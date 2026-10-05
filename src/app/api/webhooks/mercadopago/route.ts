import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPayment, verifyWebhookSignature } from '@/lib/mercadopago';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { logSecurityEvent } from '@/lib/security-log';

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

// Margen por redondeo de centavos entre lo que calculamos y lo que cobra MP.
const PAYMENT_AMOUNT_TOLERANCE = 1;

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, 'webhook');
  if (limited) return limited;

  const url = new URL(request.url);
  const dataId = url.searchParams.get('data.id') ?? url.searchParams.get('id');

  const signatureOk = verifyWebhookSignature({
    signatureHeader: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'),
    dataId,
  });

  if (!signatureOk) {
    logSecurityEvent('webhook_firma_invalida', {
      ip: getClientIp(request),
      path: '/api/webhooks/mercadopago',
      method: 'POST',
      subject: dataId ?? undefined,
    });
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

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      console.error('Webhook para un pedido inexistente:', orderId);
      return NextResponse.json({ received: true });
    }

    let nextStatus = STATUS_BY_MP_STATUS[payment.status] ?? 'pending';

    // Un pago aprobado solo marca el pedido como pagado si el monto y la moneda
    // coinciden con lo que se guardó al hacer el checkout. Es una segunda barrera
    // por si alguna vez se arma un pago con el external_reference de otro pedido
    // (por ejemplo, un link de pago viejo o uno creado a mano en el panel de MP).
    if (nextStatus === 'paid') {
      const paidAmount = Number(payment.transaction_amount);
      const amountOk = Number.isFinite(paidAmount) && Math.abs(paidAmount - order.total) <= PAYMENT_AMOUNT_TOLERANCE;
      if (!amountOk || payment.currency_id !== 'ARS') {
        logSecurityEvent('pago_monto_distinto', {
          ip: getClientIp(request),
          path: '/api/webhooks/mercadopago',
          method: 'POST',
          subject: String(orderId),
          reason: `pagado ${payment.transaction_amount} ${payment.currency_id}, esperado ${order.total} ARS`,
        });
        // Queda pendiente para que el dueño lo revise a mano en el panel.
        nextStatus = 'pending';
      }
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
