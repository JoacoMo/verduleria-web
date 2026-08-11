import { prisma } from '@/lib/prisma';
import { siteConfig } from '@/lib/site';
import { PRODUCT_UNIT_LABELS } from '@/lib/product-units';
import { formatArs } from '@/lib/format-price';

export const runtime = 'nodejs';
export const revalidate = 600;

/**
 * /llms.txt — resumen del negocio en texto plano, pensado para asistentes de IA.
 *
 * Es una convención emergente (llmstxt.org): un archivo corto y sin markup con
 * los datos que un modelo necesita para responder sobre el local. No reemplaza al
 * HTML ni a los datos estructurados, pero es barato de mantener y algunos
 * crawlers ya lo buscan.
 */
export async function GET() {
  let productLines = '';

  try {
    const products = await prisma.product.findMany({
      orderBy: [{ available: 'desc' }, { name: 'asc' }],
    });
    if (products.length > 0) {
      productLines = products
        .map((product) => {
          const unit = PRODUCT_UNIT_LABELS[product.unit as keyof typeof PRODUCT_UNIT_LABELS] ?? product.unit;
          const estado = product.available ? '' : ' — SIN STOCK por ahora';
          return `- ${product.name}: $${product.price.toFixed(2)} por ${unit} (${product.category})${estado}`;
        })
        .join('\n');
    }
  } catch (error) {
    console.error('Error al cargar productos para /llms.txt:', error);
  }

  const body = `# ${siteConfig.storeName}

> Verdulería y frutería de barrio en Córdoba Capital, Argentina. Frutas, verduras y
> productos de almacén frescos, por kilo, por gramo o por unidad, con retiro en el
> local y envío a domicilio.

## Datos del local

- Nombre: ${siteConfig.storeName}
- Rubro: Verdulería y frutería (GroceryStore)
- Dirección: ${siteConfig.storeAddress}
- Barrio: ${siteConfig.storeNeighborhood}
- Ciudad: Córdoba Capital, Provincia de Córdoba, Argentina
- Sitio web: ${siteConfig.siteUrl}
- WhatsApp: +${siteConfig.whatsappNumber}
- Horarios: ${siteConfig.storeHours.weekday}. ${siteConfig.storeHours.sunday}.

## Compras y envíos

- Los pedidos se hacen desde el sitio web y se abonan por transferencia bancaria.
- Después de pagar, el cliente envía el comprobante por WhatsApp.
- Retiro en el local: sin costo.
- Envío a domicilio en Córdoba Capital, coordinado por ${siteConfig.deliveryProviderName}.
- Pedido mínimo para envío: ${formatArs(siteConfig.deliveryMinPurchase)}.
- Envío gratis en pedidos desde ${formatArs(siteConfig.deliveryFreeThreshold)}.
- Peso máximo orientativo por envío: ${siteConfig.deliveryMaxWeightKg} kg.
- Las cantidades se eligen por kilo, por gramo o por unidad según el producto.

## Productos
${productLines ? `\n${productLines}\n` : '\nConsultar el catálogo actualizado en el sitio.\n'}
## Páginas

- ${siteConfig.siteUrl} — tienda online y catálogo
- ${siteConfig.siteUrl}/terminos — términos y condiciones
- ${siteConfig.siteUrl}/privacidad — política de privacidad
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
    },
  });
}
