import type { Metadata } from 'next';
import Link from 'next/link';
import { siteConfig } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Política de Privacidad',
  description: `Qué datos recopila ${siteConfig.storeName} al hacer un pedido, para qué se usan y cómo se protegen.`,
  alternates: {
    canonical: '/privacidad',
  },
};

export default function PrivacidadPage() {
  return (
    <main className="legal-page">
      <Link href="/" className="back-link">← Volver a la tienda</Link>
      <h1>Política de Privacidad</h1>
      <p className="legal-updated">Última actualización: 5 de agosto de 2026</p>

      <p>
        Esta política explica qué información recopila {siteConfig.storeName} cuando hacés un pedido a través del
        sitio, para qué la usamos y cómo la protegemos.
      </p>

      <h2>Qué datos guarda el sitio</h2>
      <p>
        Cuando confirmás un pedido, el sitio guarda en su base de datos: los productos y cantidades elegidas, el
        monto total, el método de entrega (retiro o envío) y el estado del pedido (pendiente, pagado o cancelado),
        con la fecha y hora en que se realizó. El sitio <strong>no te pide ni almacena nombre, dirección ni
        teléfono</strong> en ningún formulario.
      </p>

      <h2>Qué datos se comparten por WhatsApp</h2>
      <p>
        Al confirmar el pedido, el sitio abre WhatsApp con el detalle de la compra para que coordines con{' '}
        {siteConfig.storeName} el nombre, la dirección de entrega, el teléfono de contacto y el envío del comprobante
        de transferencia. Esa conversación ocurre por WhatsApp, una plataforma de Meta Platforms, Inc., y se rige por
        la política de privacidad propia de WhatsApp. {siteConfig.storeName} utiliza esos datos únicamente para
        coordinar la entrega del pedido y no los cede ni comparte con terceros ajenos a esa entrega (por ejemplo, el
        mensajero de {siteConfig.deliveryProviderName} cuando el pedido es con envío).
      </p>

      <h2>Para qué usamos la información</h2>
      <p>
        Usamos los datos del pedido para prepararlo, coordinar su entrega o retiro, confirmar el pago recibido y, de
        forma agregada y sin identificar clientes, para entender qué días y horarios tenemos más demanda.
      </p>

      <h2>Cómo protegemos los datos</h2>
      <p>
        La base de datos del sitio está alojada en un proveedor externo (Supabase) con acceso restringido mediante
        usuario y contraseña, disponible únicamente para el administrador de {siteConfig.storeName}. No vendemos ni
        compartimos información de pedidos con fines publicitarios.
      </p>

      <h2>Tus consultas</h2>
      <p>
        Si querés hacernos alguna consulta sobre esta política o sobre información que nos hayas compartido por
        WhatsApp, podés escribirnos a{' '}
        <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a> o por WhatsApp al{' '}
        <a href={`https://wa.me/${siteConfig.whatsappNumber}`} target="_blank" rel="noopener noreferrer">
          +{siteConfig.whatsappNumber}
        </a>
        .
      </p>

      <h2>Cambios a esta política</h2>
      <p>
        Podemos actualizar esta Política de Privacidad si cambia la forma en que operamos el sitio (por ejemplo, si
        en el futuro agregamos un formulario que pida estos datos directamente). Cualquier cambio se publicará en
        esta misma página.
      </p>

      <p>
        Ver también nuestros <Link href="/terminos">Términos y Condiciones de Compra</Link>.
      </p>
    </main>
  );
}
