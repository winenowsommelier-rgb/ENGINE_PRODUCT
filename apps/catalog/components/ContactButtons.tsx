'use client';

import { MessageCircle, Phone, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContactLinks } from '@/lib/contact';

/**
 * ContactButtons — up to three Maison-clean "talk to us" buttons (LINE,
 * WhatsApp, Facebook Messenger).
 *
 * This is a CLIENT component and DELIBERATELY does NOT read process.env. A parent
 * SERVER component reads the public handles (via getContactEnv in
 * lib/contact-env.ts), builds the deep-links (buildContactLinks in lib/contact.ts),
 * and passes the ready-made STRINGS in as `links`. This keeps env access
 * server-only and the component trivially testable.
 *
 * Any link that is '' (handle not configured) is NOT rendered — so a half-set-up
 * deployment shows only the channels it actually has, never a broken link.
 *
 * Each button is a real <a target="_blank" rel="noopener noreferrer"> (opens the
 * messaging app in a new tab) with a 44px min target for the 40+ audience.
 *
 *  - variant 'inline'  → horizontal row (default; fits inside QuickView).
 *  - variant 'stacked' → vertical, full-width (good for narrow columns / mobile).
 *  - size 'sm' | 'md'  → 'md' is the default 44px target; 'sm' is a touch tighter
 *    but still meets the 44px min-height for accessibility.
 */

interface ContactButtonsProps {
  links: ContactLinks;
  variant?: 'inline' | 'stacked';
  size?: 'sm' | 'md';
}

interface Channel {
  key: keyof ContactLinks;
  label: string;
  href: string;
  Icon: typeof MessageCircle;
}

export function ContactButtons({
  links,
  variant = 'inline',
  size = 'md',
}: ContactButtonsProps) {
  // Build the ordered channel list, dropping any with an empty link string.
  const channels: Channel[] = (
    [
      { key: 'line', label: 'LINE', href: links.line, Icon: MessageCircle },
      { key: 'whatsapp', label: 'WhatsApp', href: links.whatsapp, Icon: Phone },
      { key: 'facebook', label: 'Messenger', href: links.facebook, Icon: Send },
    ] as Channel[]
  ).filter((c) => c.href !== '');

  if (channels.length === 0) return null;

  const isStacked = variant === 'stacked';

  return (
    <div
      className={cn(
        'flex gap-2',
        isStacked ? 'flex-col' : 'flex-row flex-wrap',
      )}
    >
      {channels.map(({ key, label, href, Icon }) => (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md',
            'border border-border bg-background font-medium text-foreground',
            'transition-colors hover:border-primary hover:text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            size === 'sm' ? 'px-3 text-sm' : 'px-4 text-base',
            isStacked ? 'w-full' : '',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
          <span>{label}</span>
        </a>
      ))}
    </div>
  );
}
