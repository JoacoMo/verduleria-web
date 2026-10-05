import CategoryLanding, { buildCategoryMetadata, type CategoryLandingConfig } from '@/components/category-landing';
import { siteConfig } from '@/lib/site';
import { formatArs } from '@/lib/format-price';

// Por request, como toda la app: lo exige la CSP con nonce (ver layout.tsx).
export const dynamic = 'force-dynamic';

const PAGE: CategoryLandingConfig = {
  path: '/bolsones',
  category: 'Bolsones',
  title: 'Bolsones de frutas y verduras en Córdoba',
  description: `Bolsones de frutas y verduras armados por ${siteConfig.storeName}, verdulería de ${siteConfig.storeNeighborhood}. Precio por bolsón, con retiro en el local o envío en Córdoba Capital, gratis desde ${formatArs(siteConfig.deliveryFreeThreshold)}.`,
  heading: {
    title: 'Bolsones de frutas y verduras',
    subtitle: 'Armados en el local, con precio por bolsón. En cada uno figura qué trae, y los podés sumar a tu pedido junto con cualquier otro producto.',
  },
  breadcrumbName: 'Bolsones',
  sectionTitle: 'Cómo funcionan los bolsones',
  emptyText: 'En este momento no hay bolsones cargados. Mientras tanto podés armar tu pedido con frutas y verduras sueltas.',
};

export const metadata = buildCategoryMetadata(PAGE);

export default function BolsonesPage() {
  return (
    <CategoryLanding config={PAGE}>
      <p>
        Un bolsón es una selección de frutas y verduras que armamos nosotros, con un precio por bolsón. Lo que trae cada
        uno está detallado en su tarjeta, así sabés de antemano qué te llega y no tenés que elegir producto por producto.
      </p>
      <p>
        Lo podés pedir solo o sumarle lo que quieras de la tienda en el mismo pedido. Si al armarlo falta algún producto,
        hacemos lo que elegiste al pedir: reemplazarlo por uno similar, sacarlo o escribirte antes.
      </p>
    </CategoryLanding>
  );
}
