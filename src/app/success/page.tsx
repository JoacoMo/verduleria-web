import Link from 'next/link';
import { siteConfig } from '@/lib/site';

export default function SuccessPage() {
  return (
    <main className="status-page">
      <div className="page-card status-shell">
        <h1 style={{ color: 'var(--leaf)' }}>✅ ¡Gracias por tu compra!</h1>
        <p>Tu pago fue aprobado. En breve nos vamos a poner en contacto para coordinar la entrega.</p>
        {siteConfig.googleReviewUrl ? (
          <p className="review-ask">
            Cuando recibas el pedido, ¿nos dejás una{' '}
            <a href={siteConfig.googleReviewUrl} target="_blank" rel="noopener noreferrer">reseña en Google</a>?
            Nos ayuda a que otros vecinos nos encuentren.
          </p>
        ) : null}
        <Link href="/" style={{ color: 'var(--leaf)', fontWeight: 600 }}>Volver a la tienda</Link>
      </div>
    </main>
  );
}
