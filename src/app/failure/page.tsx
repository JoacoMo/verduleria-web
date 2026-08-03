import Link from 'next/link';

export default function FailurePage() {
  return (
    <main className="status-page">
      <div className="page-card status-shell">
        <h1 style={{ color: 'var(--radish)' }}>❌ El pago no se pudo procesar</h1>
        <p>Algo falló con tu pago. Podés intentarlo de nuevo desde la tienda.</p>
        <Link href="/" style={{ color: 'var(--leaf)', fontWeight: 600 }}>Volver a la tienda</Link>
      </div>
    </main>
  );
}