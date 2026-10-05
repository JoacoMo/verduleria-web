import 'server-only';
import type { Metadata } from 'next';
import { siteConfig } from './site';
import { getEffectivePrice, isOfferActive } from './pricing';
import { PRODUCT_UNIT_CODES } from './product-units';
import type { ProductCategory } from './product-categories';
import { DELIVERY_WINDOWS, SLOT_ORDER_LEAD_MINUTES } from './delivery-slots';
import { OPENING_WINDOWS, formatMinutes, getArgentinaParts, getOpeningHoursSpecification } from './store-hours';
import type { Product } from './types';

/**
 * Metadata y datos estructurados (JSON-LD) del sitio, en un solo lugar.
 *
 * Todo sale de siteConfig, store-hours, delivery-slots y pricing: si cambia un
 * horario, el costo del envío o un precio, cambian solos el HTML, el JSON-LD y
 * las respuestas que dan los buscadores y asistentes. Regla: nada de datos
 * inventados (ni ratings, ni reseñas, ni stock que no sea el de la base).
 *
 * Solo servidor: lee siteConfig, que viene de variables de entorno.
 */

// ---------------------------------------------------------------------------
// URLs e identificadores
// ---------------------------------------------------------------------------

/** URL absoluta de una ruta del sitio. La home termina en "/", como la canónica que arma Next. */
export function absoluteUrl(path: string) {
  if (path === '/' || path === '') return `${siteConfig.siteUrl}/`;
  return `${siteConfig.siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * @id de los nodos que se referencian entre sí. Se mantienen estables entre
 * deploys: Google arma el grafo del negocio juntando nodos con el mismo @id.
 */
export const JSON_LD_IDS = {
  store: `${siteConfig.siteUrl}/#tienda`,
  website: `${siteConfig.siteUrl}/#sitio`,
  homeFaq: `${siteConfig.siteUrl}/#preguntas`,
  homeCatalog: `${siteConfig.siteUrl}/#catalogo`,
};

function pageNodeId(path: string) {
  return `${absoluteUrl(path)}#pagina`;
}

function breadcrumbId(path: string) {
  return `${absoluteUrl(path)}#migas`;
}

export function catalogIdFor(path: string) {
  return path === '/' ? JSON_LD_IDS.homeCatalog : `${absoluteUrl(path)}#catalogo`;
}

// ---------------------------------------------------------------------------
// Datos del local derivados de la configuración
// ---------------------------------------------------------------------------

/** Coordenadas del local (las mismas que usa el mapa embebido). */
export const STORE_GEO = { latitude: -31.415961, longitude: -64.168769 };

const GOOGLE_MAPS_URL = 'https://maps.google.com/?cid=899078826367002557';

/** "Rosario de Santa Fe 1211": el primer tramo de STORE_ADDRESS, para PostalAddress.streetAddress. */
export function getStreetAddress() {
  return siteConfig.storeAddress.split(',')[0]?.trim() || siteConfig.storeAddress;
}

/**
 * Dirección para mostrar, con barrio y ciudad aunque STORE_ADDRESS traiga solo
 * la calle (el valor por defecto ya los trae y no se repiten).
 */
export function getFullAddress() {
  const address = siteConfig.storeAddress.trim();
  const lower = address.toLowerCase();
  const parts = [address];
  if (siteConfig.storeNeighborhood && !lower.includes(siteConfig.storeNeighborhood.toLowerCase())) {
    parts.push(siteConfig.storeNeighborhood);
  }
  if (!lower.includes('córdoba') && !lower.includes('cordoba')) parts.push('Córdoba Capital');
  return parts.join(', ');
}

function hourText(minutes: number) {
  return minutes % 60 === 0 ? String(minutes / 60) : formatMinutes(minutes);
}

type DeliveryWindow = (typeof DELIVERY_WINDOWS)[number];

function windowText({ start, end }: DeliveryWindow) {
  return `de ${hourText(start)} a ${hourText(end)} h`;
}

/** "de 13 a 14 h y de 19 a 20 h". */
function windowsText(windows: DeliveryWindow[]) {
  return windows.map(windowText).join(' y ');
}

/**
 * Turnos que entran en el horario de atención de un día. Es el mismo criterio
 * que usa getUpcomingSlots: así el domingo (que se cierra a las 14) queda solo
 * con el turno del mediodía sin tener que escribirlo a mano.
 */
function windowsForDay(dayIndex: number) {
  const opening = OPENING_WINDOWS[dayIndex] ?? [];
  return DELIVERY_WINDOWS.filter(({ start, end }) => opening.some(([open, close]) => start >= open && end <= close));
}

