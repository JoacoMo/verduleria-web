import Link from 'next/link';
import { siteConfig } from '@/lib/site';
import { buildWhatsappUrl } from '@/lib/whatsapp';
import { CLOSED_ORDER_RETENTION_DAYS, STALE_PENDING_DAYS } from '@/lib/order-lifecycle';
import { buildPageMetadata } from '@/lib/seo';

export const metadata = buildPageMetadata({
  title: 'Política de Privacidad',
  description: `Qué datos guarda ${siteConfig.storeName} cuando hacés un pedido, para qué se usan, cuánto tiempo se conservan y cómo se protegen.`,
  path: '/privacidad',
});

export default function PrivacidadPage() {
  return (
    <main className="legal-page">
      <Link href="/" className="back-link">← Volver a la tienda</Link>
      <h1>Política de Privacidad</h1>
      <p className="legal-updated">Última actualización: 5 de octubre de 2026</p>

      <p>
        Esta política explica qué información recopila {siteConfig.storeName} cuando hacés un pedido a través del
        sitio, para qué la usamos, cuánto tiempo la guardamos y cómo la protegemos.
      </p>

      <h2>Qué datos guarda el sitio</h2>
      <p>Cuando confirmás un pedido, el sitio guarda en su base de datos:</p>
      <ul>
        <li>
          <strong>Tus datos de contacto:</strong> nombre, teléfono y, si el pedido es con envío, la dirección de entrega.
        </li>
        <li>
          <strong>Lo que escribas en aclaraciones</strong> (por ejemplo, el timbre o cómo querés la fruta) y qué
          preferís que hagamos si falta algún producto.
        </li>
        <li>
          <strong>El detalle del pedido:</strong> productos, cantidades, precios, costo de envío, total, forma de entrega
          (retiro o envío y el turno elegido), medio de pago (transferencia o efectivo), estado del pedido y la fecha y
          hora en que se hizo.
        </li>
      </ul>
      <p>
        No pedimos crear una cuenta ni contraseña, y como no hay pagos online, el sitio no recibe ni guarda datos de
        tarjetas ni de cuentas bancarias.
      </p>

      <h2>Para qué usamos los datos</h2>
      <p>
        Usamos los datos del pedido únicamente para prepararlo, pesarlo y mandarte el total final, coordinar la entrega o
        el retiro, avisarte si falta algún producto y confirmar el pago. De forma agregada y sin identificar a nadie, nos
        sirven también para saber qué días y turnos tienen más pedidos. No los usamos para publicidad.
      </p>

      <h2>WhatsApp</h2>
      <p>
        Al confirmar el pedido, el sitio abre WhatsApp con el detalle de la compra, y por ahí te escribimos al teléfono
        que dejaste (por ejemplo, para mandarte el total final). Esa conversación ocurre en WhatsApp, una plataforma de
        Meta Platforms, Inc., y se rige además por la política de privacidad de WhatsApp.
      </p>

      <h2>Con quién se comparten</h2>
      <p>
        No vendemos ni cedemos tus datos. Solo los ve quien prepara y entrega tu pedido: para un envío, el nombre, la
        dirección y el teléfono, que hacen falta para llevarlo.
      </p>

      <h2>Cuánto tiempo se guardan</h2>
      <p>
        Un pedido que queda pendiente de pago durante {STALE_PENDING_DAYS} días se cancela. Los pedidos cancelados o que
        no se concretaron se borran, con todos sus datos, a los {CLOSED_ORDER_RETENTION_DAYS} días de hechos. Los pedidos
        pagados se conservan como registro de ventas del local.
      </p>

      <h2>Qué queda guardado en tu navegador</h2>
      <p>
        El carrito y, después de un pedido, tus datos de contacto (para completar el próximo más rápido) se guardan en
        tu propio navegador, no en nuestros servidores. Los podés borrar cuando quieras limpiando los datos del sitio en
        tu navegador.
      </p>
      <p>
        Para contar visitas usamos Vercel Web Analytics, que mide el uso del sitio de forma agregada, sin cookies y sin
        identificarte. La única cookie del sitio es la de la sesión del panel de administración, que usa solo el local.
      </p>

      <h2>Cómo protegemos los datos</h2>
      <p>
        El sitio funciona siempre con conexión cifrada (HTTPS). La base de datos está alojada en un proveedor externo
        (Supabase) y solo se accede a los pedidos desde el panel de administración de {siteConfig.storeName}, protegido
        con usuario y contraseña.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Como titular de tus datos podés pedirnos en cualquier momento acceder a ellos, corregirlos o que los borremos,
        escribiéndonos a <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a> o por WhatsApp al{' '}
        <a href={buildWhatsappUrl(siteConfig.whatsappNumber)} target="_blank" rel="noopener noreferrer">
          +{siteConfig.whatsappNumber}
        </a>
        . Conforme a la Ley 25.326 de Protección de Datos Personales, el acceso es gratuito a intervalos no inferiores
        a seis meses, salvo que se acredite un interés legítimo. La Agencia de Acceso a la Información Pública, órgano de
        control de la Ley 25.326, atiende las denuncias y reclamos relacionados con el incumplimiento de las normas sobre
        protección de datos personales.
      </p>

      <h2>Cambios a esta política</h2>
      <p>
        Podemos actualizar esta Política de Privacidad si cambia la forma en que operamos el sitio. Cualquier cambio se
        publicará en esta misma página, con la fecha de actualización.
      </p>

      <p>
        Ver también nuestros <Link href="/terminos">Términos y Condiciones de Compra</Link>.
      </p>
    </main>
  );
}
