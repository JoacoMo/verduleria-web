import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Página no encontrada',
  robots: { index: false, follow: true },
};

const linkRowStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  justifyContent: 'center',
  gap: '6px 18px',
  marginTop: 18,
};

const linkStyle = { color: 'var(--leaf-dark)', fontWeight: 600 };

// Mismo estilo que los títulos de las páginas legales (no hay clase para .page-card h1).
const titleStyle = {
  fontFamily: 'var(--font-display, cursive), cursive',
  fontSize: '2.6rem',
  color: 'var(--chalkboard)',
  margin: '0 0 8px',
};

/**
 * 404 con salida: alguien que llega por un link viejo (por ejemplo, las páginas
 * de pago que ya no existen) encuentra el camino a la tienda en vez de un callejón.
 */
export default function NotFound() {
  return (
    <main className="container">
      <div className="page-card">
        <h1 style={titleStyle}>No encontramos esta página</h1>
        <p>Puede que el link esté mal escrito o que la página ya no exista.</p>
        <p style={linkRowStyle}>
          <Link href="/" style={linkStyle}>Ir a la tienda</Link>
          <Link href="/bolsones" style={linkStyle}>Bolsones</Link>
          <Link href="/ofertas" style={linkStyle}>Ofertas</Link>
          <Link href="/envios" style={linkStyle}>Envíos y retiro</Link>
        </p>
      </div>
    </main>
  );
}
