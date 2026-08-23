'use client';

import { usePriceUnlock } from '@/components/PriceUnlockProvider';
import { formatPrice } from '@/lib/price-tiers';

export function ListTotal({ total }: { total: number }) {
  const { unlocked, openModal } = usePriceUnlock();

  if (unlocked) {
    return <span className="tabular-nums">{formatPrice(total)}</span>;
  }

  return (
    <button type="button" onClick={openModal} className="underline decoration-dotted underline-offset-4">
      Unlock to see total
    </button>
  );
}
