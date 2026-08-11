import type { Metadata } from 'next';
import LoginPage from '@/components/login-page';

// Fuera del índice de los buscadores: no se listan en robots.txt a propósito
// (ver src/lib/routes.ts), así que el noindex es lo que evita que aparezcan.
export const metadata: Metadata = {
  title: 'Ingreso',
  robots: { index: false, follow: false, nocache: true },
};

export default function Page() {
  return <LoginPage />;
}
