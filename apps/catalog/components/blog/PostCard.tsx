import Image from 'next/image';
import Link from 'next/link';
import type { BlogPostPreview } from '@/lib/blog/hashnode-posts';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function PostCard({ post }: { post: BlogPostPreview }) {
  const brief = post.brief.length > 120 ? post.brief.slice(0, 120) + '…' : post.brief;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 transition-shadow hover:shadow-md">
      {post.coverImage && (
        <div className="relative aspect-video w-full overflow-hidden rounded-md">
          <Image
            src={post.coverImage.url}
            alt={post.title}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {post.tags.map((tag) => (
          <span key={tag.slug} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {tag.name}
          </span>
        ))}
      </div>
      <h2 className="text-lg font-semibold leading-snug text-foreground">{post.title}</h2>
      <p className="text-sm text-muted-foreground">{brief}</p>
      <div className="mt-auto flex items-center justify-between">
        <time className="text-xs text-muted-foreground" dateTime={post.publishedAt}>
          {formatDate(post.publishedAt)}
        </time>
        <Link
          href={`/blog/${post.slug}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Read more →
        </Link>
      </div>
    </article>
  );
}
