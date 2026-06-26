import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/finder/', '/api/'] },
    sitemap: 'https://wnlq9.shop/sitemap.xml',
  };
}
