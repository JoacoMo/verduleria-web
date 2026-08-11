import type { Metadata } from 'next';
import StorefrontPage from '@/components/storefront-page';
import { siteConfig } from '@/lib/site';
import { getCachedProducts } from '@/lib/products';
import type { Product } from '@/lib/types';
import { PRODUCT_UNIT_LABELS, isProductUnit } from '@/lib/product-units';
import { formatArs } from '@/lib/format-price';
import { isProductCategory } from '@/lib/product-categories';

// La página se renderiza en el servidor en cada visita (no es estática) porque la
// CSP con nonce necesita un valor distinto por request, y el nonce se lee de las
// cabeceras. El HTML sigue llegando con los productos ya incluidos, que es lo que
// necesitan los buscadores y los crawlers de IA.
//
// Costo: cada visita ejecuta una función y una consulta a la base, en vez de salir
// de la CDN. Para el tráfico de una verdulería de barrio es razonable; si algún día
// molesta, la alternativa es volver a 'unsafe-inline' en script-src (CSP más débil).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'El Pampa | Verdulería y Frutería a Domicilio en Córdoba',
  description:
    'Verdulería y frutería El Pampa en Rosario de Santa Fe 1211, Barrio General Paz, Córdoba Capital. Frutas y verduras frescas por kilo, gramo o unidad, con retiro en el local o envío a domicilio. Envío gratis en pedidos desde $20.000.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: `${siteConfig.storeName} | Verdulería y Frutería a Domicilio en Córdoba`,
    description:
      'Frutas y verduras frescas en Barrio General Paz, Córdoba Capital. Pedí por kilo, gramo o unidad. Envío gratis desde $20.000.',
    url: siteConfig.siteUrl,
    siteName: siteConfig.storeName,
    locale: 'es_AR',
    type: 'website',
  },
};

// Coordenadas del local (las mismas que usa el mapa embebido).
const STORE_GEO = { latitude: -31.415961, longitude: -64.168769 };

const OPENING_HOURS = [
  {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    opens: '08:00',
    closes: '14:00',
  },
  {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    opens: '17:30',
    closes: '21:30',
  },
  {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Sunday'],
    opens: '09:00',
    closes: '14:00',
  },
];

const FAQ_ENTRIES = [
  {
    question: '¿Dónde queda El Pampa?',
    answer: `${siteConfig.storeName} está en ${siteConfig.storeAddress}, en ${siteConfig.storeNeighborhood}, Córdoba Capital.`,
  },
  {
    question: '¿Cuáles son los horarios?',
    answer: `${siteConfig.storeHours.weekday}. ${siteConfig.storeHours.sunday}.`,
  },
  {
    question: '¿Hacen envíos a domicilio?',
    answer: `Sí. Coordinamos envíos por ${siteConfig.deliveryProviderName} dentro de Córdoba Capital. El pedido mínimo para envío es ${formatArs(siteConfig.deliveryMinPurchase)} y el envío es gratis en pedidos desde ${formatArs(siteConfig.deliveryFreeThreshold)}. También podés retirar en el local sin costo.`,
  },
  {
    question: '¿Cómo se paga?',
    answer:
      'El pedido se hace desde la web y se abona por transferencia bancaria. Después nos mandás el comprobante por WhatsApp y preparamos la compra.',
  },
  {
    question: '¿Se puede comprar por gramo o hay que llevar por kilo?',
    answer:
      'Podés elegir la cantidad exacta: hay productos por kilo, por gramo y por unidad, y en el carrito ajustás la cantidad que querés de cada uno.',
  },
];

async function getProducts(): Promise<Product[]> {
  try {
    return await getCachedProducts();
  } catch (error) {
    // Si la base falla, la tienda igual carga y el cliente reintenta por /api/products.
    console.error('Error al cargar productos para el render del servidor:', error);
    return [];
  }
}

