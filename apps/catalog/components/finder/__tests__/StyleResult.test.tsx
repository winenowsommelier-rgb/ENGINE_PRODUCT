import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { StyleResult } from '@/components/finder/StyleResult';
import type { PublicProduct } from '@/lib/types';
import type { StyleProfile } from '@/lib/finder/style-profiles';
import type { Answers } from '@/lib/finder/answers';
import type { ContactLinks } from '@/lib/contact';

/**
 * Result hero (Task 10): each bottle shows an honest MATCH BAND and carries a
 * BUY/ENQUIRE path (contact deep-links — there is NO cart in this catalog).
 *
 * We assert the real user-visible affordances:
 *  (a) a band label ("Great / Strong / Good match") renders next to the bottles;
 *  (b) the Buy/Enquire path is wired — opening a card's Quick-look surfaces the
 *      WhatsApp deep-link whose pre-filled message carries that bottle's sku,
 *      proving StyleResult threaded the per-bottle contactLinks through to the card.
 */

const P = (o: Partial<PublicProduct>): PublicProduct =>
  ({
    sku: 'SKU0',
    name: 'A Bottle',
    price: 1500,
    is_in_stock: '1',
    image_url: '',
    ...o,
  } as PublicProduct);

const profile: StyleProfile = {
  id: 'bold-structured-red',
  name: 'Bold & Structured Red',
  tagline: 'Big, confident reds',
  expertNote: 'Firm tannins, dark fruit, built to age.',
  definingAttributes: { body: 'Full', tannin: 'High' },
  foodGuidance: 'Steak, lamb, aged cheese',
  occasionFit: ['special'],
} as unknown as StyleProfile;

const answers: Answers = { category: 'red', tasteFeel: 'bold' } as Answers;

// Mirror the server-built ContactLinks for a sku (wa.me with sku in the prefilled text).
function contactLinksFor(sku: string): ContactLinks {
  return {
    line: 'https://line.me/R/ti/p/@wnlq9',
    whatsapp: `https://wa.me/66812345678?text=${encodeURIComponent(
      `I'm interested in Bottle ${sku} — ${sku}`,
    )}`,
    facebook: 'https://m.me/wnlq9',
  };
}

describe('StyleResult — per-bottle band + Buy/Enquire path', () => {
  const products = [
    P({ sku: 'WRW001', name: 'Bottle WRW001' }),
    P({ sku: 'WRW002', name: 'Bottle WRW002' }),
  ];
  const contactLinksBySku: Record<string, ContactLinks> = {
    WRW001: contactLinksFor('WRW001'),
    WRW002: contactLinksFor('WRW002'),
  };
  const bandBySku = {
    WRW001: 'Great match' as const,
    WRW002: 'Good match' as const,
  };

  it('renders an honest match-band label next to the bottles', () => {
    render(
      <StyleResult
        profile={profile}
        products={products}
        degraded={false}
        answers={answers}
        allProducts={products}
        contactLinksBySku={contactLinksBySku}
        bandBySku={bandBySku}
      />,
    );
    // Bands appear (one per bottle). Use a flexible matcher since "Great match"
    // also collides with nothing else on the page.
    expect(screen.getByText('Great match')).toBeInTheDocument();
    expect(screen.getByText('Good match')).toBeInTheDocument();
  });

  it('threads each bottle its contact deep-links → Quick-look exposes a wa.me link carrying the sku', () => {
    render(
      <StyleResult
        profile={profile}
        products={products}
        degraded={false}
        answers={answers}
        allProducts={products}
        contactLinksBySku={contactLinksBySku}
        bandBySku={bandBySku}
      />,
    );

    // Buy/Enquire affordance is present on every bottle (Quick-look button).
    const quickLooks = screen.getAllByRole('button', { name: /Quick look at/ });
    expect(quickLooks.length).toBe(2);

    // Open the first bottle's Quick-look modal and confirm the WhatsApp deep-link
    // pre-fills THIS bottle's sku — proof the per-bottle links were threaded through.
    fireEvent.click(
      screen.getByRole('button', { name: /Quick look at Bottle WRW001/ }),
    );
    const dialog = screen.getByRole('dialog');
    const whatsapp = within(dialog).getByRole('link', { name: /WhatsApp/ });
    expect(whatsapp).toHaveAttribute(
      'href',
      expect.stringContaining('wa.me'),
    );
    expect(decodeURIComponent(whatsapp.getAttribute('href') ?? '')).toContain(
      'WRW001',
    );
  });
});
