import type { OrderRecord, StoreInfo } from '@/lib/types';
import { formatArs } from '@/lib/format-price';
import { formatProductQuantity } from '@/lib/product-units';
import { lineTotal } from '@/lib/pricing';
import { describeSlot } from '@/lib/delivery-slots';
import { firstName } from './format';
import { isAwaitingWeights, isShippingChargedApart } from './orders-model';

/**
 * Mensajes de WhatsApp que el dueño le manda al cliente desde el panel.
 *
 * Son funciones puras (texto plano con las marcas de WhatsApp: *negrita*) para
 * poder testearlas y para que el mensaje sea siempre el mismo, sin depender de
 * cómo lo escriba el dueño apurado a la hora del reparto.
 */

export type FinalTotalStoreInfo = Pick<StoreInfo, 'storeName' | 'storeAddress' | 'transferAlias' | 'transferCbu'>;
export type ReviewStoreInfo = Pick<StoreInfo, 'storeName' | 'googleReviewUrl'>;

function greeting(order: Pick<OrderRecord, 'customerName'>) {
  // Sin las marcas de formato de WhatsApp: el nombre lo escribió el cliente.
  const name = firstName(order.customerName).replace(/[*_~`]/g, '');
  return name ? `*Hola ${name}!*` : '*Hola!*';
}

function lowercaseFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * "Avisar total final": se manda cuando el pedido ya está armado y pesado. Lleva
 * el detalle con los pesos reales, el total final (que es lo que se paga) y qué
 * hacer según el medio de pago.
 *
 * Un pedido viejo sin medio de pago guardado se trata como transferencia, que
 * era la única opción antes.
 *
 * El panel no deja mandarlo mientras haya productos por peso sin pesar (el
 * botón queda deshabilitado). Igual, como defensa, en ese caso el total sale
 * como "Total estimado" y no como "Total final": el cliente transfiere lo que
 * dice el mensaje.
 */
export function buildFinalTotalMessage(order: OrderRecord, store: FinalTotalStoreInfo): string {
  const isDelivery = order.deliveryMethod === 'delivery';
  const totalName = isAwaitingWeights(order) ? 'Total estimado' : 'Total final';
  const lines: string[] = [
    `${greeting(order)} tu pedido #${order.id} de ${store.storeName} ya está armado ✅`,
    '',
    ...order.items.map((item) => `• ${formatProductQuantity(item.quantity, item.unit)} de ${item.name}: ${formatArs(lineTotal(item))}`),
    '',
  ];

  if (isDelivery && isShippingChargedApart(order)) {
    lines.push(`*${totalName}: ${formatArs(order.total)}* (sin el envío, que se paga aparte)`);
  } else if (isDelivery) {
    lines.push(`Subtotal: ${formatArs(order.subtotal)}`);
    lines.push(`Envío: ${order.shippingCost > 0 ? formatArs(order.shippingCost) : 'gratis'}`);
    lines.push(`*${totalName}: ${formatArs(order.total)}* (${order.shippingCost > 0 ? 'envío incluido' : 'envío gratis'})`);
  } else {
    lines.push(`*${totalName}: ${formatArs(order.total)}*`);
  }
  lines.push('');

  if (isDelivery) {
    const slot = describeSlot(order.deliverySlot);
    const when = slot ? ` el ${lowercaseFirst(slot)}` : '';
    // La dirección NO va en el mensaje: es texto libre que cargó quien hizo el
    // pedido, y este mensaje sale del WhatsApp del local hacia un teléfono que
    // también cargó esa persona. Se podía usar para que el local mandara un
    // "cambiamos de alias" falso. El cliente ya sabe su dirección.
    lines.push(`Te lo llevamos${when} a la dirección que nos pasaste.`);
  } else {
    lines.push(`Ya lo podés pasar a retirar por ${store.storeAddress}.`);
  }

  if (order.paymentMethod === 'cash') {
    lines.push(isDelivery ? 'Lo pagás en efectivo al recibirlo.' : 'Lo pagás en efectivo al retirarlo.');
  } else {
    const alias = store.transferAlias.trim();
    const cbu = store.transferCbu.trim();
    if (alias || cbu) {
      lines.push('', 'Para pagar por transferencia:');
      // Alias y CBU van sin negrita y en su propia línea: al copiarlos desde
      // WhatsApp, los asteriscos se copian también y el home banking los rechaza.
      if (alias) lines.push(`Alias: ${alias}`);
      if (cbu) lines.push(`CBU: ${cbu}`);
      lines.push('Cuando transfieras, mandanos el comprobante por acá.');
    } else {
      lines.push('', 'Te pasamos por acá los datos para transferir. Cuando transfieras, mandanos el comprobante.');
    }
  }

  lines.push('', '¡Gracias!');
  return lines.join('\n');
}

/**
 * "Pedir reseña": solo tiene sentido con el pedido ya pagado (entregado) y con
 * el link de reseñas de Google configurado. Devuelve null si no corresponde.
 */
export function buildReviewRequestMessage(
  order: Pick<OrderRecord, 'customerName' | 'status'>,
  store: ReviewStoreInfo,
): string | null {
  const reviewUrl = store.googleReviewUrl.trim();
  if (!reviewUrl || order.status !== 'paid') return null;

  return [
    `${greeting(order)} Gracias por comprar en ${store.storeName} 💚`,
    '',
    'Si te gustó el pedido, ¿nos dejás una reseña en Google? Es un minuto y a una verdulería de barrio le suma muchísimo:',
    reviewUrl,
    '',
    '¡Gracias!',
  ].join('\n');
}