function buildStructuredData(products: Product[]) {
  const storeId = `${siteConfig.siteUrl}/#tienda`;

  const groceryStore = {
    '@type': 'GroceryStore',
    '@id': storeId,
    name: siteConfig.storeName,
    description:
      'Verdulería y frutería de barrio en Córdoba Capital. Frutas, verduras y productos de almacén por kilo, gramo o unidad, con retiro en el local y envío a domicilio.',
    url: siteConfig.siteUrl,
    image: `${siteConfig.siteUrl}/opengraph-image`,
    telephone: `+${siteConfig.whatsappNumber}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: siteConfig.storeAddress,
      addressLocality: 'Córdoba',
      addressRegion: 'Córdoba',
      postalCode: '5000',
      addressCountry: 'AR',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: STORE_GEO.latitude,
      longitude: STORE_GEO.longitude,
    },
    openingHoursSpecification: OPENING_HOURS,
    areaServed: [
      { '@type': 'City', name: 'Córdoba' },
      { '@type': 'Place', name: siteConfig.storeNeighborhood },
    ],
    priceRange: '$$',
    currenciesAccepted: 'ARS',
    paymentAccepted: 'Transferencia bancaria, Efectivo',
    hasMap: 'https://maps.google.com/?cid=899078826367002557',
  };

  // Catálogo con los productos reales: es lo que permite que un buscador o un
  // asistente responda "¿a cuánto está el tomate en El Pampa?".
  const offerCatalog = products.length > 0
    ? {
        '@type': 'OfferCatalog',
        '@id': `${siteConfig.siteUrl}/#catalogo`,
        name: `Productos de ${siteConfig.storeName}`,
        numberOfItems: products.length,
        itemListElement: products.map((product, index) => ({
          '@type': 'Offer',
          position: index + 1,
          price: product.price,
          priceCurrency: 'ARS',
          availability: product.available
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          eligibleQuantity: {
            '@type': 'QuantitativeValue',
            unitText: PRODUCT_UNIT_LABELS[product.unit],
          },
          itemOffered: {
            '@type': 'Product',
            name: product.name,
            category: product.category,
            ...(product.image ? { image: product.image } : {}),
          },
          seller: { '@id': storeId },
        })),
      }
    : null;

  const faqPage = {
    '@type': 'FAQPage',
    '@id': `${siteConfig.siteUrl}/#preguntas`,
    mainEntity: FAQ_ENTRIES.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };

  const website = {
    '@type': 'WebSite',
    '@id': `${siteConfig.siteUrl}/#sitio`,
    url: siteConfig.siteUrl,
    name: siteConfig.storeName,
    inLanguage: 'es-AR',
    publisher: { '@id': storeId },
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [groceryStore, website, faqPage, ...(offerCatalog ? [offerCatalog] : [])],
  };
}

export default async function Page() {
  const products = await getProducts();
  const structuredData = buildStructuredData(products);

  return (
    <>
      {/*
        Sin nonce a propósito: `application/ld+json` es un bloque de datos, no
        JavaScript ejecutable, así que la CSP no lo bloquea. Ponerle el nonce
        además rompía la hidratación, porque React no lo serializa al cliente
        y quedaba nonce="" contra el del servidor.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <StorefrontPage initialProducts={products} infoSection={<InfoSection />} />
    </>
  );
}

/**
 * Sección visible de "sobre el local" + preguntas frecuentes.
 *
 * Es contenido real para el cliente, no texto escondido para posicionar: ocultarlo
 * sería cloaking y además es justo el texto que un asistente cita cuando le
 * preguntan por horarios, envíos o formas de pago.
 */
function InfoSection() {
  return (
    <section className="info-section" id="informacion">
      <h2><i className="fa-solid fa-circle-info" /> Sobre {siteConfig.storeName}</h2>
      <p>
        {siteConfig.storeName} es una verdulería y frutería en {siteConfig.storeAddress},
        {' '}{siteConfig.storeNeighborhood}, Córdoba Capital. Vendemos frutas, verduras y productos
        de almacén frescos, que podés comprar por kilo, por gramo o por unidad.
      </p>
      <p>
        Hacemos envíos a domicilio en Córdoba Capital coordinados por {siteConfig.deliveryProviderName},
        con un pedido mínimo de {formatArs(siteConfig.deliveryMinPurchase)} para envío, y{' '}
        <strong>envío gratis en pedidos desde {formatArs(siteConfig.deliveryFreeThreshold)}</strong>. También
        podés retirar en el local sin costo. Los pedidos se abonan por transferencia y nos mandás el
        comprobante por WhatsApp.
      </p>

      <h3>Preguntas frecuentes</h3>
      <dl className="faq-list">
        {FAQ_ENTRIES.map((entry) => (
          <div className="faq-item" key={entry.question}>
            <dt>{entry.question}</dt>
            <dd>{entry.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
