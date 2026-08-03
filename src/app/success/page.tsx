import Link from 'next/link';

export default function SuccessPage() {
  return (
    <main className="status-page">
      <div className="page-card status-shell">
        <h1 style={{ color: 'var(--leaf)' }}>✅ ¡Gracias por tu compra!</h1>
        <p>Tu pago fue aprobado. En breve nos vamos a poner en contacto para coordinar la entrega.</p>
        <Link href="/" style={{ color: 'var(--leaf)', fontWeight: 600 }}>Volver a la tienda</Link>
      </div>
    </main>
  );
}