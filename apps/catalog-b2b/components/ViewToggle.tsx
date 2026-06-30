'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export function ViewToggle() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const current = sp.get('view') ?? 'grid';

  function toggle(view: 'grid' | 'list') {
    const params = new URLSearchParams(sp.toString());
    params.set('view', view);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 bg-white">
      <button onClick={() => toggle('grid')} aria-label="Grid view"
        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${current === 'grid' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-900'}`}>
        Grid
      </button>
      <button onClick={() => toggle('list')} aria-label="List view"
        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${current === 'list' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-900'}`}>
        List
      </button>
    </div>
  );
}
