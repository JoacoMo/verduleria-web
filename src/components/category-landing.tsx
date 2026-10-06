import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Apple, Carrot, ShoppingBasket, Tag } from 'lucide-react';
import StorefrontPage from '@/components/storefront-page';
import { DeliveryParagraph, InfoLinks } from '@/components/info-section';
import { getCachedProducts } from '@/lib/products';
import { getPublicStoreInfo, siteConfig } from '@/lib/site';
import { getDiscountPercent, isOfferActive } from '@/lib/pricing';
import { PRODUCT_UNITS, type ProductUnit } from '@/lib/product-units';
import {
  buildBreadcrumbs,
  buildOfferCatalogJsonLd,
  buildPageMetadata,
  buildProductOffers,
  buildStoreJsonLd,
  buildWebPageJsonLd,
  buildWebsiteJsonLd,
  catalogIdFor,
  jsonLdGraph,
  jsonLdScriptProps,
  matchesCategoryPage,
  type CategoryPagePath,
} from '@/lib/seo';
import type { Product } from '@/lib/types';

/**
 * Páginas de categoría (/bolsones, /ofertas, /frutas, /verduras).
 *
 * Son la misma tienda que la home, con el filtro ya puesto y un h1 propio: así
 * alguien que busca "bolsones de verdura en Córdoba" llega a una página que
 * habla de eso, y puede comprar ahí mismo o pasar a cualquier otra categoría.
 * Cada una suma un texto propio (qué hay, cómo se vende, envíos) y su catálogo
 * en JSON-LD con los productos de esa categoría.
 */

/**
 * Catálogo para el render del servidor. Si la base falla, la página carga igual
 * sin productos (la tienda muestra el aviso de catálogo vacío): nunca con
 * productos inventados.
 */
export async function getCatalogForRender(): Promise<Product[]> {
  try {
    return await getCachedProducts();
  } catch (error) {
    console.error('Error al cargar productos para el render del servidor:', error);
    return [];
  }
}

type LandingCategory = 'Bolsones' | 'Ofertas' | 'Frutas' | 'Verduras';

export type CategoryLandingConfig = {
  path: CategoryPagePath;
  category: LandingCategory;
  /** <title> sin la marca (el layout le agrega " | El Pampa"). */
  title: string;
  /** Meta description: 150-160 caracteres, con lo que busca la gente. */
  description: string;
  /** h1 y bajada que muestra la tienda arriba de todo. */
  heading: { title: string; subtitle: string };
  /** Nombre en las migas de pan ("Inicio > Bolsones"). */
  breadcrumbName: string;
  /** Título de la sección de texto que va después del catálogo. */
  sectionTitle: string;
  /** Qué decir cuando la categoría está vacía. */
  emptyText: string;
};

export function buildCategoryMetadata(config: CategoryLandingConfig): Metadata {
  return buildPageMetadata({ title: config.title, description: config.description, path: config.path });
}

const SECTION_ICONS: Record<LandingCategory, typeof Apple> = {
  Bolsones: ShoppingBasket,
  Ofertas: Tag,
  Frutas: Apple,
  Verduras: Carrot,
};

const UNIT_PHRASES: Record<ProductUnit, string> = {
  kg: 'por kilo',
  g: 'por gramo',
  unidad: 'por unidad',
  atado: 'por atado',
  bandeja: 'por bandeja',
};

/** ["a", "b", "c"] → "a, b y c". */
function joinList(items: string[]) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Resumen con los datos reales de la categoría: cuántos productos hay hoy y
 * cómo se venden (o el descuento máximo, en ofertas). Sale de la base, así que
 * nunca promete algo que no está.
 */
function describeCatalog(config: CategoryLandingConfig, products: Product[], now: Date) {
  if (products.length === 0) return config.emptyText;

  const inStock = products.filter((product) => product.available);
  if (inStock.length === 0) {
    return `En este momento no hay ${config.breadcrumbName.toLowerCase()} con stock. Volvé a fijarte pronto o escribinos por WhatsApp.`;
  }

  const unavailable = products.length - inStock.length;
  let outOfStock = '';
  if (unavailable === 1) outOfStock = ' (y otro sin stock por el momento)';
  if (unavailable > 1) outOfStock = ` (y otros ${unavailable} sin stock por el momento)`;

  if (config.category === 'Ofertas') {
    // La categoría vieja "Ofertas" puede tener productos sin precio de oferta:
    // el descuento se calcula solo sobre los que tienen uno vigente.
    const discounts = inStock.filter((product) => isOfferActive(product, now)).map((product) => getDiscountPercent(product, now));
    const maxDiscount = Math.max(0, ...discounts);
    const discount = maxDiscount > 0 ? `, con descuentos de hasta ${maxDiscount}%` : '';
    return `Ahora hay ${pluralize(inStock.length, 'producto', 'productos')} en oferta${discount}${outOfStock}.`;
  }

  const [singular, plural] = config.category === 'Bolsones'
    ? ['bolsón disponible', 'bolsones disponibles']
    : ['producto disponible', 'productos disponibles'];
  const base = `Ahora hay ${pluralize(inStock.length, singular, plural)}${outOfStock}`;
  if (config.category === 'Bolsones') return `${base}.`;

  const units = PRODUCT_UNITS.filter((unit) => inStock.some((product) => product.unit === unit));
  return `${base}, que se venden ${joinList(units.map((unit) => UNIT_PHRASES[unit]))}.`;
}

type CategoryLandingProps = {
  config: CategoryLandingConfig;
  /** Texto propio de la categoría (párrafos). */
  children: ReactNode;
};

export default async function CategoryLanding({ config, children }: CategoryLandingProps) {
  const products = await getCatalogForRender();
  const now = new Date();
  const inCategory = products.filter((product) => matchesCategoryPage(product, config.category, now));
  const Icon = SECTION_ICONS[config.category];

  const catalog = buildOfferCatalogJsonLd({
    path: config.path,
    name: `${config.breadcrumbName} de ${siteConfig.storeName}`,
    offers: buildProductOffers(inCategory, now),
  });

  const structuredData = jsonLdGraph([
    buildStoreJsonLd({ catalog }),
    buildWebsiteJsonLd(),
    buildBreadcrumbs([
      { name: 'Inicio', path: '/' },
      { name: config.breadcrumbName, path: config.path },
    ]),
    buildWebPageJsonLd({
      type: 'CollectionPage',
      path: config.path,
      name: config.heading.title,
      description: config.description,
      hasBreadcrumb: true,
      mainEntity: { '@id': catalogIdFor(config.path) },
    }),
  ]);

  const infoSection = (
    <section className="info-section" id="sobre-esta-seccion">
      <h2><Icon size={30} aria-hidden="true" /> {config.sectionTitle}</h2>
      <p><strong>{describeCatalog(config, inCategory, now)}</strong></p>
      {children}
      <DeliveryParagraph />
      <InfoLinks current={config.path} />
    </section>
  );

  return (
    <>
      <script {...jsonLdScriptProps(structuredData)} />
      <StorefrontPage
        initialProducts={products}
        storeInfo={getPublicStoreInfo()}
        initialCategory={config.category}
        heading={config.heading}
        infoSection={infoSection}
        renderedAt={now.getTime()}
      />
    </>
  );
}
