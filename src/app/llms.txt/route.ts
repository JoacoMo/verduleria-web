import { getCachedProductsSlow } from '@/lib/products';
import { siteConfig } from '@/lib/site';
import { PRODUCT_UNIT_LABELS, isWeightUnit } from '@/lib/product-units';
import { PRODUCT_CATEGORIES } from '@/lib/product-categories';
import { formatArs } from '@/lib/format-price';
import { getDiscountPercent, getEffectivePrice, isOfferActive } from '@/lib/pricing';
import { DELIVERY_WINDOWS, SLOT_ORDER_LEAD_MINUTES } from '@/lib/delivery-slots';
import { OPENING_WINDOWS, ORDER_CUTOFF_LABEL, ORDER_CUTOFF_MINUTES, TIMEZONE, formatMinutes, pickupCutoffMinutes } from '@/lib/store-hours';
import type { Product } from '@/lib/types';

export const runtime = 'nodejs';
// Cada 10 minutos, por las ofertas que vencen. El catálogo sale de la caché de
// una hora (getCachedProductsSlow), que el panel invalida al instante.
export const revalidate = 600;

/**
 * /llms.txt — resumen del negocio en texto plano, pensado para asistentes de IA.
 *
 * Es una convención emergente (llmstxt.org): un archivo corto y sin markup con
 * los datos que un modelo necesita para responder sobre el local. No reemplaza al
 * HTML ni a los datos estructurados, pero es barato de mantener y algunos
 * crawlers ya lo buscan.
 *
 * Todo sale de las mismas fuentes que la tienda (siteConfig, pricing.ts,
 * delivery-slots.ts, store-hours.ts): si cambia un precio, un horario o el costo
 * del envío, este archivo cambia solo.
 */

const offerEndFormatter = new Intl.DateTimeFormat('es-AR', { timeZone: TIMEZONE, day: 'numeric', month: 'numeric' });

/** "de 13 a 14 h y de 19 a 20 h". */
function windowsText(windows: typeof DELIVERY_WINDOWS) {
  const hour = (minutes: number) => (minutes % 60 === 0 ? String(minutes / 60) : formatMinutes(minutes));
  return windows.map(({ start, end }) => `de ${hour(start)} a ${hour(end)} h`).join(' y ');
}

/** Turnos de envío del domingo, derivados del horario del local (el domingo se cierra antes). */
function sundayDeliveryText() {
  const sunday = DELIVERY_WINDOWS.filter(({ start, end }) =>
    (OPENING_WINDOWS[0] ?? []).some(([open, close]) => start >= open && end <= close),
  );
  if (sunday.length === DELIVERY_WINDOWS.length) return '';
  if (sunday.length === 0) return ' Los domingos no hay envíos.';
  return ` Los domingos solo ${windowsText(sunday)}.`;
}

const DAY_NAMES_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

/**
 * "después de las 19:00 (los domingos, después de las 14:00)": el corte de los
 * retiros es a las 19:00 o al cierre si el local cierra antes (pickupCutoffMinutes).
 */
function pickupCutoffText() {
  const exceptions = DAY_NAMES_PLURAL.flatMap((name, dayIndex) => {
    const cutoff = pickupCutoffMinutes(dayIndex);
    if (cutoff === ORDER_CUTOFF_MINUTES) return [];
    return [cutoff === 0 ? `los ${name}, que está cerrado` : `los ${name}, después de las ${formatMinutes(cutoff)}`];
  });
  return `después de las ${ORDER_CUTOFF_LABEL}${exceptions.length > 0 ? ` (${exceptions.join('; ')})` : ''}`;
}

function leadTimeText() {
  return SLOT_ORDER_LEAD_MINUTES % 60 === 0
    ? `${SLOT_ORDER_LEAD_MINUTES / 60} ${SLOT_ORDER_LEAD_MINUTES === 60 ? 'hora' : 'horas'}`
    : `${SLOT_ORDER_LEAD_MINUTES} minutos`;
}

/** Una descripción de varias líneas ("2 kg papa\n1 kg cebolla") en una sola: "2 kg papa, 1 kg cebolla". */
function singleLine(text: string) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim().replace(/[,;.]$/, ''))
    .filter(Boolean)
    .join(', ');
}

function priceText(product: Product, now: Date) {
  return `${formatArs(getEffectivePrice(product, now))} por ${PRODUCT_UNIT_LABELS[product.unit]}`;
}

function stockText(product: Product) {
  return product.available ? '' : ' — SIN STOCK por ahora';
}

function bolsonLine(product: Product, now: Date) {
  const description = product.description ? ` Trae: ${singleLine(product.description)}.` : '';
  return `- ${product.name}: ${priceText(product, now)}${stockText(product)}.${description}`;
}

function offerLine(product: Product, now: Date) {
  const endsAt = product.offerEndsAt ? `, hasta el ${offerEndFormatter.format(new Date(product.offerEndsAt))}` : '';
  return `- ${product.name}: ${priceText(product, now)} (antes ${formatArs(product.price)}, -${getDiscountPercent(product, now)}%${endsAt})${stockText(product)}`;
}

function catalogLine(product: Product, now: Date) {
  const offer = isOfferActive(product, now) ? ' (en oferta)' : '';
  return `- ${product.name}: ${priceText(product, now)}${offer}${stockText(product)}`;
}

