// apps/catalog/lib/seo/blog-jsonld.ts
import type { BlogPost } from '@/lib/blog/hashnode-posts';

const BASE = 'https://wnlq9.shop';

export function buildArticleSchema(post: BlogPost, url: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    image: post.coverImage?.url ?? `${BASE}/og-default.jpg`,
    url,
    author: { '@type': 'Organization', name: 'WNLQ9', url: BASE },
    publisher: {
      '@type': 'Organization',
      name: 'WNLQ9',
      logo: { '@type': 'ImageObject', url: `${BASE}/og-default.jpg` },
    },
  };
}

export function buildFaqSchema(post: BlogPost): object | null {
  const parts = post.content.markdown.split('## Frequently Asked Questions');
  if (parts.length < 2) return null;

  const faqSection = parts[1];
  // Regex created inside function — avoids module-level /gi lastIndex state bugs
  const regex = /^### (.+)\n+([\s\S]+?)(?=\n###|\n##|$)/gm;
  const pairs: { question: string; answer: string }[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(faqSection)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim();
    if (question && answer) pairs.push({ question, answer });
  }

  if (pairs.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.answer },
    })),
  };
}
