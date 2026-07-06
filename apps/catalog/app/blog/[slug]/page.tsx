// apps/catalog/app/blog/[slug]/page.tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllPosts, getPostBySlug } from '@/lib/blog/hashnode-posts';
import { PostBody } from '@/components/blog/PostBody';
import { RelatedProducts } from '@/components/blog/RelatedProducts';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildArticleSchema, buildFaqSchema } from '@/lib/seo/blog-jsonld';
import { getAllProducts } from '@/lib/catalog-data';
import { resolveProductEmbeds } from '@/lib/blog/resolve-product-embeds';
import { BlogViewTracker } from '@/components/blog/BlogViewTracker';

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

  const allProducts = getAllProducts();
  const productMap = resolveProductEmbeds(post.content.html, allProducts);

  const url = `${BASE}/blog/${post.slug}`;
  const faqSchema = buildFaqSchema(post);

  return (
    <div className="min-h-screen bg-stone-50">
      <BlogViewTracker slug={post.slug} title={post.title} />
      <div className="mx-auto max-w-2xl px-5 pb-24 pt-12 sm:pt-16">
        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {post.tags.map((t) => (
              <span
                key={t.slug}
                className="rounded-full border border-stone-200 bg-white px-3 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-stone-500"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}

        {/* Title */}
        <h1 className="mb-4 font-serif text-3xl font-semibold leading-tight tracking-tight text-stone-900 sm:text-4xl">
          {post.title}
        </h1>

        {/* Byline */}
        <div className="mb-10 flex items-center gap-3 border-b border-stone-200 pb-8">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-200">
            <span className="text-xs font-semibold text-stone-500">WN</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-stone-700">WNLQ9 Sommelier</span>
            <time className="text-xs text-stone-400" dateTime={post.publishedAt}>
              {new Date(post.publishedAt).toLocaleDateString('en-TH', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </time>
          </div>
        </div>

        <article>
          <PostBody html={post.content.html} productMap={productMap} />
        </article>

        <RelatedProducts tags={post.tags} allProducts={allProducts} />
      </div>
      <JsonLd data={buildArticleSchema(post, url)} />
      {faqSchema && <JsonLd data={faqSchema} />}
    </div>
  );
}
