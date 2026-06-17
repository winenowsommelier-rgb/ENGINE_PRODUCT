'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Global site header — Maison minimal style.
 *
 * - Big typographic WNLQ9 wordmark (left), links to home.
 * - Calm typographic primary nav (desktop), hamburger disclosure (mobile).
 * - Search affordance on the right (overlay is Task 12; for now it links to
 *   /shop so it is never a broken/no-op control).
 * - Sticky to top with a subtle bottom border on a white background.
 *
 * Client component because of the mobile-menu open/close state.
 *
 * Accessibility: every link/button is a >=44px tap target; the wordmark and
 * nav use the 18px base scale; focus rings are global (globals.css).
 */

const NAV_LINKS = [
  { href: '/shop', label: 'Shop' },
  { href: '/explore-map', label: 'Explore by Map' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const;

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
      <div className="container flex h-20 items-center justify-between gap-4">
        {/* Wordmark */}
        <Link
          href="/"
          className="flex h-11 items-center text-2xl font-bold tracking-tight text-foreground transition-colors hover:text-primary sm:text-3xl"
          aria-label="WNLQ9 home"
        >
          WNLQ9
        </Link>

        {/* Desktop nav */}
        <nav
          className="hidden items-center gap-8 md:flex"
          aria-label="Primary"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex h-11 items-center text-base font-medium text-foreground transition-colors hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right cluster: search + mobile toggle */}
        <div className="flex items-center gap-1">
          <Link
            href="/shop"
            aria-label="Search"
            className="flex h-11 w-11 items-center justify-center rounded-md text-foreground transition-colors hover:text-primary"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            className="flex h-11 w-11 items-center justify-center rounded-md text-foreground transition-colors hover:text-primary md:hidden"
          >
            {mobileOpen ? (
              <X className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Menu className="h-6 w-6" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile disclosure panel */}
      <nav
        id="mobile-nav"
        aria-label="Primary mobile"
        className={cn(
          'border-t border-border bg-background md:hidden',
          mobileOpen ? 'block' : 'hidden',
        )}
      >
        <ul className="container flex flex-col py-2">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="flex min-h-11 items-center py-3 text-lg font-medium text-foreground transition-colors hover:text-primary"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