function buildProductSections(products: Product[], now: Date) {
  const sections: string[] = [];

  const bolsones = products.filter((product) => product.category === 'Bolsones');
  if (bolsones.length > 0) {
    sections.push(`## Bolsones\n\nBolsones ya armados por el local, a precio cerrado.\n\n${bolsones.map((p) => bolsonLine(p, now)).join('\n')}`);
  }

  const offers = products.filter((product) => isOfferActive(product, now));
  if (offers.length > 0) {
    sections.push(`## Ofertas vigentes\n\n${offers.map((p) => offerLine(p, now)).join('\n')}`);
  }

  const byCategory = PRODUCT_CATEGORIES
    .filter((category) => category !== 'Bolsones')
    .map((category) => ({ category, items: products.filter((product) => product.category === category) }))
    .filter(({ items }) => items.length > 0)
    .map(({ category, items }) => `### ${category}\n\n${items.map((p) => catalogLine(p, now)).join('\n')}`);
  if (byCategory.length > 0) {
    sections.push(`## Catálogo\n\nPrecios orientativos: el precio vigente siempre es el del sitio.\n\n${byCategory.join('\n\n')}`);
  }

  return sections.join('\n\n');
}

export async function GET() {
  const now = new Date();
  let productSections = '';
  let hasWeightProducts = true;

  try {
    const products = await getCachedProductsSlow();
    if (products.length > 0) {
      productSections = buildProductSections(products, now);
      hasWeightProducts = products.some((product) => isWeightUnit(product.unit));
    }
  } catch (error) {
    console.error('Error al cargar productos para /llms.txt:', error);
  }

  const { siteUrl } = siteConfig;
  const contactLines = [
    `- WhatsApp: +${siteConfig.whatsappNumber}`,
    siteConfig.contactEmail ? `- Email: ${siteConfig.contactEmail}` : '',
    siteConfig.instagramUrl ? `- Instagram: ${siteConfig.instagramUrl}` : '',
  ].filter(Boolean).join('\n');

  const weightNote = hasWeightProducts
    ? `- Lo que se vende por peso (por kilo o por gramo) tiene total ESTIMADO: el local pesa, ajusta el pedido y le manda al cliente el total final por WhatsApp. Si el pedido no tiene nada por peso, el total es exacto.\n`
    : '';

  const body = `# ${siteConfig.storeName}

> Verdulería y frutería de barrio en ${siteConfig.storeNeighborhood}, Córdoba Capital, Argentina.
> Frutas, verduras, bolsones armados y productos de almacén, con retiro en el local
> o envío a domicilio en dos turnos por día. Se paga por transferencia o en efectivo.

## Datos del local

- Nombre: ${siteConfig.storeName}
- Rubro: Verdulería y frutería (GroceryStore)
- Dirección: ${siteConfig.storeAddress}
- Barrio: ${siteConfig.storeNeighborhood}
- Ciudad: Córdoba Capital, Provincia de Córdoba, Argentina
- Sitio web: ${siteUrl}
${contactLines}
- Horarios: ${siteConfig.storeHours.weekday}. ${siteConfig.storeHours.sunday}.

## Cómo comprar

- El pedido se arma en el sitio web: se elige retiro o envío y el medio de pago, y el pedido llega al local.
${weightNote}- Medios de pago: transferencia bancaria o efectivo. No se cobra con tarjeta por la web.
- Transferencia: se transfiere el total final que confirma el local por WhatsApp (no antes).
- Efectivo: se paga al recibir el pedido o al retirarlo.
- Las cantidades se eligen por kilo, por gramo, por unidad, por atado o por bandeja según el producto.
- Ofertas: algunos productos tienen precio de oferta por tiempo limitado; el precio que se cobra es el vigente al hacer el pedido.

## Retiro y envíos

- Retiro en el local: sin costo y sin turno, en el horario de atención. Los pedidos para retirar hechos ${pickupCutoffText()} se preparan al día siguiente que abre el local.
- Envío a domicilio en Córdoba Capital, en dos turnos fijos: ${windowsText(DELIVERY_WINDOWS)}.${sundayDeliveryText()} Hay que pedir con al menos ${leadTimeText()} de anticipación.
- Costo del envío: ${formatArs(siteConfig.deliveryFee)} fijo. Gratis en pedidos desde ${formatArs(siteConfig.deliveryFreeThreshold)} en productos.
- Pedido mínimo para envío: ${formatArs(siteConfig.deliveryMinPurchase)} en productos (sin contar el envío).
- Peso orientativo por envío: hasta ${siteConfig.deliveryMaxWeightKg} kg; pedidos más pesados se coordinan por WhatsApp.

${productSections || '## Productos\n\nConsultar el catálogo actualizado en el sitio.'}

## Páginas

- ${siteUrl} — tienda online y catálogo
- ${siteUrl}/bolsones — bolsones armados
- ${siteUrl}/ofertas — ofertas vigentes
- ${siteUrl}/frutas — frutas
- ${siteUrl}/verduras — verduras
- ${siteUrl}/envios — envíos, turnos y costos
- ${siteUrl}/terminos — términos y condiciones
- ${siteUrl}/privacidad — política de privacidad
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
    },
  });
}
