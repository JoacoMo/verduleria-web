import Link from 'next/link';

export default function PendingPage() {
  return (
    <main className="status-page">
      <div className="page-card status-shell">
        <h1 style={{ color: 'var(--crate-dark)' }}>⏳ Tu pago está pendiente</h1>
        <p>Estamos esperando la confirmación del medio de pago. Te avisaremos cuando se acredite.</p>
        <Link href="/" style={{ color: 'var(--leaf)', fontWeight: 600 }}>Volver a la tienda</Link>
      </div>
    </main>
  );
}