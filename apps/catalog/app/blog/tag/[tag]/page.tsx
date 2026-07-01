import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPostsByTag } from '@/lib/blog/hashnode-posts';
import { PostCard } from '@/components/blog/PostCard';

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: { tag: string };
}): Promise<Metadata> {
  const label = params.tag.replace(/-/g, ' ');
  return {
    title: `${label} | WNLQ9 Journal`,
    description: `Posts tagged "${label}" from WNLQ9 Journal.`,
    alternates: { canonical: `https://wnlq9.shop/blog/tag/${params.tag}` },
  };
}

export default async function TagPage({ params }: { params: { tag: string } }) {
  const posts = await getPostsByTag(params.tag, 12);
  if (posts.length === 0) notFound();

  const label = params.tag.replace(/-/g, ' ');

  return (
    <main className="container py-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight capitalize">{label}</h1>
      <div className="grid gap-6 sm:grid-cols-2">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </main>
  );
}
