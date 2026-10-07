import CategoryLanding, { buildCategoryMetadata, type CategoryLandingConfig } from '@/components/category-landing';
import { siteConfig } from '@/lib/site';

// Por request, como toda la app: lo exige la CSP con nonce (ver layout.tsx).
export const dynamic = 'force-dynamic';

const PAGE: CategoryLandingConfig = {
  path: '/ofertas',
  category: 'Ofertas',
  title: 'Ofertas en frutas y verduras',
  description: `Frutas, verduras y productos de almacén con precio de oferta en ${siteConfig.storeName}, ${siteConfig.storeNeighborhood}, Córdoba. Cada oferta muestra el descuento y hasta cuándo vale.`,
  heading: {
    title: 'Ofertas de la verdulería',
    subtitle: 'Productos con precio rebajado: ves el precio normal tachado, el descuento y, si la oferta vence, hasta qué día vale.',
  },
  breadcrumbName: 'Ofertas',
  sectionTitle: 'Cómo funcionan las ofertas',
  emptyText: 'En este momento no hay ofertas vigentes. Podés mirar los bolsones, que ya vienen armados con precio por bolsón.',
};

export const metadata = buildCategoryMetadata(PAGE);

export default function OfertasPage() {
  return (
    <CategoryLanding config={PAGE}>
      <p>
        El precio de oferta es el que se cobra mientras la oferta esté vigente. Si tiene fecha de cierre, vale hasta el
        final de ese día. Si una oferta vence mientras armás el pedido, antes de confirmarlo te mostramos el precio
        nuevo: nunca se cobra un precio que no viste.
      </p>
      <p>
        En lo que va por peso, el descuento es sobre el precio por kilo (o por gramo) y el total final sale al pesar el
        pedido: te lo mandamos por WhatsApp cuando lo armamos.
      </p>
    </CategoryLanding>
  );
}
