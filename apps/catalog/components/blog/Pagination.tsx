import Link from 'next/link';

interface PaginationProps {
  currentPage: number
  totalPages: number
  basePath: string  // e.g. '/blog/category/wine' — no trailing slash
}

function pageHref(basePath: string, page: number): string {
  return page === 1 ? basePath : `${basePath}?page=${page}`;
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

export function Pagination({ currentPage, totalPages, basePath }: PaginationProps) {
  if (totalPages <= 1) return null;
  const items = buildPageNumbers(currentPage, totalPages);

  return (
    <nav aria-label="Page navigation" className="flex items-center justify-center gap-1 py-8">
      {currentPage > 1 && (
        <Link
          href={pageHref(basePath, currentPage - 1)}
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          ← Prev
        </Link>
      )}
      {items.map((item, i) =>
        item === '…' ? (
          <span key={`ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">…</span>
        ) : (
          <Link
            key={item}
            href={pageHref(basePath, item)}
            aria-current={item === currentPage ? 'page' : undefined}
            className={`rounded border px-3 py-1.5 text-sm ${
              item === currentPage
                ? 'border-foreground bg-foreground text-background'
                : 'border-border hover:bg-muted'
            }`}
          >
            {item}
          </Link>
        )
      )}
      {currentPage < totalPages && (
        <Link
          href={pageHref(basePath, currentPage + 1)}
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Next →
        </Link>
      )}
    </nav>
  );
}
