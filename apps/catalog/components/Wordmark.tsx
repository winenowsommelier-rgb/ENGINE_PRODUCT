import { cn } from '@/lib/utils';

/**
 * WNLQ9 — the single source of truth for the brand wordmark's visual style.
 *
 * Every place the brand name is rendered as text (site Header, the printable
 * catalog cover, anywhere else) should render <Wordmark /> instead of the
 * literal string "WNLQ9", so a single edit here restyles it everywhere.
 *
 * If the brand ever moves to an image/SVG logo, swap the returned markup for
 * an <Image>/<svg> here — every caller picks it up with no other changes.
 *
 * `size` maps to a type scale; callers pass layout-only classes (spacing,
 * color overrides, hover states) via `className`.
 */

// font-sans is set explicitly (not inherited) so Wordmark renders with the
// same typeface everywhere, even inside contexts — like the printable
// catalog's own CSS module — that set a different font-family on an
// ancestor. Tailwind's default font-sans is what the site Header gets by
// having no font-family override in globals.css/tailwind.config.
const BASE = 'font-sans';

const SIZES = {
  header: 'text-2xl font-bold tracking-tight sm:text-3xl',
  cover: 'text-6xl font-bold tracking-tight sm:text-7xl',
} as const;

interface WordmarkProps {
  size?: keyof typeof SIZES;
  className?: string;
}

export function Wordmark({ size = 'header', className }: WordmarkProps) {
  return <span className={cn(BASE, SIZES[size], className)}>WNLQ9</span>;
}
