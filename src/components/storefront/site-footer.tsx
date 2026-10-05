import Link from 'next/link';
import type { StoreInfo } from '@/lib/types';

export default function SiteFooter({ storeInfo }: { storeInfo: StoreInfo }) {
  return (
    <footer>
      <div className="container">
        <p>
          &copy; {new Date().getFullYear()} {storeInfo.storeName}. Verdulería y frutería en {storeInfo.storeNeighborhood}, Córdoba Capital.
        </p>
        <nav className="footer-links" aria-label="Más información">
          <Link href="/envios">Envíos y turnos</Link>
          <Link href="/terminos">Términos y Condiciones</Link>
          <Link href="/privacidad">Política de Privacidad</Link>
        </nav>
      </div>
    </footer>
  );
}
