'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Search, Menu, X, Lock, LockOpen, User as UserIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SearchOverlay } from '@/components/SearchOverlay';
import { Wordmark } from '@/components/Wordmark';
import { usePriceUnlock } from '@/components/PriceUnlockProvider';
import { logoutAction } from '@/actions/auth';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

/**
 * Global site header — Maison minimal style.
 *
 * - Big typographic WNLQ9 wordmark (left), links to home.
 * - Calm typographic primary nav (desktop), hamburger disclosure (mobile).
 * - Search icon on the right OPENS the client SearchOverlay. The overlay
 *   self-fetches the static search index (public/search-index.json) lazily on
 *   first open — the index is NO LONGER embedded in the page (perf: it used to
 *   ship ~1.5 MB in every page). The header just toggles open state.
 * - Sticky to top with a subtle bottom border on a white background.
 *
 * Client component (mobile-menu + search-overlay open/close state).
 *
 * Accessibility: every link/button is a >=44px tap target; the wordmark and
 * nav use the 18px base scale; focus rings are global (globals.css).
 */

const NAV_LINKS = [
  { href: '/shop', label: 'Shop' },
  { href: '/finder', label: 'Find Your Match' },
  { href: '/explore-map', label: 'Explore by Map' },
  { href: '/collections', label: 'Collections' },
  { href: '/blog', label: 'Journal' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const;

type HeaderUser = { id: string; email: string | null };
type HeaderProfile = { username: string; avatar_url: string | null };

export function Header({
  user = null,
  profile = null,
}: {
  user?: HeaderUser | null;
  profile?: HeaderProfile | null;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { unlocked, openModal } = usePriceUnlock();

  return (
    <header className="sticky top-0 z-50 w-full overflow-x-hidden border-b border-border bg-background">
      <div className="container flex h-20 items-center justify-between gap-3 !px-4 sm:gap-4 sm:!px-6 lg:!px-8">
        {/* Wordmark */}
        <Link
          href="/"
          className="flex h-11 items-center text-foreground transition-colors hover:text-primary"
          aria-label="WNLQ9 home"
        >
          <Wordmark size="header" />
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

        {/* Right cluster: unlock prices + search + mobile toggle */}
        <div className="flex shrink-0 items-center gap-1">
          {!unlocked && (
            <button
              type="button"
              onClick={openModal}
              className="hidden h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary sm:flex"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              Unlock prices
            </button>
          )}
          {!unlocked && (
            <button
              type="button"
              onClick={openModal}
              aria-label="Unlock prices"
              className="flex h-11 w-11 items-center justify-center rounded-md text-foreground transition-colors hover:text-primary sm:hidden"
            >
              <Lock className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {unlocked && (
            <span
              className="hidden h-11 items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground sm:flex"
              aria-label="Prices unlocked"
            >
              <LockOpen className="h-4 w-4" aria-hidden="true" />
              Prices unlocked
            </span>
          )}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="flex h-11 w-11 items-center justify-center rounded-md text-foreground transition-colors hover:text-primary"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>

          {user ? (
            <AccountMenu profile={profile} />
          ) : (
            <Link
              href="/login"
              className="flex h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:text-primary"
            >
              Log in
            </Link>
          )}

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
          <li className="border-t border-border mt-1 pt-1">
            {user ? (
              <>
                <Link
                  href="/account/lists"
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-11 items-center py-3 text-lg font-medium text-foreground transition-colors hover:text-primary"
                >
                  My lists
                </Link>
                <Link
                  href="/account/settings"
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-11 items-center py-3 text-lg font-medium text-foreground transition-colors hover:text-primary"
                >
                  Account settings
                </Link>
                <LogoutButton
                  className="flex min-h-11 w-full items-center py-3 text-left text-lg font-medium text-foreground transition-colors hover:text-primary"
                  onBeforeNavigate={() => setMobileOpen(false)}
                />
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="flex min-h-11 items-center py-3 text-lg font-medium text-foreground transition-colors hover:text-primary"
              >
                Log in
              </Link>
            )}
          </li>
        </ul>
      </nav>

      <SearchOverlay open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

/**
 * Avatar + username trigger that opens a dropdown to account links + logout.
 *
 * Built on the repo's existing `components/ui/dropdown-menu.tsx` (Radix
 * `DropdownMenu` wrapper, same primitive `Filters.tsx`'s sort/country
 * dropdowns use) rather than a hand-rolled `<div>` + click-outside overlay --
 * Radix gives arrow-key navigation, auto-focus into the menu, and ESC-to-
 * close for free, which a hand-rolled version would have to reimplement.
 * Same reasoning `SearchOverlay.tsx` documents for using Radix `Dialog`.
 */
function AccountMenu({
  profile,
}: {
  profile: { username: string; avatar_url: string | null } | null;
}) {
  const initial = profile?.username ? profile.username.charAt(0).toUpperCase() : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex h-11 items-center gap-2 rounded-md px-2 text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {profile?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium"
            aria-hidden="true"
          >
            {initial ?? <UserIcon className="h-4 w-4" />}
          </span>
        )}
        <span className="hidden text-sm font-medium sm:inline">
          {profile?.username ?? 'Account'}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{profile?.username ?? 'Account'}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account/lists">My lists</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/settings">Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <LogoutMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Logout menu item. Radix closes the dropdown automatically on select
 * (default behavior), so unlike the old hand-rolled version this doesn't
 * need an `onBeforeNavigate` close callback -- `onSelect` just fires the
 * transition. `logoutAction` is a redirect-based server action (calls
 * next/navigation `redirect('/')` after signOut()); this matches
 * DeleteListButton.tsx's (Task 7) pattern for invoking a redirect-based
 * server action from a client component: run it inside `useTransition` and
 * let the server-side redirect drive navigation, rather than a
 * `<form action={...}>`.
 */
function LogoutMenuItem() {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={(event) => {
        // DropdownMenuItem's onSelect fires on both click and Enter/Space --
        // preventDefault keeps Radix from trying to return focus to a
        // trigger that's about to navigate away.
        event.preventDefault();
        startTransition(async () => {
          await logoutAction();
        });
      }}
    >
      Log out
    </DropdownMenuItem>
  );
}

/**
 * Logout trigger for the mobile disclosure panel, which isn't a dropdown
 * (it's already an always-visible-when-open inline list), so it stays a
 * plain button rather than a DropdownMenuItem.
 */
function LogoutButton({
  className,
  onBeforeNavigate,
}: {
  className?: string;
  onBeforeNavigate?: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        onBeforeNavigate?.();
        startTransition(async () => {
          await logoutAction();
        });
      }}
      className={className}
    >
      Log out
    </button>
  );
}
