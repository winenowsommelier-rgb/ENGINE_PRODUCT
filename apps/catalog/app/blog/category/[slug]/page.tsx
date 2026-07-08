import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAllPostsForCategory } from '@/lib/blog/local-posts';
import {
  DRINK_SLUGS,
  PURPOSE_SLUGS,
  CATEGORY_META,
  type CategorySlug,
} from '@/lib/blog/categories';
import { PillBar } from '@/components/blog/PillBar';
import { Pagination } from '@/components/blog/Pagination';

const ALL_SLUGS: CategorySlug[] = [...DRINK_SLUGS, ...PURPOSE_SLUGS];
const POSTS_PER_PAGE = 12;

export function generateStaticParams() {
  return ALL_SLUGS.map(slug => ({ slug }));
}

// Next.js 14: params is a plain object, not a Promise
export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const meta = CATEGORY_META[params.slug as CategorySlug];
  if (!meta) return {};
  // Synchronous — no await
  const posts = getAllPostsForCategory(params.slug as CategorySlug);
  const ogImage = posts[0]?.coverImage?.url ?? '/og-default.jpg';
  const canonicalUrl = `https://wnlq9.shop/blog/category/${params.slug}`;
  return {
    title: `${meta.label} — WNLQ9 Journal`,
    description: meta.description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${meta.label} — WNLQ9 Journal`,
      description: meta.description,
      url: canonicalUrl,
      images: [{ url: ogImage }],
    },
  };
}

// Next.js 14: params and searchParams are plain objects, not Promises
export default function CategoryPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { page?: string }
}) {
  const slug = params.slug;

  if (!ALL_SLUGS.includes(slug as CategorySlug)) notFound();

  const slug_ = slug as CategorySlug;
  const meta = CATEGORY_META[slug_];
  // Synchronous — no await
  const posts = getAllPostsForCategory(slug_);
  const currentPage = Math.max(1, parseInt(searchParams.page ?? '1', 10));
  const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));

  // Canonical: no ?page param on page 1; self-canonical for page 2+
  const canonicalUrl =
    currentPage <= 1
      ? `https://wnlq9.shop/blog/category/${slug}`
      : `https://wnlq9.shop/blog/category/${slug}?page=${currentPage}`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Journal', item: 'https://wnlq9.shop/blog' },
      { '@type': 'ListItem', position: 2, name: meta.label, item: `https://wnlq9.shop/blog/category/${slug}` },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <link rel="canonical" href={canonicalUrl} />

      {/* Category header */}
      <div className="border-b border-border bg-background px-4 py-6">
        <div className="container">
          <nav className="mb-2 text-sm text-muted-foreground">
            <Link href="/blog" className="hover:underline">Journal</Link>
            <span className="mx-1">›</span>
            <span>{meta.label}</span>
          </nav>
          <h1 className="font-serif text-2xl font-bold text-foreground">{meta.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
        </div>
      </div>

      {/* PillBar: pill filter bar + post grid + client-side pagination when a pill is active */}
      <div className="container py-4">
        <PillBar posts={posts} basePath={`/blog/category/${slug}`} initialPage={currentPage} />
      </div>

      {/*
        Server-side pagination — handles the base "All" case with real ?page=N Link URLs.
        PillBar suppresses its own pagination buttons when no pill is active (activePurpose === null),
        so only one pagination control is ever visible at a time.
      */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        basePath={`/blog/category/${slug}`}
      />
    </>
  );
}
