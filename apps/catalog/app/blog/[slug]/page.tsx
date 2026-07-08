// apps/catalog/app/blog/[slug]/page.tsx
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAllPosts, getPostBySlug } from '@/lib/blog/local-posts';
import { PostBody } from '@/components/blog/PostBody';
import { RelatedProducts } from '@/components/blog/RelatedProducts';
import { RecommendedPosts } from '@/components/blog/RecommendedPosts';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildArticleSchema, buildFaqSchema } from '@/lib/seo/blog-jsonld';
import { getAllProducts } from '@/lib/catalog-data';
import { resolveProductEmbeds } from '@/lib/blog/resolve-product-embeds';
import { BlogViewTracker } from '@/components/blog/BlogViewTracker';

export const revalidate = 3600;
export const dynamicParams = true; // posts not in generateStaticParams served via ISR

const BASE = 'https://wnlq9.shop';

export function generateStaticParams() {
  // Pre-render all local posts at build time; ISR handles any added mid-deploy.
  try {
    return getAllPosts(250).map((p) => ({ slug: p.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const post = getPostBySlug(params.slug);
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
  const post = getPostBySlug(params.slug);
  if (!post) notFound();

  const allProducts = getAllProducts();
  const allPosts = getAllPosts(50);
  const productMap = resolveProductEmbeds(post.content.html, allProducts);

  const url = `${BASE}/blog/${post.slug}`;
  const faqSchema = buildFaqSchema(post);

  return (
    <div className="min-h-screen bg-white">
      <BlogViewTracker slug={post.slug} title={post.title} />

      {/* Cover image — full-width hero, 480px tall on desktop */}
      {post.coverImage && (
        <div className="relative h-64 w-full sm:h-96 lg:h-[480px] overflow-hidden bg-stone-100">
          <Image
            src={post.coverImage.url}
            alt={post.title}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          {/* Dark gradient so title reads over any image */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        </div>
      )}

      <div className="mx-auto max-w-2xl px-5 pb-24">
        {/* Title block — sits right below the hero */}
        <div className="-mt-2 relative z-10 pt-8 sm:pt-10">
          {/* Tags */}
          {post.tags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {post.tags.map((t) => (
                <span
                  key={t.slug}
                  className="rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-stone-500"
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}

          <h1 className="mb-5 font-serif text-3xl font-bold leading-tight tracking-tight text-stone-900 sm:text-4xl lg:text-[2.6rem]">
            {post.title}
          </h1>

          {/* Byline */}
          <div className="mb-10 flex items-center gap-3 border-b border-stone-150 pb-8">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-800">
              <span className="text-xs font-bold text-white tracking-widest">WN</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-stone-800">WNLQ9 Sommelier</span>
              <time className="text-sm text-stone-400" dateTime={post.publishedAt}>
                {new Date(post.publishedAt).toLocaleDateString('en-TH', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </time>
            </div>
          </div>
        </div>

        <article>
          <PostBody html={post.content.html} productMap={productMap} />
        </article>

        {/* Back to Journal */}
        <div className="mt-12 border-t border-stone-200 pt-8">
          <Link href="/blog" className="text-sm font-semibold text-primary hover:underline">
            ← Back to Journal
          </Link>
        </div>

        <RelatedProducts tags={post.tags} allProducts={allProducts} />
        <RecommendedPosts currentSlug={post.slug} currentTags={post.tags} allPosts={allPosts} />
      </div>
      <JsonLd data={buildArticleSchema(post, url)} />
      {faqSchema && <JsonLd data={faqSchema} />}
    </div>
  );
}
