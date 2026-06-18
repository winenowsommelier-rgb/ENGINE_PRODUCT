import Link from 'next/link';
import { TrustBar } from '@/components/TrustBar';

/**
 * Home placeholder — frames the WNLQ9 brand cleanly while the full home
 * (Task 12) is built. Centered hero on lots of whitespace, one restrained
 * burgundy call-to-action linking into the shop.
 */
export default function Home() {
  return (
    <>
      <TrustBar />
      <section className="container flex flex-col items-center justify-center gap-8 py-28 text-center sm:py-40">
        <p className="text-base font-medium uppercase tracking-widest text-muted-foreground">
          Wine · Whisky · Spirits
        </p>
        <h1 className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
          WNLQ9
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
          A considered selection, chosen with care. Browse the collection at
          your own pace — when something speaks to you, reach out and
          we&apos;ll help you order.
        </p>
        <Link
          href="/shop"
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          Shop the collection
        </Link>
      </section>
    </>
  );
}
