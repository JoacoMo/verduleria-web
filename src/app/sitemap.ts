import type { MetadataRoute } from 'next';
import { siteConfig } from '@/lib/site';
import { getCachedProducts } from '@/lib/products';
import type { ProductCategory } from '@/lib/product-categories';
import type { Product } from '@/lib/types';

// Se regenera como mucho una vez por hora (y antes si el panel toca productos,
// porque getCachedProducts está atado al tag que invalida el panel).
export const revalidate = 3600;

/**
 * Fecha de la última revisión de los textos legales y de envíos. Se actualiza a
 * mano cuando cambia su contenido: poner `new Date()` le decía a Google que
 * cambiaban todos los días, y deja de creerle al sitemap.
 */
const STATIC_PAGES_LAST_MODIFIED = new Date('2026-10-05T00:00:00-03:00');

type CatalogRoute = {
  path: string;
  /** Qué productos se muestran en esa página (null = todos). */
  matches: ((product: Product) => boolean) | null;
  changeFrequency: 'daily' | 'weekly';
  priority: number;
};

const inCategory = (category: ProductCategory) => (product: Product) => product.category === category;

const CATALOG_ROUTES: CatalogRoute[] = [
  { path: '', matches: null, changeFrequency: 'daily', priority: 1 },
  { path: '/bolsones', matches: inCategory('Bolsones'), changeFrequency: 'weekly', priority: 0.8 },
  // La página de ofertas muestra la categoría y cualquier producto con precio de oferta.
  { path: '/ofertas', matches: (product) => product.category === 'Ofertas' || product.offerPrice !== null, changeFrequency: 'daily', priority: 0.8 },
  { path: '/frutas', matches: inCategory('Frutas'), changeFrequency: 'weekly', priority: 0.7 },
  { path: '/verduras', matches: inCategory('Verduras'), changeFrequency: 'weekly', priority: 0.7 },
];

const STATIC_ROUTES = [
  { path: '/envios', priority: 0.6 },
  { path: '/terminos', priority: 0.3 },
  { path: '/privacidad', priority: 0.3 },
];

function latestUpdate(products: Product[]) {
  let latest = 0;
  for (const product of products) {
    const time = product.updatedAt ? Date.parse(product.updatedAt) : Number.NaN;
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  return latest > 0 ? new Date(latest) : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let products: Product[] = [];
  try {
    products = await getCachedProducts();
  } catch (error) {
    // Sin base igual se publica el sitemap, solo que sin fecha en el catálogo
    // (mejor sin fecha que con una inventada).
    console.error('Error al cargar productos para el sitemap:', error);
  }

  const overall = latestUpdate(products);

  const catalog = CATALOG_ROUTES.map(({ path, matches, changeFrequency, priority }) => ({
    url: `${siteConfig.siteUrl}${path}`,
    // La fecha real de la página es la del último producto que cambió en ella;
    // si la categoría está vacía, la del catálogo en general.
    lastModified: (matches ? latestUpdate(products.filter(matches)) : undefined) ?? overall,
    changeFrequency,
    priority,
  }));

  const statics = STATIC_ROUTES.map(({ path, priority }) => ({
    url: `${siteConfig.siteUrl}${path}`,
    lastModified: STATIC_PAGES_LAST_MODIFIED,
    changeFrequency: 'monthly' as const,
    priority,
  }));

  return [...catalog, ...statics];
}
