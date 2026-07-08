import type { Metadata } from 'next';
import Link from 'next/link';
import { getAllPosts, getAllPostsForCategory } from '@/lib/blog/local-posts';
import { DRINK_SLUGS, PURPOSE_SLUGS, CATEGORY_META } from '@/lib/blog/categories';
import { HeroStrip } from '@/components/blog/HeroStrip';
import { PostCard } from '@/components/blog/PostCard';

// generateMetadata (not export const metadata) so we can use the featured post's coverImage for og:image.
// getAllPosts is synchronous — no await.
export function generateMetadata(): Metadata {
  const allPosts = getAllPosts(200);
  const featuredPost = allPosts.find(p => p.featured) ?? allPosts[0];
  const ogImage = featuredPost?.coverImage?.url ?? '/og-default.jpg';
  return {
    title: 'The WNLQ9 Journal — Wine, Whisky, Spirits & Sake',
    description: "Guides, pairings, and deep dives on wine, whisky, spirits, and sake — from Bangkok's finest selection.",
    alternates: { canonical: 'https://wnlq9.shop/blog' },
    openGraph: {
      title: 'The WNLQ9 Journal — Wine, Whisky, Spirits & Sake',
      description: "Guides, pairings, and deep dives on wine, whisky, spirits, and sake — from Bangkok's finest selection.",
      images: [{ url: ogImage }],
    },
  };
}

export default function BlogIndexPage() {
  // Synchronous — no await
  const allPosts = getAllPosts(200);

  if (allPosts.length === 0) {
    return (
      <main className="container py-12">
        <p className="text-muted-foreground">No posts yet — check back soon.</p>
      </main>
    );
  }

  // Featured post: first with featured===true, else most recent (allPosts[0])
  const featuredPost = allPosts.find(p => p.featured) ?? allPosts[0];

  // Article counts per drink category — synchronous filesystem reads, acceptable at build time
  const drinkCounts: Record<string, number> = Object.fromEntries(
    DRINK_SLUGS.map(slug => [slug, getAllPostsForCategory(slug).length])
  );

  // Article counts per purpose category
  const purposeCounts: Record<string, number> = Object.fromEntries(
    PURPOSE_SLUGS.map(slug => [slug, getAllPostsForCategory(slug).length])
  );

  // 6 most recent posts for the Latest Posts section
  const latest = getAllPosts(6);

  return (
    <>
      <HeroStrip featuredPost={featuredPost} drinkCounts={drinkCounts} />

      {/* Browse by Purpose */}
      <section className="border-b border-border py-8">
        <div className="container">
          <h2 className="mb-4 font-serif text-lg font-semibold text-foreground">Browse by Purpose</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {PURPOSE_SLUGS.map(slug => {
              const meta = CATEGORY_META[slug];
              const count = purposeCounts[slug] ?? 0;
              const shortDesc = meta.description.split(' ').slice(0, 6).join(' ');
              return (
                <Link
                  key={slug}
                  href={`/blog/category/${slug}`}
                  className="flex flex-col gap-1 rounded-lg border border-border p-3 hover:bg-muted"
                >
                  <span className="text-xl">{meta.icon}</span>
                  <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                  <span className="text-xs text-muted-foreground">{count} articles</span>
                  <span className="text-xs text-muted-foreground">{shortDesc}…</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Latest Posts */}
      <section className="py-8">
        <div className="container">
          <h2 className="mb-4 font-serif text-lg font-semibold text-foreground">Latest Posts</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {latest.map(post => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
