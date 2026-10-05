import Link from 'next/link';
import { siteConfig } from '@/lib/site';
import { formatArs } from '@/lib/format-price';
import { buildWhatsappUrl } from '@/lib/whatsapp';
import { ORDER_CUTOFF_LABEL } from '@/lib/store-hours';
import { buildPageMetadata, getDeliveryScheduleText, getFullAddress, getLeadTimeText } from '@/lib/seo';

export const metadata = buildPageMetadata({
  title: 'Términos y Condiciones de Compra',
  description: `Términos y condiciones de compra de ${siteConfig.storeName}: precios, total final por peso, medios de pago, envíos y retiro, cambios y devoluciones.`,
  path: '/terminos',
});

export default function TerminosPage() {
  const schedule = getDeliveryScheduleText();

  return (
    <main className="legal-page">
      <Link href="/" className="back-link">← Volver a la tienda</Link>
      <h1>Términos y Condiciones de Compra</h1>
      <p className="legal-updated">Última actualización: 5 de octubre de 2026</p>

      <p>
        Estos Términos y Condiciones regulan el uso del sitio web de {siteConfig.storeName} (en adelante, &quot;el sitio&quot;)
        y la compra de productos a través de él. El uso continuado del sitio implica la aceptación de estos términos.
      </p>

      <h2>Capacidad</h2>
      <p>
        Para comprar en el sitio, las personas deben tener capacidad legal para contratar conforme al Código Civil y
        Comercial de la Nación Argentina. Quienes no tengan esa capacidad no podrán utilizar el sitio para realizar compras.
      </p>

      <h2>Cómo se hace un pedido</h2>
      <p>
        El sitio no requiere crear una cuenta ni registrarse con usuario y contraseña. Para comprar, alcanza con elegir
        los productos, agregarlos al carrito y completar los datos del pedido: nombre, teléfono, forma de entrega (retiro
        en el local o envío a domicilio, con la dirección y el turno), medio de pago y qué hacer si falta algún producto.
        Al confirmar, el pedido queda registrado y se abre WhatsApp con el detalle para seguir la conversación con{' '}
        {siteConfig.storeName}.
      </p>

      <h2>Precios y total final</h2>
      <p>
        Los precios publicados están en pesos argentinos y son por unidad de venta (kilo, gramo, unidad, atado o
        bandeja, según el producto). Si un precio cambia mientras armás el pedido, el sitio te muestra la diferencia
        antes de registrarlo.
      </p>
      <p>
        En los productos que se venden por peso, el total que se muestra al hacer el pedido es <strong>estimado</strong>:
        al prepararlo, {siteConfig.storeName} pesa la mercadería, ajusta el pedido con las cantidades reales y le envía
        al cliente el <strong>total final</strong> por WhatsApp. El precio por kilo o por gramo no cambia; lo que puede
        variar es el peso. Si el pedido no tiene productos por peso, el total es exacto desde el principio.
      </p>
      <p>
        Las ofertas rigen mientras estén vigentes. Si una oferta tiene fecha de cierre, vale hasta el final de ese día
        (hora de Argentina).
      </p>

      <h2>Medios de pago</h2>
      <p>
        Los medios de pago disponibles son <strong>transferencia bancaria</strong> y <strong>efectivo</strong>. El
        sitio no cobra pagos online.
      </p>
      <ul>
        <li>
          <strong>Transferencia:</strong> se transfiere el total final que {siteConfig.storeName} envía por WhatsApp
          después de pesar el pedido (no antes). Si el pedido no tiene productos por peso, se puede transferir el total
          al hacer el pedido. En los dos casos se envía el comprobante por WhatsApp.
        </li>
        <li>
          <strong>Efectivo:</strong> se paga al recibir el pedido o al retirarlo en el local.
        </li>
      </ul>
      <p>
        El pedido queda como pendiente hasta que {siteConfig.storeName} confirma el pago.
      </p>

      <h2>Disponibilidad de stock</h2>
      <p>
        Por tratarse de productos frescos, puede pasar que al preparar el pedido algún producto ya no esté disponible o
        no esté en condiciones. En ese caso se hace lo que el cliente eligió al pedir: reemplazarlo por uno similar,
        sacarlo del pedido o contactarlo antes de decidir. Lo que se saca del pedido se descuenta del total final.
      </p>

      <h2>Compra mínima para envío</h2>
      <p>
        Los pedidos con retiro en el local no tienen compra mínima. Los pedidos con envío tienen un mínimo de{' '}
        <strong>{formatArs(siteConfig.deliveryMinPurchase)}</strong> en productos, sin contar el costo del envío.
      </p>

      <h2>Entrega</h2>
      <p>
        <strong>Retiro en el local:</strong> sin costo y sin turno, en {getFullAddress()}, en el horario de atención:{' '}
        {siteConfig.storeHours.weekday}. {siteConfig.storeHours.sunday}. Los pedidos para retirar que llegan antes de las{' '}
        {ORDER_CUTOFF_LABEL} se preparan en el día; los que llegan después, a partir del día siguiente.
      </p>
      <p>
        <strong>Envío a domicilio:</strong> dentro de Córdoba Capital, en turnos fijos. {schedule.summary} El cliente
        elige el turno al hacer el pedido, entre los disponibles, con al menos {getLeadTimeText()} de anticipación. El
        envío tiene un costo fijo de <strong>{formatArs(siteConfig.deliveryFee)}</strong> y es sin cargo en pedidos
        desde <strong>{formatArs(siteConfig.deliveryFreeThreshold)}</strong> en productos. Si por algún imprevisto no se
        puede cumplir el turno elegido, o si el pedido es muy pesado para un solo viaje, {siteConfig.storeName} se
        comunica por WhatsApp para coordinar la entrega.
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
        <a href={buildWhatsappUrl(siteConfig.whatsappNumber)} target="_blank" rel="noopener noreferrer">
          +{siteConfig.whatsappNumber}
        </a>
        .
      </p>

      <p>
        Ver también nuestra <Link href="/privacidad">Política de Privacidad</Link> y la página de{' '}
        <Link href="/envios">envíos y retiro</Link>.
      </p>
    </main>
  );
}
