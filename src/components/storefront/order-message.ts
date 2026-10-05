import { describeSlot } from '@/lib/delivery-slots';
import { formatArs } from '@/lib/format-price';
import {
  PAYMENT_METHOD_LABELS,
  REPLACEMENT_POLICY_LABELS,
  type DeliveryMethod,
  type PaymentMethod,
  type ReplacementPolicy,
} from '@/lib/order-options';
import { lineTotal } from '@/lib/pricing';
import { formatProductQuantity, isWeightUnit } from '@/lib/product-units';
import type { OrderItem } from '@/lib/types';
import { buildWhatsappUrl } from '@/lib/whatsapp';

export type OrderMessageInput = {
  orderId: number;
  storeName: string;
  customerName: string;
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  total: number;
  deliveryMethod: DeliveryMethod;
  customerAddress: string | null;
  /** id del turno ("2026-10-06T13"); se escribe con fecha absoluta para el local. */
  deliverySlotId: string | null;
  /** Texto del turno por si el id no se puede describir ("Hoy de 13 a 14 h"). */
  deliverySlotLabel?: string | null;
  paymentMethod: PaymentMethod;
  replacementPolicy: ReplacementPolicy;
  notes: string | null;
};

/**
 * Mensaje de WhatsApp que el cliente le manda al local con su pedido.
 *
 * WhatsApp muestra *texto* en negrita y _texto_ en cursiva y respeta los saltos
 * de línea, así que se arma como texto plano con esas marcas. Los emojis sirven
 * de "títulos" para que el dueño lo lea de un vistazo desde el celular.
 *
 * Es una función pura para poder testearla sin navegador.
 */
export function buildOrderMessage(input: OrderMessageInput): string {
  const isDelivery = input.deliveryMethod === 'delivery';
  const approximate = input.items.some((item) => isWeightUnit(item.unit));
  const lines: string[] = [];

  lines.push(`🥬 *Pedido #${input.orderId} — ${input.storeName}*`);
  lines.push(`👤 ${input.customerName.trim()}`);
  lines.push('');
  lines.push('🛒 *Productos*');
  for (const item of input.items) {
    lines.push(`• ${formatProductQuantity(item.quantity, item.unit)} ${item.name} — ${formatArs(lineTotal(item))}`);
  }
  lines.push('');

  // Con retiro el subtotal es el total: repetirlo solo agrega ruido.
  if (isDelivery) {
    lines.push(`Subtotal: ${formatArs(input.subtotal)}`);
    lines.push(`Envío: ${input.shippingCost > 0 ? formatArs(input.shippingCost) : 'gratis'}`);
  }
  lines.push(`💰 *Total${approximate ? ' aprox.' : ''}: ${formatArs(input.total)}*`);
  if (approximate) {
    lines.push('_Lo que va por peso se ajusta al pesar: espero el total final por acá._');
  }
  lines.push('');

  if (isDelivery) {
    const address = input.customerAddress?.trim();
    lines.push(`🚚 *Envío a domicilio:* ${address || 'a coordinar'}`);
    const slotText = describeSlot(input.deliverySlotId) ?? input.deliverySlotLabel ?? null;
    if (slotText) lines.push(`🕐 *Turno:* ${slotText}`);
  } else {
    lines.push('🏪 *Retiro en el local*');
  }

  if (input.paymentMethod === 'transfer') {
    lines.push(`💳 *Pago:* ${PAYMENT_METHOD_LABELS.transfer}${approximate ? ' (cuando me pasen el total final)' : ''}`);
  } else {
    lines.push(`💵 *Pago:* ${PAYMENT_METHOD_LABELS.cash} ${isDelivery ? 'al recibir' : 'al retirar'}`);
  }

  lines.push(`🔁 *Si falta algo:* ${REPLACEMENT_POLICY_LABELS[input.replacementPolicy]}`);

  const notes = input.notes?.trim();
  if (notes) lines.push(`📝 *Aclaraciones:* ${notes}`);

  return lines.join('\n');
}

/** Link de wa.me al número del local con el mensaje del pedido ya escrito. */
export function buildOrderWhatsappUrl(whatsappNumber: string, input: OrderMessageInput) {
  return buildWhatsappUrl(whatsappNumber, buildOrderMessage(input));
}
