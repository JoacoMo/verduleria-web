import Link from 'next/link';
import { Info } from 'lucide-react';
import { siteConfig } from '@/lib/site';
import { formatArs } from '@/lib/format-price';
import { ORDER_CUTOFF_LABEL } from '@/lib/store-hours';
import { getDeliveryScheduleText, getFullAddress, getLeadTimeText, type FaqEntry } from '@/lib/seo';

/**
 * Contenido informativo de servidor: preguntas frecuentes, "sobre el local" y
 * links entre páginas.
 *
 * Es contenido real para el cliente, no texto escondido para posicionar:
 * ocultarlo sería cloaking y además es justo el texto que un asistente cita
 * cuando le preguntan por horarios, envíos o formas de pago. Por eso las mismas
 * preguntas alimentan el JSON-LD (FAQPage) y lo que se ve en la página.
 */

// ---------------------------------------------------------------------------
// Respuestas compartidas entre la home y /envios
// ---------------------------------------------------------------------------

function paymentAnswer() {
  return 'Por transferencia o en efectivo; no hay pagos online. Si el pedido tiene productos por peso, esperás el total final que te mandamos por WhatsApp cuando lo armamos y recién ahí transferís. Si no tiene nada por peso, el total ya es exacto: transferís al hacer el pedido y nos mandás el comprobante por WhatsApp. En efectivo pagás al recibirlo o al retirarlo.';
}

function weightAnswer() {
  return 'Solo en lo que va por peso (por kilo o por gramo): la fruta y la verdura no pesan justo lo que pediste, así que el total que ves al pedir es estimado. Cuando armamos el pedido pesamos todo, ajustamos las cantidades reales y te mandamos el total final por WhatsApp. El precio por kilo no cambia, lo que varía es el peso. Lo que se vende por unidad, atado o bandeja tiene precio exacto.';
}

function replacementAnswer() {
  return 'Al hacer el pedido elegís qué preferís: que lo reemplacemos por uno similar, que lo saquemos del pedido o que te escribamos antes de decidir. Si se saca algo, se descuenta del total final.';
}

function shippingCostAnswer() {
  return `El envío cuesta ${formatArs(siteConfig.deliveryFee)}, fijo, y es gratis en pedidos desde ${formatArs(siteConfig.deliveryFreeThreshold)}. Para pedir con envío el mínimo es ${formatArs(siteConfig.deliveryMinPurchase)} en productos, sin contar el envío. Retirar en el local no tiene costo ni mínimo.`;
}

function pickupAnswer() {
  return `Sí, sin costo y sin turno, en ${getFullAddress()}. ${siteConfig.storeHours.weekday}. ${siteConfig.storeHours.sunday}. Los pedidos para retirar que llegan antes de las ${ORDER_CUTOFF_LABEL} se preparan en el día; los que llegan después, a partir del día siguiente.`;
}

/** Preguntas frecuentes de la home. */
export function getHomeFaqEntries(): FaqEntry[] {
  const schedule = getDeliveryScheduleText();
  const lead = getLeadTimeText();

  return [
    {
      question: `¿Dónde queda ${siteConfig.storeName}?`,
      answer: `${siteConfig.storeName} está en ${getFullAddress()}. Podés retirar tu pedido ahí sin costo.`,
    },
    {
      question: '¿Cuáles son los horarios del local?',
      answer: `${siteConfig.storeHours.weekday}. ${siteConfig.storeHours.sunday}.`,
    },
    {
      question: '¿Hacen envíos a domicilio?',
      answer: `Sí, dentro de Córdoba Capital y en turnos fijos. ${schedule.summary} El turno lo elegís al hacer el pedido, con al menos ${lead} de anticipación.`,
    },
    {
      question: '¿Cuánto cuesta el envío?',
      answer: shippingCostAnswer(),
    },
    {
      question: '¿Cómo se paga?',
      answer: paymentAnswer(),
    },
    {
      question: '¿El total puede cambiar?',
      answer: weightAnswer(),
    },
    {
      question: '¿Qué son los bolsones?',
      answer: 'Son bolsones de frutas y verduras que armamos en el local, con un precio por bolsón. En cada uno figura qué trae, y los podés sumar al pedido junto con cualquier otro producto.',
    },
    {
      question: '¿Tienen ofertas?',
      answer: 'Sí. Los productos en oferta muestran el precio rebajado, el precio normal tachado y el descuento; si la oferta tiene fecha de cierre, también figura hasta cuándo vale. Están todas juntas en la sección Ofertas.',
    },
    {
      question: '¿Qué pasa si falta algún producto?',
      answer: replacementAnswer(),
    },
    {
      question: '¿Hasta qué hora puedo pedir?',
      answer: `Para retirar, los pedidos que llegan antes de las ${ORDER_CUTOFF_LABEL} se preparan en el día y los que llegan después, a partir del día siguiente. Para envío, elegís uno de los próximos turnos con al menos ${lead} de anticipación: ${schedule.deadlines}.`,
    },
    {
      question: '¿Se puede comprar por gramo?',
      answer: 'Sí. Lo que va por peso se puede pedir por kilo o por gramos (por ejemplo, 300 g o 1,5 kg). El resto se vende por unidad, atado o bandeja.',
    },
  ];
}