export type DeliveryScheduleText = {
  /** Turnos de lunes a sábado: "de 13 a 14 h y de 19 a 20 h". */
  weekdays: string;
  /** Turnos del domingo ("de 13 a 14 h"), o null si ese día no hay envíos. */
  sunday: string | null;
  /** Frase completa: "De lunes a sábado, de 13 a 14 h y de 19 a 20 h. Los domingos, solo de 13 a 14 h." */
  summary: string;
  /** Hasta qué hora se puede pedir para cada turno: "para el de 13 a 14 h, hasta las 12:00". */
  deadlines: string;
};

export function getDeliveryScheduleText(): DeliveryScheduleText {
  // Lunes a sábado comparten horario (store-hours.ts los define igual): se toma el lunes.
  const weekdayWindows = windowsForDay(1);
  const sundayWindows = windowsForDay(0);
  const weekdays = windowsText(weekdayWindows);
  const sunday = sundayWindows.length > 0 ? windowsText(sundayWindows) : null;

  let summary: string;
  if (sunday === weekdays) {
    summary = `Todos los días, ${weekdays}.`;
  } else if (sunday) {
    summary = `De lunes a sábado, ${weekdays}. Los domingos, solo ${sunday}.`;
  } else {
    summary = `De lunes a sábado, ${weekdays}. Los domingos no hay envíos.`;
  }

  const deadlines = DELIVERY_WINDOWS
    .map((window) => `para el ${windowText(window)}, hasta las ${formatMinutes(window.start - SLOT_ORDER_LEAD_MINUTES)}`)
    .join(', y ');

  return { weekdays, sunday, summary, deadlines };
}

/** "1 hora", "2 horas" o "90 minutos". */
export function getLeadTimeText() {
  if (SLOT_ORDER_LEAD_MINUTES % 60 !== 0) return `${SLOT_ORDER_LEAD_MINUTES} minutos`;
  const hours = SLOT_ORDER_LEAD_MINUTES / 60;
  return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
}

// ---------------------------------------------------------------------------
// Páginas de categoría
// ---------------------------------------------------------------------------

export type CategoryPagePath = '/bolsones' | '/ofertas' | '/frutas' | '/verduras';

/** Páginas de categoría que existen (Almacén no tiene página propia: se ve en la home). */
export const CATEGORY_PAGES: Array<{ path: CategoryPagePath; category: ProductCategory; name: string }> = [
  { path: '/bolsones', category: 'Bolsones', name: 'Bolsones' },
  { path: '/ofertas', category: 'Ofertas', name: 'Ofertas' },
  { path: '/frutas', category: 'Frutas', name: 'Frutas' },
  { path: '/verduras', category: 'Verduras', name: 'Verduras' },
];

/**
 * Qué productos muestra una página de categoría. "Ofertas" es la categoría vieja
 * más cualquier producto con oferta vigente (el mismo criterio que el filtro de
 * la tienda).
 */
export function matchesCategoryPage(product: Product, category: ProductCategory, now: Date = new Date()) {
  if (category === 'Ofertas') return product.category === 'Ofertas' || isOfferActive(product, now);
  return product.category === category;
}

/** Página donde se ve un producto: la de su categoría si existe, si no la home. */
function pageUrlFor(product: Product) {
  const page = CATEGORY_PAGES.find((entry) => entry.category === product.category);
  return absoluteUrl(page ? page.path : '/');
}

// ---------------------------------------------------------------------------
// Metadata de Next
// ---------------------------------------------------------------------------

/**
 * Imagen para redes (src/app/opengraph-image.tsx). Se declara explícita porque
 * cuando una página define su propio openGraph, Next deja de heredar la imagen
 * del archivo de la raíz y el link compartido salía sin foto.
 */
export const OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: `${siteConfig.storeName}, verdulería y frutería en ${siteConfig.storeNeighborhood}, Córdoba`,
};

type PageMetadataInput = {
  /** Título de la página. Se le agrega " | El Pampa" salvo que absoluteTitle sea true. */
  title: string;
  description: string;
  /** Ruta canónica ("/bolsones"). */
  path: string;
  absoluteTitle?: boolean;
};

/**
 * Metadata de una página pública: título, descripción, canónica y openGraph
 * completos. Twitter no se define acá: Next lo completa con estos mismos datos.
 */
export function buildPageMetadata({ title, description, path, absoluteTitle = false }: PageMetadataInput): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} | ${siteConfig.storeName}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName: siteConfig.storeName,
      locale: 'es_AR',
      type: 'website',
      images: [OG_IMAGE],
    },
  };
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

