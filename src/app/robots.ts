import type { MetadataRoute } from 'next';
import { siteConfig } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/panel', '/login', '/api/'],
    },
    sitemap: `${siteConfig.siteUrl}/sitemap.xml`,
  };
}
