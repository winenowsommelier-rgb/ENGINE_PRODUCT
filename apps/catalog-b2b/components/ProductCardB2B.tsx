import Link from 'next/link';
import type { B2BProduct } from '@/lib/types';

function formatPrice(price: number, currency?: string): string {
  const sym = currency === 'THB' || !currency ? '฿' : currency + ' ';
  return sym + price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function parseCriticScore(summary?: string): string | null {
  if (!summary) return null;
  // Handle plain "93 pts" or JSON-encoded {"score":93,"reviewer":"WS"}
  try {
    const parsed = JSON.parse(summary);
    if (parsed?.score) return String(parsed.score);
  } catch {
    // Not JSON — treat as plain string
  }
  // Extract leading number
  const match = summary.match(/^(\d+)/);
  return match ? match[1] : null;
}

interface Props {
  product: B2BProduct;
}

export function ProductCardB2B({ product }: Props) {
  const criticScore = parseCriticScore(product.score_summary);
  const isArchive = product.custom_stock_status === 'CATALOG';
  const isExpress = !isArchive && (product.wn_stock ?? 0) > 0;

  return (
    <Link href={`/product/${product.sku}`} className="group block">
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-neutral-100">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-neutral-400 text-xs">
            No image
          </div>
        )}
        {/* Critic score pill */}
        {criticScore && (
          <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold rounded px-1.5 py-0.5 leading-none">
            {criticScore}
          </span>
        )}
        {/* Stock badges */}
        {isExpress && (
          <span className="absolute top-2 right-2 bg-emerald-600 text-white text-[9px] font-bold rounded px-1.5 py-0.5 leading-none">
            EXPRESS
          </span>
        )}
        {isArchive && (
          <span className="absolute top-2 right-2 bg-neutral-500 text-white text-[9px] font-bold rounded px-1.5 py-0.5 leading-none">
            ARCHIVE
          </span>
        )}
      </div>
      <div className="mt-2 space-y-0.5 px-0.5">
        <p className="text-[11px] text-neutral-400 truncate">{product.brand ?? product.country ?? ''}</p>
        <p className="text-xs font-medium text-neutral-900 leading-tight line-clamp-2">{product.name}</p>
        <p className="text-sm font-bold text-neutral-900 mt-1">
          {formatPrice(product.b2b_price, product.currency)}
        </p>
      </div>
    </Link>
  );
}
