import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { siteConfig } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: `${siteConfig.storeName} | Verdulería y frutería en Córdoba Capital`,
    template: `%s | ${siteConfig.storeName}`,
  },
  description: 'Verdulería y frutería en Barrio General Paz, Córdoba Capital. Pedidos por kilo, gramos o unidad con retiro y envíos coordinados.',
  keywords: [
    'El Pampa',
    'verdulería en Córdoba Capital',
    'verdulería Barrio General Paz',
    'frutería Córdoba',
    'frutas y verduras a domicilio',
  ],
  openGraph: {
    title: `${siteConfig.storeName} | Verdulería y frutería en Córdoba Capital`,
    description: 'Frutas y verduras frescas en Barrio General Paz, Córdoba Capital. Pedidos por kilo, gramos o unidad.',
    url: siteConfig.siteUrl,
    siteName: siteConfig.storeName,
    locale: 'es_AR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteConfig.storeName} | Verdulería y frutería en Córdoba Capital`,
    description: 'Frutas y verduras frescas en Barrio General Paz, Córdoba Capital. Pedidos por kilo, gramos o unidad.',
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
        />
        {children}
      </body>
    </html>
  );
}