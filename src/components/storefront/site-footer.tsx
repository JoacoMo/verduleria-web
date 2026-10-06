import Link from 'next/link';
import type { StoreInfo } from '@/lib/types';

/**
 * `year` viene del render del servidor (hora argentina): calcularlo acá con
 * new Date() daba un año distinto en el servidor (UTC) y en el celular la noche
 * del 31/12, y React tiraba el HTML entero (error de hidratación).
 */
export default function SiteFooter({ storeInfo, year }: { storeInfo: StoreInfo; year: string }) {
  return (
    <footer>
      <div className="container">
        <p>
          &copy; {year} {storeInfo.storeName}. Verdulería y frutería en {storeInfo.storeNeighborhood}, Córdoba Capital.
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
