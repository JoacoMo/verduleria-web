import type { Metadata } from 'next';
import AdminPanelPage from '@/components/admin-panel-page';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AdminPanelPage />;
}