import CategoryLanding, { buildCategoryMetadata, type CategoryLandingConfig } from '@/components/category-landing';
import { siteConfig } from '@/lib/site';
import { getDeliveryScheduleText } from '@/lib/seo';

// Por request, como toda la app: lo exige la CSP con nonce (ver layout.tsx).
export const dynamic = 'force-dynamic';

const PAGE: CategoryLandingConfig = {
  path: '/verduras',
  category: 'Verduras',
  title: 'Verduras frescas a domicilio en Córdoba',
  description: `Verduras frescas en ${siteConfig.storeName}, verdulería de ${siteConfig.storeNeighborhood}, Córdoba Capital. Por kilo, gramo, unidad o atado, con retiro en el local o envío ${getDeliveryScheduleText().weekdays}.`,
  heading: {
    title: 'Verduras frescas',
    subtitle: 'Por kilo, por gramo, por unidad o por atado. Retiralas en el local o recibilas en tu casa en el turno que elijas.',
  },
  breadcrumbName: 'Verduras',
  sectionTitle: 'Cómo comprar verdura',
  emptyText: 'En este momento no hay verduras cargadas en la tienda. Escribinos por WhatsApp y te contamos qué hay hoy.',
};

export const metadata = buildCategoryMetadata(PAGE);

export default function VerdurasPage() {
  return (
    <CategoryLanding config={PAGE}>
      <p>
        Cada verdura se vende como corresponde: lo que va por peso, por kilo o por gramos (por ejemplo, 300 g o 2 kg), y
        el resto por unidad, por atado o por bandeja. En la tarjeta de cada producto figura cómo se vende, y en el carrito
        ajustás la cantidad.
      </p>
      <p>
        En lo que va por peso el total es estimado: cuando armamos el pedido pesamos todo y te mandamos el total final
        por WhatsApp. El precio por kilo no cambia, lo que varía es el peso. Si algo falta o no está en condiciones,
        hacemos lo que elegiste al pedir: reemplazarlo por uno similar, sacarlo o escribirte antes.
      </p>
    </CategoryLanding>
  );
}
