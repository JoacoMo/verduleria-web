import CategoryLanding, { buildCategoryMetadata, type CategoryLandingConfig } from '@/components/category-landing';
import { siteConfig } from '@/lib/site';
import { getDeliveryScheduleText } from '@/lib/seo';

// Por request, como toda la app: lo exige la CSP con nonce (ver layout.tsx).
export const dynamic = 'force-dynamic';

const PAGE: CategoryLandingConfig = {
  path: '/frutas',
  category: 'Frutas',
  title: 'Frutas frescas a domicilio en Córdoba',
  description: `Frutas frescas en ${siteConfig.storeName}, frutería de ${siteConfig.storeNeighborhood}, Córdoba Capital. Pedí por kilo, gramo o unidad y retirá en el local o recibilas en tu casa ${getDeliveryScheduleText().weekdays}.`,
  heading: {
    title: 'Frutas frescas',
    subtitle: 'Por kilo, por gramo o por unidad. Retiralas en el local o recibilas en tu casa en el turno que elijas.',
  },
  breadcrumbName: 'Frutas',
  sectionTitle: 'Cómo comprar fruta',
  emptyText: 'En este momento no hay frutas cargadas en la tienda. Escribinos por WhatsApp y te contamos qué hay hoy.',
};

export const metadata = buildCategoryMetadata(PAGE);

export default function FrutasPage() {
  return (
    <CategoryLanding config={PAGE}>
      <p>
        Lo que va por peso lo podés pedir por kilo o por gramos (por ejemplo, 500 g o 1,5 kg): en el carrito ajustás la
        cantidad exacta. En la tarjeta de cada fruta figura cómo se vende.
      </p>
      <p>
        Como cada fruta pesa distinto, en lo que va por peso el total es estimado: cuando armamos el pedido pesamos todo y
        te mandamos el total final por WhatsApp. El precio por kilo no cambia, lo que varía es el peso. Si alguna fruta
        falta o no está en condiciones, hacemos lo que elegiste al pedir: reemplazarla por una similar, sacarla o
        escribirte antes.
      </p>
    </CategoryLanding>
  );
}
