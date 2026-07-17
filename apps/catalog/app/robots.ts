import type { MetadataRoute } from 'next';

// AI *training* crawlers are blocked; assistant/search agents that send
// shoppers to us (OAI-SearchBot, ChatGPT-User, Claude-User, PerplexityBot)
// stay allowed via the default rule. robots.txt only stops polite bots —
// Vercel Firewall UA rules are the enforcement layer.
const BLOCKED_TRAINING_BOTS = [
  'GPTBot',
  'ClaudeBot',
  'CCBot',
  'Bytespider',
  'PetalBot',
  'Diffbot',
  'Google-Extended',
  'Applebot-Extended',
  'meta-externalagent',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/finder/', '/api/'] },
      ...BLOCKED_TRAINING_BOTS.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
    sitemap: 'https://wnlq9.shop/sitemap.xml',
  };
}