type JsonLdNode = Record<string, unknown>;

/**
 * JSON.stringify no escapa `<`: un producto llamado `</script><script>...` cerraba
 * el bloque de datos y lo que seguía se interpretaba como HTML. La CSP con nonce
 * igual bloquearía el script, pero no hay por qué depender solo de eso.
 */
export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** Un único bloque con todos los nodos de la página (los null se descartan). */
export function jsonLdGraph(nodes: Array<JsonLdNode | null | undefined>) {
  return {
    '@context': 'https://schema.org',
    '@graph': nodes.filter((node): node is JsonLdNode => Boolean(node)),
  };
}

/**
 * Props para `<script {...jsonLdScriptProps(data)} />`.
 *
 * Sin nonce a propósito: `application/ld+json` es un bloque de datos, no
 * JavaScript ejecutable, así que la CSP no lo bloquea. Ponerle el nonce además
 * rompía la hidratación, porque React no lo serializa al cliente y quedaba
 * nonce="" contra el del servidor.
 */
export function jsonLdScriptProps(data: unknown) {
  return {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: { __html: serializeJsonLd(data) },
  };
}

/**
 * Foto del producto como URL absoluta, o null si es un placeholder: una imagen
 * genérica no describe el producto y Google la toma como dato del catálogo.
 */
function productImageUrl(image: string | null | undefined) {
  const value = image?.trim();
  if (!value) return null;
  if (value.includes('via.placeholder.com') || value.startsWith('/placeholder') || value.startsWith('/product-placeholder')) {
    return null;
  }
  if (value.startsWith('/')) return absoluteUrl(value);
  return /^https?:\/\//i.test(value) ? value : null;
}

/** Las descripciones de bolsones vienen de a una línea por producto: en JSON-LD van en una sola. */
function singleLine(text: string) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim().replace(/[,;.]$/, ''))
    .filter(Boolean)
    .join(', ');
}

function unitPriceSpecification(price: number, product: Product, listPrice = false) {
  return {
    '@type': 'UnitPriceSpecification',
    ...(listPrice ? { priceType: 'https://schema.org/ListPrice' } : {}),
    price,
    priceCurrency: 'ARS',
    referenceQuantity: {
      '@type': 'QuantitativeValue',
      value: 1,
      unitCode: PRODUCT_UNIT_CODES[product.unit],
    },
  };
}

/**
 * Una Offer por producto con el precio que se cobra hoy (con la oferta si está
 * vigente). El precio es por unidad de venta, así que va con
 * UnitPriceSpecification: "$ 800 por kilo" y no "$ 800" a secas. Con oferta
 * vigente se agrega el precio normal como ListPrice (el tachado).
 */
export function buildProductOffers(products: Product[], now: Date = new Date()) {
  return products.map((product) => {
    const price = getEffectivePrice(product, now);
    const onOffer = isOfferActive(product, now);
    const image = productImageUrl(product.image);
    const description = product.description ? singleLine(product.description) : '';

    return {
      '@type': 'Offer',
      price,
      priceCurrency: 'ARS',
      availability: product.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      // La oferta vence al final del día indicado, hora argentina: esa es la fecha.
      ...(onOffer && product.offerEndsAt
        ? { priceValidUntil: getArgentinaParts(new Date(product.offerEndsAt)).date }
        : {}),
      priceSpecification: onOffer
        ? [unitPriceSpecification(price, product), unitPriceSpecification(product.price, product, true)]
        : unitPriceSpecification(price, product),
      url: pageUrlFor(product),
      itemOffered: {
        '@type': 'Product',
        name: product.name,
        category: product.category,
        ...(image ? { image } : {}),
        ...(description ? { description } : {}),
      },
      seller: { '@id': JSON_LD_IDS.store },
    };
  });
}

type OfferCatalogInput = {
  /** Ruta de la página que muestra el catálogo ("/" para la home). */
  path: string;
  name: string;
  offers: ReturnType<typeof buildProductOffers>;
};

/** Catálogo con los precios reales: lo que permite responder "¿a cuánto está el tomate en El Pampa?". */
export function buildOfferCatalogJsonLd({ path, name, offers }: OfferCatalogInput) {
  return {
    '@type': 'OfferCatalog',
    '@id': catalogIdFor(path),
    name,
    url: absoluteUrl(path),
    numberOfItems: offers.length,
    itemListElement: offers,
  };
}

