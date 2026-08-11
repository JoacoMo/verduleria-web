import { createHmac, timingSafeEqual } from 'node:crypto';
import { siteConfig } from './site';

/**
 * Integración con Mercado Pago (Checkout Pro).
 *
 * Se le pega a la API REST con fetch, igual que hacemos con Supabase Storage,
 * en vez de sumar el SDK. Para Checkout Pro alcanza con dos llamadas:
 * crear la preferencia y, cuando avisa el webhook, consultar el pago.
 */

const MP_API = 'https://api.mercadopago.com';

function getAccessToken() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    throw new Error('Falta MP_ACCESS_TOKEN.');
  }
  return token;
}

export function isMercadoPagoEnabled() {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

export type PreferenceItem = {
  id: number;
  name: string;
  quantity: number;
  unit: string;
  price: number;
};

/**
 * Crea la preferencia de pago y devuelve el link al que hay que mandar al cliente.
 *
 * Ojo con las cantidades fraccionarias (0.75 kg): Mercado Pago espera unit_price
 * por unidad y quantity entero. Para no pelear con eso, cada línea se manda como
 * una sola "unidad" cuyo precio es el subtotal, y la cantidad real queda escrita
 * en el título del ítem, que es lo que ve el cliente en el checkout.
 */
export async function createPaymentPreference(params: {
  orderId: number;
  items: PreferenceItem[];
  total: number;
}) {
  const { orderId, items, total } = params;

  const body = {
    external_reference: String(orderId),
    items: items.map((item) => ({
      id: String(item.id),
      title: `${item.name} (${item.quantity} ${item.unit})`,
      quantity: 1,
      currency_id: 'ARS',
      unit_price: Number((item.price * item.quantity).toFixed(2)),
    })),
    back_urls: {
      success: `${siteConfig.siteUrl}/success`,
      failure: `${siteConfig.siteUrl}/failure`,
      pending: `${siteConfig.siteUrl}/pending`,
    },
    auto_return: 'approved',
    notification_url: `${siteConfig.siteUrl}/api/webhooks/mercadopago`,
    statement_descriptor: siteConfig.storeName,
    metadata: { order_id: orderId, total },
  };

  const response = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('Error al crear la preferencia de Mercado Pago:', detail);
    throw new Error('No se pudo generar el link de pago.');
  }

  const preference = await response.json();

  return {
    preferenceId: preference.id as string,
    // sandbox_init_point es el link de prueba; init_point es el real.
    checkoutUrl: (preference.init_point || preference.sandbox_init_point) as string,
  };
}

export async function getPayment(paymentId: string) {
  const response = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  });

  if (!response.ok) {
    console.error('Error al consultar el pago en Mercado Pago:', await response.text());
    return null;
  }

  return response.json();
}

/**
 * Valida la firma del webhook (cabecera x-signature).
 *
 * Sin esto cualquiera que conozca la URL podría marcar pedidos como pagados
 * mandando un POST. MP firma con HMAC-SHA256 el template
 * `id:<dataId>;request-id:<xRequestId>;ts:<ts>;`.
 */
export function verifyWebhookSignature(params: {
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
}) {
  const secret = process.env.MP_WEBHOOK_SECRET;

  // Si no hay secreto configurado no podemos validar nada: se rechaza, porque
  // aceptar sin verificar sería peor que no tener webhook.
  if (!secret) {
    console.error('Falta MP_WEBHOOK_SECRET: no se puede validar el webhook.');
    return false;
  }

  if (!params.signatureHeader || !params.dataId) return false;

  // Formato: "ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839"
  const parts = new Map(
    params.signatureHeader.split(',').map((chunk) => {
      const [key, value] = chunk.split('=');
      return [key?.trim(), value?.trim()] as const;
    }),
  );

  const ts = parts.get('ts');
  const receivedHash = parts.get('v1');
  if (!ts || !receivedHash) return false;

  const manifest = `id:${params.dataId};request-id:${params.requestId ?? ''};ts:${ts};`;
  const expectedHash = createHmac('sha256', secret).update(manifest).digest('hex');

  const receivedBuffer = Buffer.from(receivedHash, 'utf8');
  const expectedBuffer = Buffer.from(expectedHash, 'utf8');
  if (receivedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
