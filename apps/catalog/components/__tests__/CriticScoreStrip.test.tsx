import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CriticScoreStrip } from '@/components/CriticScoreStrip';

const twoCritics = JSON.stringify({
  critics: [
    { abbr: 'JS', critic: 'James Suckling', score_native: '92', score_value: 92 },
    { abbr: 'WA', critic: 'Wine Advocate', score_native: '91', score_value: 91 },
  ],
  community: [],
  medals: [],
});

describe('CriticScoreStrip', () => {
  it('renders nothing when there is no score', () => {
    const { container } = render(<CriticScoreStrip scoreMax={undefined} scoreSummary={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for malformed score_summary (never crashes)', () => {
    const { container } = render(<CriticScoreStrip scoreMax={90} scoreSummary={'{bad json'} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a cell per critic with abbr + score', () => {
    render(<CriticScoreStrip scoreMax={92} scoreSummary={twoCritics} />);
    expect(screen.getByText('JS')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('WA')).toBeInTheDocument();
    expect(screen.getByText('91')).toBeInTheDocument();
  });

  it('exposes a group with an aria-label listing all critics', () => {
    render(<CriticScoreStrip scoreMax={92} scoreSummary={twoCritics} />);
    const group = screen.getByRole('group');
    expect(group).toHaveAttribute(
      'aria-label',
      'Critic scores: James Suckling 92, Wine Advocate 91',
    );
  });

  it('marks the score_max critic as the lead cell', () => {
    render(<CriticScoreStrip scoreMax={92} scoreSummary={twoCritics} />);
    // The lead cell is flagged with data-lead="true" for the score_max critic.
    const lead = document.querySelector('[data-lead="true"]');
    expect(lead).not.toBeNull();
    expect(lead!.textContent).toContain('JS');
    expect(lead!.textContent).toContain('92');
    // Non-lead critic is not flagged.
    const leads = document.querySelectorAll('[data-lead="true"]');
    expect(leads.length).toBe(1);
  });

  it('gives each cell a native title tooltip with the full critic name + score', () => {
    render(<CriticScoreStrip scoreMax={92} scoreSummary={twoCritics} />);
    const js = document.querySelector('[data-lead="true"]');
    expect(js).toHaveAttribute('title', 'James Suckling — 92');
    const wa = Array.from(document.querySelectorAll('[role="group"] > div')).find(
      (d) => !d.hasAttribute('data-lead'),
    );
    expect(wa).toHaveAttribute('title', 'Wine Advocate — 91');
  });
});
