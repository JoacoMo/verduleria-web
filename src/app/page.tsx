import type { Metadata } from 'next';
import StorefrontPage from '@/components/storefront-page';
import { getCatalogForRender } from '@/components/category-landing';
import { HomeInfoSection, getHomeFaqEntries } from '@/components/info-section';
import { getPublicStoreInfo, siteConfig } from '@/lib/site';
import { formatArs } from '@/lib/format-price';
import {
  buildFaqJsonLd,
  buildOfferCatalogJsonLd,
  buildPageMetadata,
  buildProductOffers,
  buildStoreJsonLd,
  buildWebsiteJsonLd,
  getDeliveryScheduleText,
  jsonLdGraph,
  jsonLdScriptProps,
} from '@/lib/seo';

// La página se renderiza en el servidor en cada visita (no es estática) porque la
// CSP con nonce necesita un valor distinto por request, y el nonce se lee de las
// cabeceras. El HTML sigue llegando con los productos ya incluidos, que es lo que
// necesitan los buscadores y los crawlers de IA.
//
// Costo: cada visita ejecuta una función, pero el catálogo sale de la caché de
// getCachedProducts (como mucho una consulta a la base por minuto). Si algún día
// molesta, la alternativa es volver a 'unsafe-inline' en script-src (CSP más débil).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildPageMetadata({
  title: `${siteConfig.storeName} | Verdulería y frutería a domicilio en Córdoba`,
  absoluteTitle: true,
  description: `Verdulería y frutería en ${siteConfig.storeNeighborhood}, Córdoba Capital. Frutas, verduras y bolsones por kilo o unidad, con envíos ${getDeliveryScheduleText().weekdays}, gratis desde ${formatArs(siteConfig.deliveryFreeThreshold)}.`,
  path: '/',
});

export default async function Page() {
  const products = await getCatalogForRender();
  const now = new Date();
  const faq = getHomeFaqEntries();

  // El local con todo su catálogo (precios de hoy), el sitio y las preguntas
  // frecuentes que se ven al pie de la página.
  const structuredData = jsonLdGraph([
    buildStoreJsonLd(
      products.length > 0
        ? {
            catalog: buildOfferCatalogJsonLd({
              path: '/',
              name: `Productos de ${siteConfig.storeName}`,
              offers: buildProductOffers(products, now),
            }),
          }
        : {},
    ),
    buildWebsiteJsonLd(),
    buildFaqJsonLd(faq),
  ]);

  return (
    <>
      <script {...jsonLdScriptProps(structuredData)} />
      <StorefrontPage
        initialProducts={products}
        storeInfo={getPublicStoreInfo()}
        infoSection={<HomeInfoSection faq={faq} />}
        renderedAt={now.getTime()}
      />
    </>
  );
}
