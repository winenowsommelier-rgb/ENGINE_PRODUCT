import Link from 'next/link';
import { StorefrontImage } from '@/components/StorefrontImage';
import type { ListRow } from '@/lib/supabase/types';

/** Max thumbnails to preview on a list summary card before falling back to a "+N" tally. */
export const MAX_PREVIEW_THUMBNAILS = 4;

export function ListCard({
  list,
  itemCount,
  previewImages = [],
}: {
  list: ListRow;
  itemCount: number;
  /** Up to a few of the list's item image URLs, in item order, for a Pinterest-style preview. */
  previewImages?: Array<string | null | undefined>;
}) {
  // Drop items with no resolvable image (deleted/discontinued SKU) instead of
  // rendering a placeholder tile inline with real bottle photos -- a mixed
  // row of real thumbnails + empty boxes reads as broken, not as "some items
  // have no photo."
  const thumbnails = previewImages.filter((src): src is string => Boolean(src)).slice(0, MAX_PREVIEW_THUMBNAILS);

  return (
    <Link
      href={`/lists/${list.public_id}`}
      className="flex flex-col gap-3 rounded-xl border border-border p-4 transition-colors hover:border-primary"
    >
      {thumbnails.length > 0 ? (
        <div className="flex gap-1.5">
          {thumbnails.map((src, i) => (
            <StorefrontImage
              key={i}
              src={src}
              alt=""
              className="aspect-square w-full rounded-md"
              sizes="80px"
            />
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="font-medium">{list.name}</span>
        <span className="text-sm text-muted-foreground">
          {itemCount} {itemCount === 1 ? 'item' : 'items'} · {list.is_public ? 'Public' : 'Private'}
        </span>
        <span className="text-xs text-muted-foreground">{list.public_id}</span>
      </div>
    </Link>
  );
}
