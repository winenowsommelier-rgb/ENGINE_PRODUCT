import Link from 'next/link';

export function EscapeHatch({ totalProducts }: { totalProducts: number }) {
  return (
    <Link href="/shop" className="inline-flex min-h-11 items-center text-base text-primary underline underline-offset-4 hover:opacity-80">
      Not here? Browse all {totalProducts.toLocaleString()}+ bottles →
    </Link>
  );
}
