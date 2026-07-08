import Link from 'next/link';
import type { BlogPostPreview } from '@/lib/blog/hashnode-posts';
import { DRINK_SLUGS, CATEGORY_META, DRINK_CATEGORY_SUBTAGS } from '@/lib/blog/categories';

interface HeroStripProps {
  featuredPost: BlogPostPreview
  drinkCounts: Record<string, number>
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function HeroStrip({ featuredPost, drinkCounts }: HeroStripProps) {
  const purposeTag = featuredPost.tags[0]?.name ?? 'Article';

  return (
    <div className="border-b border-border">
      <div className="container grid items-stretch gap-0" style={{ gridTemplateColumns: '1fr 240px' }}>
        {/* Left: featured post — covers full height of the right column */}
        <Link
          href={`/blog/${featuredPost.slug}`}
          className="group relative flex min-h-64 flex-col justify-end overflow-hidden bg-foreground p-6 text-background no-underline"
        >
          {featuredPost.coverImage && (
            // Plain <img> intentional — images.pexels.com not in next.config.js remotePatterns
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={featuredPost.coverImage.url}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover opacity-30"
            />
          )}
          <div className="relative z-10">
            <span className="mb-2 inline-block rounded bg-white/20 px-2 py-0.5 text-xs font-medium uppercase tracking-wider">
              {purposeTag}
            </span>
            <h2 className="mb-1 font-serif text-2xl font-bold leading-snug text-white group-hover:underline">
              {featuredPost.title}
            </h2>
            <time className="text-xs text-white/60">{formatDate(featuredPost.publishedAt)}</time>
            <p className="mt-3 text-sm font-medium text-white/90">Read now →</p>
          </div>
        </Link>

        {/* Right: 4 drink-type tiles stacked */}
        <div className="flex flex-col divide-y divide-border border-l border-border">
          {DRINK_SLUGS.map(slug => {
            const meta = CATEGORY_META[slug];
            const subtags = DRINK_CATEGORY_SUBTAGS[slug];
            const count = drinkCounts[slug] ?? 0;
            return (
              <Link
                key={slug}
                href={`/blog/category/${slug}`}
                className="flex flex-1 flex-col justify-center gap-1 px-4 py-3 hover:bg-muted"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{meta.icon}</span>
                  <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{count}</span>
                </div>
                <p className="text-xs text-muted-foreground">{subtags.join(' · ')}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
