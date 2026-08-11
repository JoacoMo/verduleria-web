import type { Metadata } from 'next';
import AdminPanelPage from '@/components/admin-panel-page';

export const metadata: Metadata = {
  title: 'Gestión',
  robots: { index: false, follow: false, nocache: true },
};

export default function Page() {
  return <AdminPanelPage />;
}
