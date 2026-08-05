import type { Metadata } from 'next';
import Link from 'next/link';
import { siteConfig } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Términos y Condiciones de Compra',
  description: `Términos y condiciones de compra de ${siteConfig.storeName}: medios de pago, entrega, cambios y devoluciones.`,
  alternates: {
    canonical: '/terminos',
  },
};

export default function TerminosPage() {
  return (
    <main className="legal-page">
      <Link href="/" className="back-link">← Volver a la tienda</Link>
      <h1>Términos y Condiciones de Compra</h1>
      <p className="legal-updated">Última actualización: 5 de agosto de 2026</p>

      <p>
        Estos Términos y Condiciones regulan el uso del sitio web de {siteConfig.storeName} (en adelante, &quot;el sitio&quot;)
        y la compra de productos a través de él. El uso continuado del sitio implica la aceptación de estos términos.
      </p>

      <h2>Capacidad</h2>
      <p>
        Para comprar en el sitio, las personas deben tener capacidad legal para contratar conforme al Código Civil y
        Comercial de la Nación Argentina. Quienes no tengan esa capacidad no podrán utilizar el sitio para realizar compras.
      </p>

      <h2>Usuario ocasional, sin registro</h2>
      <p>
        El sitio no requiere crear una cuenta ni registrarse con usuario y contraseña. Para comprar, alcanza con elegir
        los productos, agregarlos al carrito e iniciar el pedido. Al confirmar el pedido, se abre WhatsApp para coordinar
        con {siteConfig.storeName} los datos de entrega (nombre, dirección y teléfono) y el envío del comprobante de pago.
      </p>

      <h2>Medios de pago</h2>
      <p>
        El único medio de pago disponible es <strong>transferencia bancaria</strong>. Al confirmar un pedido, el sitio
        muestra el alias/CBU para transferir; el pedido queda como pendiente hasta que {siteConfig.storeName} confirma
        haber recibido el comprobante correspondiente.
      </p>

      <h2>Disponibilidad de stock</h2>
      <p>
        Puede suceder que, entre que se realiza el pedido y se confirma el pago, algún producto ya no esté disponible o
        su precio haya variado por tratarse de productos frescos de temporada. En ese caso, {siteConfig.storeName} se
        pondrá en contacto por WhatsApp para ajustar o cancelar el pedido antes de confirmarlo.
      </p>

      <h2>Compra mínima para envío</h2>
      <p>
        Los pedidos con retiro en el local no tienen compra mínima. Los pedidos con envío tienen un mínimo de{' '}
        <strong>${siteConfig.deliveryMinPurchase.toFixed(2)}</strong>, dado el costo del viaje en moto.
      </p>

      <h2>Entrega</h2>
      <p>
        El retiro de los pedidos se realiza en el local ({siteConfig.storeAddress}), en el horario de atención:{' '}
        {siteConfig.storeHours.weekday}. {siteConfig.storeHours.sunday}.
      </p>
      <p>
        El envío se coordina caso a caso por WhatsApp, según disponibilidad de {siteConfig.deliveryProviderName}. No hay
        una zona de entrega fija ni un costo de envío predefinido: el costo del viaje lo abona el cliente directamente,
        y puede variar según distancia, demanda y horario. Los precios y tiempos de envío están sujetos a variación por
        tratarse de un servicio de mensajería particular.
      </p>
      <p>
        Al recibir el pedido, el cliente debe revisar la mercadería en el momento de la entrega.
      </p>

      <h2>Cambios y devoluciones</h2>
      <p>
        Si recibiste algún producto en mal estado, escribinos por WhatsApp o al correo de contacto con fotos del
        producto. Luego de verificarlo, {siteConfig.storeName} reintegrará el dinero correspondiente o reemplazará el
        producto, según se coordine con el cliente.
      </p>

      <h2>Sanitización</h2>
      <p>
        {siteConfig.storeName} no lava ni desinfecta los productos antes de entregarlos. La sanitización de la
        mercadería (lavado de frutas y verduras) es responsabilidad del cliente antes de su consumo.
      </p>

      <h2>Contenido del sitio</h2>
      <p>
        Las imágenes de los productos son ilustrativas y pueden diferir levemente del producto entregado por
        tratarse de productos frescos y de temporada. El sitio puede contener imprecisiones o errores tipográficos;
        su uso es bajo la diligencia del usuario.
      </p>

      <h2>Propiedad intelectual</h2>
      <p>
        Los textos, imágenes, logotipos y diseño del sitio son propiedad de {siteConfig.storeName}. No está permitido
        reproducirlos, copiarlos o utilizarlos con fines comerciales sin autorización previa.
      </p>

      <h2>Limitación de responsabilidad</h2>
      <p>
        El sitio se ofrece &quot;tal cual&quot;, sin garantizar que estará libre de errores o interrupciones. {siteConfig.storeName}{' '}
        no será responsable por daños indirectos derivados del uso del sitio, salvo lo que establezca la normativa de
        defensa del consumidor aplicable.
      </p>

      <h2>Modificaciones</h2>
      <p>
        {siteConfig.storeName} podrá modificar estos Términos y Condiciones en cualquier momento. Los cambios entran en
        vigencia desde su publicación en esta página; te sugerimos revisarla periódicamente. El uso continuado del sitio
        luego de una modificación implica su aceptación.
      </p>

      <h2>Ley aplicable</h2>
      <p>
        Estos Términos y Condiciones se rigen por las leyes de la República Argentina, incluyendo la Ley de Defensa del
        Consumidor (24.240).
      </p>

      <h2>Contacto</h2>
      <p>
        Ante cualquier consulta sobre estos Términos, podés escribirnos a{' '}
        <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a> o por WhatsApp al{' '}
        <a href={`https://wa.me/${siteConfig.whatsappNumber}`} target="_blank" rel="noopener noreferrer">
          +{siteConfig.whatsappNumber}
        </a>
        .
      </p>

      <p>
        Ver también nuestra <Link href="/privacidad">Política de Privacidad</Link>.
      </p>
    </main>
  );
}
