import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignationDescriptionCard } from '@/components/shop/DesignationDescriptionCard';
import type { DesignationDescriptionEntry } from '@/lib/explore/designation-lookup.server';

const shortEntry: DesignationDescriptionEntry = {
  designation: 'DOCG',
  description: 'Sentence one. Sentence two.',
  citation: 'Wine Bible 2e',
};

const longEntry: DesignationDescriptionEntry = {
  designation: 'XO',
  description: 'One. Two. Three. Four. Five.',
  citation: 'BNIC',
};

describe('DesignationDescriptionCard', () => {
  it('renders the designation name in the header', () => {
    render(<DesignationDescriptionCard entry={shortEntry} />);
    expect(screen.getByText('DOCG')).toBeInTheDocument();
    expect(screen.getByText(/Classification/)).toBeInTheDocument();
  });

  it('renders short copy fully with no Read more toggle (3 or fewer sentences)', () => {
    render(<DesignationDescriptionCard entry={shortEntry} />);
    expect(screen.getByText('Sentence one.')).toBeInTheDocument();
    expect(screen.getByText('Sentence two.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /read more/i })).not.toBeInTheDocument();
  });

  it('collapses long copy behind a Read more toggle', () => {
    render(<DesignationDescriptionCard entry={longEntry} />);
    expect(screen.getByText('One.')).toBeInTheDocument();
    expect(screen.queryByText('Five.')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /read more/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not render a citation footer (matches RegionDescriptionCard)', () => {
    render(<DesignationDescriptionCard entry={shortEntry} />);
    expect(screen.queryByText('Wine Bible 2e')).not.toBeInTheDocument();
  });
});
