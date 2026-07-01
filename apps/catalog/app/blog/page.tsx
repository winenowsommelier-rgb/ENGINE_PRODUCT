import type { Metadata } from 'next';
import { getAllPosts, type BlogPostPreview } from '@/lib/blog/hashnode-posts';
import { PostCard } from '@/components/blog/PostCard';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'WNLQ9 Journal — Wine, Whisky & Spirits',
  description:
    'Tasting notes, pairing guides, and regional deep-dives from WNLQ9, Bangkok.',
  alternates: { canonical: 'https://wnlq9.shop/blog' },
};

export default async function BlogIndexPage() {
  let posts: BlogPostPreview[] = [];
  try {
    posts = await getAllPosts(12);
  } catch {
    // Hashnode not configured or unavailable — show empty state
  }

  return (
    <main className="container py-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Journal</h1>
      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet — check back soon.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </main>
  );
}
