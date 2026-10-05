import type { ReactNode } from 'react';
import Link from 'next/link';
import { FaqList, getShippingFaqEntries } from '@/components/info-section';
import { siteConfig } from '@/lib/site';
import { formatArs } from '@/lib/format-price';
import { buildWhatsappUrl } from '@/lib/whatsapp';
import {
  buildBreadcrumbs,
  buildFaqQuestions,
  buildPageMetadata,
  buildStoreJsonLd,
  buildWebPageJsonLd,
  buildWebsiteJsonLd,
  getDeliveryScheduleText,
  getFullAddress,
  getLeadTimeText,
  jsonLdGraph,
  jsonLdScriptProps,
} from '@/lib/seo';

// Por request, como toda la app: lo exige la CSP con nonce (ver layout.tsx).
export const dynamic = 'force-dynamic';

const PATH = '/envios';
const TITLE = 'Envíos a domicilio y retiro en el local';
const DESCRIPTION = `Envíos de ${siteConfig.storeName} en Córdoba Capital ${getDeliveryScheduleText().weekdays}: ${formatArs(siteConfig.deliveryFee)} fijo, gratis desde ${formatArs(siteConfig.deliveryFreeThreshold)}. Mínimo ${formatArs(siteConfig.deliveryMinPurchase)}. Retiro sin costo en ${siteConfig.storeNeighborhood}.`;

export const metadata = buildPageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

const linkRowStyle = { display: 'flex', flexWrap: 'wrap' as const, gap: '6px 18px' };

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="faq-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Todo lo que hay que saber del envío y el retiro, en una página propia y sin
 * carrito: es lo que se comparte cuando alguien pregunta "¿hacen envíos?" y lo
 * que encuentran los buscadores para "verdulería con envío en Córdoba".
 */
export default function EnviosPage() {
  const schedule = getDeliveryScheduleText();
  const lead = getLeadTimeText();
  const faq = getShippingFaqEntries();

  const structuredData = jsonLdGraph([
    buildStoreJsonLd(),
    buildWebsiteJsonLd(),
    buildBreadcrumbs([
      { name: 'Inicio', path: '/' },
      { name: 'Envíos y retiro', path: PATH },
    ]),
    // La página es una FAQPage: las preguntas son las mismas que se ven abajo.
    buildWebPageJsonLd({
      type: 'FAQPage',
      path: PATH,
      name: TITLE,
      description: DESCRIPTION,
      hasBreadcrumb: true,
      mainEntity: buildFaqQuestions(faq),
    }),
  ]);

  return (
    <main className="legal-page">
      <script {...jsonLdScriptProps(structuredData)} />
      <Link href="/" className="back-link">← Volver a la tienda</Link>
      <h1>Envíos y retiro</h1>
      <p>
        Tu pedido de {siteConfig.storeName} lo podés recibir en tu casa, dentro de Córdoba Capital, o retirarlo en el
        local. Acá está todo lo que conviene saber antes de pedir.
      </p>

      <h2>En resumen</h2>
      <dl className="faq-list">
        <SummaryRow label="Zona de entrega">Córdoba Capital.</SummaryRow>
        <SummaryRow label="Turnos">{schedule.summary}</SummaryRow>
        <SummaryRow label="Anticipación">
          Al menos {lead} antes de que empiece el turno ({schedule.deadlines}).
        </SummaryRow>
        <SummaryRow label="Costo del envío">
          {formatArs(siteConfig.deliveryFee)}, fijo. <strong>Gratis en pedidos desde {formatArs(siteConfig.deliveryFreeThreshold)}</strong>.
        </SummaryRow>
        <SummaryRow label="Pedido mínimo para envío">
          {formatArs(siteConfig.deliveryMinPurchase)} en productos, sin contar el envío.
        </SummaryRow>
        <SummaryRow label="Retiro en el local">
          Sin costo, sin mínimo y sin turno, en {getFullAddress()}. {siteConfig.storeHours.weekday}.{' '}
          {siteConfig.storeHours.sunday}.
        </SummaryRow>
        <SummaryRow label="Medios de pago">
          Transferencia o efectivo. En lo que va por peso, el total final te lo mandamos por WhatsApp después de pesar.
        </SummaryRow>
      </dl>

      <h2>Preguntas frecuentes</h2>
      <FaqList entries={faq} />

      <h2>¿Listo para pedir?</h2>
      <p>
        Armá tu pedido en la tienda y elegí envío o retiro al final. Si tenés alguna duda, escribinos antes.
      </p>
      <p style={linkRowStyle}>
        <Link href="/">Ir a la tienda</Link>
        <Link href="/bolsones">Ver los bolsones</Link>
        <Link href="/ofertas">Ver las ofertas</Link>
        <a href={buildWhatsappUrl(siteConfig.whatsappNumber)} target="_blank" rel="noopener noreferrer">
          Escribirnos por WhatsApp
        </a>
      </p>
    </main>
  );
}
