'use client';

import { useState } from 'react';
import type { BlogPostPreview } from '@/lib/blog/hashnode-posts';
import type { PurposeSlug } from '@/lib/blog/categories';
import { PURPOSE_TAG_MAP, CATEGORY_META, PURPOSE_SLUGS } from '@/lib/blog/categories';
import { PostCard } from './PostCard';

const POSTS_PER_PAGE = 12;

interface PillBarProps {
  posts: BlogPostPreview[]
  basePath: string
  initialPage: number
}

function getPurposesForPosts(posts: BlogPostPreview[]): PurposeSlug[] {
  const found = new Set<PurposeSlug>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const ps = PURPOSE_TAG_MAP[tag.slug];
      if (ps) found.add(ps);
    }
  }
  return PURPOSE_SLUGS.filter(s => found.has(s));
}

function buildPageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '…')[] = [1];
  if (current > 3) pages.push('…');
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push('…');
  pages.push(total);
  return pages;
}

export function PillBar({ posts, basePath, initialPage }: PillBarProps) {
  const [activePurpose, setActivePurpose] = useState<PurposeSlug | null>(null);
  const [page, setPage] = useState(initialPage);

  const availablePurposes = getPurposesForPosts(posts);

  const filtered = activePurpose
    ? posts.filter(p => p.tags.some(t => PURPOSE_TAG_MAP[t.slug] === activePurpose))
    : posts;

  const totalPages = Math.max(1, Math.ceil(filtered.length / POSTS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pagePosts = filtered.slice((safePage - 1) * POSTS_PER_PAGE, safePage * POSTS_PER_PAGE);

  const showingStart = filtered.length === 0 ? 0 : (safePage - 1) * POSTS_PER_PAGE + 1;
  const showingEnd = Math.min(safePage * POSTS_PER_PAGE, filtered.length);
  const activePillLabel = activePurpose ? CATEGORY_META[activePurpose].label : null;
  const resultsMeta = activePillLabel
    ? `Showing ${showingStart}–${showingEnd} of ${filtered.length} ${activePillLabel} articles`
    : `Showing ${showingStart}–${showingEnd} of ${filtered.length} articles`;

  function handlePillClick(slug: PurposeSlug | null) {
    setActivePurpose(slug);
    setPage(1);
  }

  return (
    <>
      {/* Pill filter bar + sort toggle */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handlePillClick(null)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              activePurpose === null
                ? 'bg-foreground text-background'
                : 'bg-muted text-foreground hover:bg-muted/80'
            }`}
          >
            All
          </button>
          {availablePurposes.map(slug => (
            <button
              key={slug}
              onClick={() => handlePillClick(slug)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                activePurpose === slug
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              {CATEGORY_META[slug].label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button className="rounded-full bg-foreground px-3 py-1 text-sm font-medium text-background">
            Newest
          </button>
          <button
            disabled
            title="Coming soon"
            className="cursor-not-allowed rounded-full border border-border px-3 py-1 text-sm font-medium opacity-40"
          >
            Most Popular
          </button>
        </div>
      </div>

      {/* Results meta */}
      <p className="px-4 py-2 text-sm text-muted-foreground">
        {filtered.length === 0 ? 'No articles found.' : resultsMeta}
      </p>

      {/* Post grid */}
      <div className="grid gap-6 px-4 sm:grid-cols-2 lg:grid-cols-3">
        {pagePosts.map(post => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>

      {/*
        Client-side pagination — only rendered when a pill filter is active.
        When no pill is active (activePurpose === null), the server-rendered <Pagination>
        component in the category route handles pagination via real ?page=N Link URLs.
        This avoids rendering two competing pagination controls simultaneously.
      */}
      {activePurpose !== null && totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 py-8">
          {safePage > 1 && (
            <button
              onClick={() => setPage(p => p - 1)}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              ← Prev
            </button>
          )}
          {buildPageNumbers(safePage, totalPages).map((item, i) =>
            item === '…' ? (
              <span key={`e-${i}`} className="px-2 text-sm text-muted-foreground">…</span>
            ) : (
              <button
                key={item}
                onClick={() => setPage(item)}
                className={`rounded border px-3 py-1.5 text-sm ${
                  item === safePage
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {item}
              </button>
            )
          )}
          {safePage < totalPages && (
            <button
              onClick={() => setPage(p => p + 1)}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Next →
            </button>
          )}
        </div>
      )}
    </>
  );
}
