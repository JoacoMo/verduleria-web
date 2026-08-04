import type { Metadata } from 'next';
import StorefrontPage from '@/components/storefront-page';
import { siteConfig } from '@/lib/site';

export const metadata: Metadata = {
  title: 'El Pampa | Verdulería y Frutería a Domicilio en Córdoba',
  description: 'Comprá frutas y verduras frescas online en El Pampa. Envíos a domicilio en Barrio General Paz, Córdoba Capital. La mejor calidad.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: `${siteConfig.storeName} | Verdulería y Frutería a Domicilio en Córdoba`,
    description: 'Comprá frutas y verduras frescas online en El Pampa. Envíos a domicilio en Barrio General Paz, Córdoba Capital.',
    url: siteConfig.siteUrl,
    siteName: siteConfig.storeName,
    locale: 'es_AR',
    type: 'website',
  },
};

const localBusinessSchema = {
  '@context': 'https://schema.org',
  '@type': 'GroceryStore',
  name: siteConfig.storeName,
  url: siteConfig.siteUrl,
  address: {
    '@type': 'PostalAddress',
    streetAddress: siteConfig.storeNeighborhood,
    addressLocality: 'Córdoba Capital',
    addressRegion: 'Córdoba',
    addressCountry: 'AR',
  },
  areaServed: [siteConfig.storeNeighborhood, 'Córdoba Capital'],
  telephone: siteConfig.whatsappNumber ? `+${siteConfig.whatsappNumber}` : undefined,
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
      />
      <StorefrontPage />
    </>
  );
}