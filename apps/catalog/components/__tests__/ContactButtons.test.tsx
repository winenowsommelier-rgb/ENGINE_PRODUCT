import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContactButtons } from '@/components/ContactButtons';

const allLinks = {
  line: 'https://line.me/R/ti/p/@wnlq9',
  whatsapp: 'https://wa.me/66812345678?text=hi',
  facebook: 'https://m.me/wnlq9',
};

describe('ContactButtons', () => {
  // WhatsApp is temporarily disabled site-wide (may return later) — even when
  // links.whatsapp is populated, ContactButtons must never render it.

  it('renders LINE and Messenger, but never WhatsApp, when all links are present', () => {
    render(<ContactButtons links={allLinks} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(allLinks.line);
    expect(hrefs).toContain(allLinks.facebook);
    expect(hrefs).not.toContain(allLinks.whatsapp);
  });

  it('omits a button when its link string is empty', () => {
    render(<ContactButtons links={{ ...allLinks, line: '' }} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('');
    expect(hrefs).toContain(allLinks.facebook);
  });

  it('renders nothing when all links are empty', () => {
    const { container } = render(
      <ContactButtons links={{ line: '', whatsapp: '', facebook: '' }} />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.firstChild).toBeNull();
  });

  it('every link opens in a new tab with rel="noopener noreferrer"', () => {
    render(<ContactButtons links={allLinks} />);
    for (const a of screen.getAllByRole('link')) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('stacked variant still renders one link per present non-WhatsApp channel', () => {
    render(<ContactButtons links={allLinks} variant="stacked" />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
