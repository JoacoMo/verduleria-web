import { Analytics } from '@vercel/analytics/next';
import type { Metadata, Viewport } from 'next';
import { Caveat, DM_Mono, Work_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { siteConfig } from '@/lib/site';
import { OG_IMAGE } from '@/lib/seo';
import './globals.css';

/**
 * Fuentes con next/font: se descargan en el build y se sirven desde el propio
 * dominio. Así no hay pedidos a Google Fonts (ni preconnect, ni excepciones en la
 * CSP) y el texto no "salta" al cargar, porque next/font ajusta la fuente de
 * respaldo a las medidas de la real.
 *
 * Cada una expone una variable CSS que usa globals.css:
 * - Caveat (--font-display): títulos tipo pizarrón.
 * - Work Sans (--font-body): todo el texto.
 * - DM Mono (--font-mono): precios y cantidades.
 */
const displayFont = Caveat({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--font-display',
  // No se precarga: el LCP es texto en Work Sans; precargar esta fuente
  // demoraba la interactividad en el celular (medido en Fast 3G).
  preload: false,
});

const bodyFont = Work_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-body',
});

const monoFont = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
  // No se precarga: el LCP es texto en Work Sans; precargar esta fuente
  // demoraba la interactividad en el celular (medido en Fast 3G).
  preload: false,
});

const defaultTitle = `${siteConfig.storeName} | Verdulería y frutería en Córdoba Capital`;

/**
 * Metadata base. Cada página pública pisa título, descripción, canónica y
 * openGraph con buildPageMetadata (src/lib/seo.ts); acá queda lo común y lo que
 * usan las páginas que no definen nada (las privadas, que igual van con noindex).
 *
 * openGraph no lleva título ni URL: si los tuviera, una página sin openGraph
 * propio se compartiría con el título y la URL de la home. Sin ellos, Next los
 * completa con el título y la descripción de cada página.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: defaultTitle,
    template: `%s | ${siteConfig.storeName}`,
  },
  description: `Verdulería y frutería en ${siteConfig.storeNeighborhood}, Córdoba Capital. Frutas, verduras y bolsones por kilo, gramo o unidad, con retiro en el local o envío a domicilio.`,
  applicationName: siteConfig.storeName,
  keywords: [
    siteConfig.storeName,
    'verdulería en Córdoba Capital',
    `verdulería ${siteConfig.storeNeighborhood}`,
    'frutería Córdoba',
    'frutas y verduras a domicilio Córdoba',
    'bolsones de frutas y verduras Córdoba',
    'verdulería online Córdoba',
    'ofertas verdulería Córdoba',
  ],
  // iOS convierte en link de llamada cualquier tira de números (el CBU, por
  // ejemplo). Los teléfonos del sitio ya son links explícitos de WhatsApp.
  formatDetection: { telephone: false },
  openGraph: {
    siteName: siteConfig.storeName,
    locale: 'es_AR',
    type: 'website',
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Color del pizarrón (--chalkboard): la barra del navegador en el celular
  // sigue al menú de arriba.
  themeColor: '#1E2E22',
  // El sitio no tiene modo oscuro: sin esto, algunos navegadores oscurecen los
  // campos de formulario y quedan mal sobre el fondo claro.
  colorScheme: 'light',
};

/**
 * Toda la app se renderiza por request.
 *
 * Lo obliga la CSP con nonce: el nonce cambia en cada respuesta, y una página
 * prerenderizada quedaría con un nonce viejo (o sin nonce), así que el navegador
 * bloquea los scripts de Next y la página no hidrata. Eso ya nos pasó: `/trastienda`
 * era estática y el formulario de login no respondía.
 *
 * El costo es perder el cacheo estático de las páginas simples (términos,
 * privacidad, envíos). Para el tráfico de este sitio es aceptable, y a cambio la
 * CSP protege de verdad en todas las rutas.
 */
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es-AR" className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
