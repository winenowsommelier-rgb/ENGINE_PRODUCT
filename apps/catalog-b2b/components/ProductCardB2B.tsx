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
      <div className="relative h-36 overflow-hidden rounded-lg bg-white border border-neutral-100 shadow-sm transition-shadow hover:shadow-md">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-contain object-center transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-neutral-300 text-xs">
            No image
          </div>
        )}
        {/* Critic score pill — top-left */}
        {criticScore && (
          <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold rounded px-1.5 py-0.5 leading-none">
            {criticScore}
          </span>
        )}
        {/* Stock badges — top-right */}
        {isExpress && (
          <span className="absolute top-2 right-2 bg-emerald-600 text-white text-[9px] font-bold rounded px-1.5 py-0.5 leading-none">
            EXPRESS
          </span>
        )}
        {isArchive && (
          <span className="absolute top-2 right-2 bg-neutral-400 text-white text-[9px] font-bold rounded px-1.5 py-0.5 leading-none">
            ARCHIVE
          </span>
        )}
      </div>
      <div className="mt-2 space-y-0.5 px-0.5 pb-1">
        <p className="text-[11px] text-neutral-400 truncate">{product.brand ?? product.country ?? ''}</p>
        <p className="text-sm font-medium text-neutral-900 leading-snug line-clamp-2">{product.name}</p>
        <p className="text-sm font-bold text-neutral-900 mt-1 tabular-nums">
          {formatPrice(product.b2b_price, product.currency)}
        </p>
      </div>
    </Link>
  );
}
