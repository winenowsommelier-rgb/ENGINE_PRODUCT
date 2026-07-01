// apps/catalog/app/blog/[slug]/page.tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllPosts, getPostBySlug } from '@/lib/blog/hashnode-posts';
import { PostBody } from '@/components/blog/PostBody';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildArticleSchema, buildFaqSchema } from '@/lib/seo/blog-jsonld';

export const revalidate = 3600;
export const dynamicParams = true; // posts not in generateStaticParams served via ISR

const BASE = 'https://wnlq9.shop';

export async function generateStaticParams() {
  // Pre-render newest 50 at build; posts 51-250 served by ISR on first request.
  // Returns [] when HASHNODE_PUBLICATION_ID is not set (e.g. local builds without .env.local)
  // so the build succeeds — all posts are served via ISR in that case.
  if (!process.env.HASHNODE_PUBLICATION_ID) return [];
  try {
    const posts = await getAllPosts(50);
    return posts.map((p) => ({ slug: p.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const post = await getPostBySlug(params.slug);
  if (!post) return {};

  const url = `${BASE}/blog/${post.slug}`;
  return {
    title: post.seo.title ?? `${post.title} | WNLQ9 Journal`,
    description: post.seo.description ?? post.brief ?? '',
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      title: post.seo.title ?? post.title,
      description: post.seo.description ?? post.brief ?? '',
      images: post.coverImage
        ? [{ url: post.coverImage.url }]
        : [{ url: `${BASE}/og-default.jpg` }],
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: { slug: string };
}) {
  const post = await getPostBySlug(params.slug);
  if (!post) notFound();

  const url = `${BASE}/blog/${post.slug}`;
  const faqSchema = buildFaqSchema(post);

  return (
    <main className="container max-w-3xl py-12">
      <article>
        <h1 className="mb-4 text-3xl font-bold leading-tight tracking-tight">{post.title}</h1>
        <time className="mb-8 block text-sm text-muted-foreground" dateTime={post.publishedAt}>
          {new Date(post.publishedAt).toLocaleDateString('en-TH', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </time>
        <PostBody html={post.content.html} />
      </article>
      <JsonLd data={buildArticleSchema(post, url)} />
      {faqSchema && <JsonLd data={faqSchema} />}
    </main>
  );
}
