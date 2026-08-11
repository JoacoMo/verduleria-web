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
  const disallow = ['/panel', '/login', '/api/'];

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
