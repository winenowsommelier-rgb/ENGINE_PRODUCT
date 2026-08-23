import Link from 'next/link';
import type { ListRow } from '@/lib/supabase/types';

export function ListCard({ list, itemCount }: { list: ListRow; itemCount: number }) {
  return (
    <Link
      href={`/lists/${list.public_id}`}
      className="flex flex-col gap-1 rounded-xl border border-border p-4 transition-colors hover:border-primary"
    >
      <span className="font-medium">{list.name}</span>
      <span className="text-sm text-muted-foreground">
        {itemCount} {itemCount === 1 ? 'item' : 'items'} · {list.is_public ? 'Public' : 'Private'}
      </span>
      <span className="text-xs text-muted-foreground">{list.public_id}</span>
    </Link>
  );
}