/** Preguntas frecuentes de /envios. */
export function getShippingFaqEntries(): FaqEntry[] {
  const schedule = getDeliveryScheduleText();
  const lead = getLeadTimeText();

  return [
    {
      question: '¿A qué zonas hacen envíos?',
      answer: 'Hacemos envíos dentro de Córdoba Capital. Si no sabés si llegamos a tu dirección, escribinos por WhatsApp antes de hacer el pedido.',
    },
    {
      question: '¿En qué horarios entregan?',
      answer: `En turnos fijos. ${schedule.summary} El turno lo elegís al hacer el pedido, entre los próximos disponibles.`,
    },
    {
      question: '¿Con cuánta anticipación tengo que pedir?',
      answer: `Tiene que faltar al menos ${lead} para que empiece el turno: ${schedule.deadlines}. La web solo te muestra los turnos que todavía se pueden elegir.`,
    },
    {
      question: '¿Cuánto cuesta el envío?',
      answer: shippingCostAnswer(),
    },
    {
      question: '¿Puedo retirar en el local?',
      answer: pickupAnswer(),
    },
    {
      question: '¿Cómo se paga?',
      answer: paymentAnswer(),
    },
    {
      question: '¿Por qué el total puede cambiar?',
      answer: weightAnswer(),
    },
    {
      question: '¿Qué pasa si falta algún producto?',
      answer: replacementAnswer(),
    },
    {
      question: '¿Y si el pedido es muy pesado?',
      answer: `Si pesa más de unos ${siteConfig.deliveryMaxWeightKg} kg puede hacer falta más de un viaje: en ese caso te escribimos por WhatsApp para coordinar la entrega.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------

export function FaqList({ entries }: { entries: FaqEntry[] }) {
  return (
    <dl className="faq-list">
      {entries.map((entry) => (
        <div className="faq-item" key={entry.question}>
          <dt>{entry.question}</dt>
          <dd>{entry.answer}</dd>
        </div>
      ))}
    </dl>
  );
}

const INFO_LINKS = [
  { href: '/', label: 'Ver toda la tienda' },
  { href: '/bolsones', label: 'Bolsones' },
  { href: '/ofertas', label: 'Ofertas' },
  { href: '/frutas', label: 'Frutas' },
  { href: '/verduras', label: 'Verduras' },
  { href: '/envios', label: 'Envíos, turnos y retiro' },
];

const linkRowStyle = { display: 'flex', flexWrap: 'wrap' as const, gap: '6px 18px', margin: '18px 0 0' };
const linkStyle = { color: 'var(--leaf-dark)', fontWeight: 600 };

/** Links a las otras páginas del sitio (sin la actual). Ayudan a navegar y a que Google las encuentre. */
export function InfoLinks({ current }: { current?: string }) {
  return (
    <p style={linkRowStyle}>
      {INFO_LINKS.filter((link) => link.href !== current).map((link) => (
        <Link key={link.href} href={link.href} style={linkStyle}>
          {link.label}
        </Link>
      ))}
    </p>
  );
}

/** Párrafo de envíos que repiten la home y las páginas de categoría. */
export function DeliveryParagraph() {
  const { summary } = getDeliveryScheduleText();
  // "De lunes a sábado..." va después de dos puntos: con minúscula.
  const schedule = summary.charAt(0).toLowerCase() + summary.slice(1);
  return (
    <p>
      Hacemos envíos dentro de Córdoba Capital en turnos fijos: {schedule} El envío cuesta{' '}
      {formatArs(siteConfig.deliveryFee)} y es{' '}
      <strong>gratis en pedidos desde {formatArs(siteConfig.deliveryFreeThreshold)}</strong>; el mínimo para envío es{' '}
      {formatArs(siteConfig.deliveryMinPurchase)} en productos. También podés retirar en el local, sin costo y sin turno.
    </p>
  );
}

/** "Sobre el local" + preguntas frecuentes de la home. */
export function HomeInfoSection({ faq }: { faq: FaqEntry[] }) {
  return (
    <section className="info-section" id="informacion">
      <h2><Info size={30} aria-hidden="true" /> Sobre {siteConfig.storeName}</h2>
      <p>
        {siteConfig.storeName} es una verdulería y frutería de barrio en {getFullAddress()}. Vendemos frutas, verduras,
        bolsones armados y productos de almacén, que podés comprar por kilo, por gramo o por unidad.
      </p>
      <DeliveryParagraph />
      <p>
        Pagás por transferencia o en efectivo. En lo que va por peso el total es estimado: cuando armamos el pedido lo
        pesamos y te mandamos el total final por WhatsApp. Si elegís transferencia, transferís ese total; en efectivo,
        pagás al recibir o al retirar.
      </p>
      <InfoLinks current="/" />

      <h3>Preguntas frecuentes</h3>
      <FaqList entries={faq} />
    </section>
  );
}
