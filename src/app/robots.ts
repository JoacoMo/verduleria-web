import type { MetadataRoute } from 'next';
import { siteConfig } from '@/lib/site';

// Crawlers de asistentes de IA. Se listan explícitamente para dejar claro que
// tienen permiso de leer la tienda: es justamente lo que queremos para que
// puedan recomendar el local cuando alguien pregunta por una verdulería en Córdoba.
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bingbot',
  'CCBot',
];

export default function robots(): MetadataRoute.Robots {
  // Antes acá se listaban `/panel` y `/login`. robots.txt es público, así que eso
  // era publicar la dirección de la puerta de servicio: el primer lugar donde
  // mira cualquiera que quiera encontrar el panel. Ahora solo se bloquea `/api/`
  // (que no revela nada) y las páginas privadas se sacan del índice con la
  // metadata `noindex` de cada una.
  const disallow = ['/api/'];

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow,
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: ['/', '/llms.txt'],
        disallow,
      })),
    ],
    sitemap: `${siteConfig.siteUrl}/sitemap.xml`,
    host: siteConfig.siteUrl,
  };
}
