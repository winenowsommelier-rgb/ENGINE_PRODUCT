import Link from 'next/link';
import Image from 'next/image';
import type { BlogPostPreview } from '@/lib/blog/hashnode-posts';

interface RecommendedPostsProps {
  currentSlug: string;
  currentTags: Array<{ name: string; slug: string }>;
  allPosts: BlogPostPreview[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function RecommendedPosts({ currentSlug, currentTags, allPosts }: RecommendedPostsProps) {
  const currentTagSlugs = new Set(currentTags.map((t) => t.slug));

  // Score posts by tag overlap, exclude current post
  const scored = allPosts
    .filter((p) => p.slug !== currentSlug)
    .map((p) => {
      const overlap = p.tags.filter((t) => currentTagSlugs.has(t.slug)).length;
      return { post: p, score: overlap };
    })
    .sort((a, b) => b.score - a.score || b.post.publishedAt.localeCompare(a.post.publishedAt))
    .slice(0, 3)
    .map((s) => s.post);

  if (scored.length === 0) return null;

  return (
    <section className="mt-14 border-t border-stone-200 pt-10">
      <h2 className="mb-7 text-xl font-semibold text-stone-900">Keep reading</h2>
      <div className="flex flex-col gap-5">
        {scored.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex gap-4 rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-400 transition-colors"
          >
            {post.coverImage && (
              <div className="relative h-20 w-24 sm:h-24 sm:w-32 shrink-0 overflow-hidden rounded-lg">
                <Image
                  src={post.coverImage.url}
                  alt={post.title}
                  fill
                  sizes="128px"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
            )}
            <div className="flex flex-col justify-between gap-1 min-w-0">
              <div>
                {post.tags.length > 0 && (
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-stone-400">
                    {post.tags.slice(0, 2).map((t) => t.name).join(' · ')}
                  </p>
                )}
                <h3 className="text-sm font-semibold leading-snug text-stone-800 line-clamp-2 group-hover:text-stone-600 transition-colors">
                  {post.title}
                </h3>
              </div>
              <time className="text-xs text-stone-400" dateTime={post.publishedAt}>
                {formatDate(post.publishedAt)}
              </time>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
