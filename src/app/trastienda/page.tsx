import type { Metadata } from 'next';
import LoginPage from '@/components/login-page';
import { siteConfig } from '@/lib/site';

// Fuera del índice de los buscadores: no se listan en robots.txt a propósito
// (ver src/lib/routes.ts), así que el noindex es lo que evita que aparezcan.
export const metadata: Metadata = {
  title: 'Ingreso',
  robots: { index: false, follow: false, nocache: true },
};

export default function Page() {
  // El nombre sale de siteConfig acá (servidor): el componente del login es de
  // cliente y site.ts no se puede importar desde el navegador.
  return <LoginPage storeName={siteConfig.storeName} />;
}