/**
 * Catálogo por defecto del local: las páginas de categoría, sin productos (los
 * productos van en la página de cada una, con el mismo @id).
 */
function categoriesCatalog() {
  return {
    '@type': 'OfferCatalog',
    '@id': JSON_LD_IDS.homeCatalog,
    name: `Productos de ${siteConfig.storeName}`,
    url: absoluteUrl('/'),
    itemListElement: CATEGORY_PAGES.map((page) => ({
      '@type': 'OfferCatalog',
      '@id': catalogIdFor(page.path),
      name: page.name,
      url: absoluteUrl(page.path),
    })),
  };
}

/**
 * El local (GroceryStore). `catalog` es lo que ofrece en esa página: la home
 * pasa todos los productos y cada página de categoría los suyos; sin catálogo,
 * se listan las categorías.
 */
export function buildStoreJsonLd({ catalog }: { catalog?: JsonLdNode } = {}) {
  return {
    '@type': 'GroceryStore',
    '@id': JSON_LD_IDS.store,
    name: siteConfig.storeName,
    description:
      `Verdulería y frutería de barrio en ${siteConfig.storeNeighborhood}, Córdoba Capital. Frutas, verduras, bolsones y productos de almacén por kilo, gramo o unidad, con retiro en el local y envío a domicilio.`,
    url: absoluteUrl('/'),
    image: absoluteUrl(OG_IMAGE.url),
    telephone: `+${siteConfig.whatsappNumber}`,
    ...(siteConfig.contactEmail ? { email: siteConfig.contactEmail } : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: getStreetAddress(),
      addressLocality: 'Córdoba',
      addressRegion: 'Córdoba',
      addressCountry: 'AR',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: STORE_GEO.latitude,
      longitude: STORE_GEO.longitude,
    },
    hasMap: GOOGLE_MAPS_URL,
    openingHoursSpecification: getOpeningHoursSpecification(),
    areaServed: { '@type': 'City', name: 'Córdoba' },
    priceRange: '$$',
    currenciesAccepted: 'ARS',
    paymentAccepted: 'Efectivo, Transferencia bancaria',
    ...(siteConfig.instagramUrl ? { sameAs: [siteConfig.instagramUrl] } : {}),
    hasOfferCatalog: catalog ?? categoriesCatalog(),
  };
}

export function buildWebsiteJsonLd() {
  return {
    '@type': 'WebSite',
    '@id': JSON_LD_IDS.website,
    url: absoluteUrl('/'),
    name: siteConfig.storeName,
    inLanguage: 'es-AR',
    publisher: { '@id': JSON_LD_IDS.store },
  };
}

type WebPageInput = {
  type?: 'WebPage' | 'CollectionPage' | 'FAQPage';
  path: string;
  name: string;
  description: string;
  /** La página tiene BreadcrumbList (armada con buildBreadcrumbs). */
  hasBreadcrumb?: boolean;
  mainEntity?: unknown;
};

export function buildWebPageJsonLd({ type = 'WebPage', path, name, description, hasBreadcrumb = false, mainEntity }: WebPageInput) {
  return {
    '@type': type,
    '@id': pageNodeId(path),
    url: absoluteUrl(path),
    name,
    description,
    inLanguage: 'es-AR',
    isPartOf: { '@id': JSON_LD_IDS.website },
    about: { '@id': JSON_LD_IDS.store },
    ...(hasBreadcrumb ? { breadcrumb: { '@id': breadcrumbId(path) } } : {}),
    ...(mainEntity ? { mainEntity } : {}),
  };
}

export type FaqEntry = { question: string; answer: string };

/** Preguntas en formato schema.org. Tienen que ser las mismas que se ven en la página. */
export function buildFaqQuestions(entries: FaqEntry[]) {
  return entries.map((entry) => ({
    '@type': 'Question',
    name: entry.question,
    acceptedAnswer: { '@type': 'Answer', text: entry.answer },
  }));
}

/** FAQPage suelto (la sección de preguntas de la home). */
export function buildFaqJsonLd(entries: FaqEntry[], id: string = JSON_LD_IDS.homeFaq) {
  return {
    '@type': 'FAQPage',
    '@id': id,
    mainEntity: buildFaqQuestions(entries),
  };
}

/** Migas de pan: [{ name: 'Inicio', path: '/' }, { name: 'Bolsones', path: '/bolsones' }]. */
export function buildBreadcrumbs(items: Array<{ name: string; path: string }>) {
  const last = items[items.length - 1];
  return {
    '@type': 'BreadcrumbList',
    '@id': breadcrumbId(last?.path ?? '/'),
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}
