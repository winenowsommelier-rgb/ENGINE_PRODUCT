import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DrillBreadcrumb } from '../DrillBreadcrumb';

describe('DrillBreadcrumb', () => {
  it('renders nothing when no drill-down params set', () => {
    const { container } = render(<DrillBreadcrumb params={{}} pathname="/shop" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when only non-drill params (price/sort) are set', () => {
    const { container } = render(<DrillBreadcrumb params={{ price: 'under-1000', sort: 'name' }} pathname="/shop" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows category + geo crumbs and a Clear all', () => {
    render(<DrillBreadcrumb params={{ group: 'Wine', class: 'Red Wine', country: 'France', region: 'Bordeaux' }} pathname="/shop" />);
    expect(screen.getByText('Wine')).toBeInTheDocument();
    expect(screen.getByText('Red Wine')).toBeInTheDocument();
    expect(screen.getByText('France')).toBeInTheDocument();
    expect(screen.getByText('Bordeaux')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /clear all/i })).toBeInTheDocument();
  });

  it('a crumb links back to its level clearing deeper params of its strand', () => {
    render(<DrillBreadcrumb params={{ group: 'Wine', class: 'Red Wine', country: 'France', region: 'Bordeaux', subregion: 'Pauillac' }} pathname="/shop" />);
    const france = screen.getByRole('link', { name: 'France' });
    const href = france.getAttribute('href')!;
    expect(href).toContain('country=France');
    expect(href).not.toContain('region=');
    expect(href).not.toContain('subregion=');
    expect(href).toContain('group=Wine'); // other strand preserved
  });

  it('Clear all preserves non-drill params like price', () => {
    render(<DrillBreadcrumb params={{ group: 'Wine', price: 'under-1000' }} pathname="/shop" />);
    const clear = screen.getByRole('link', { name: /clear all/i });
    const href = clear.getAttribute('href')!;
    expect(href).toContain('price=under-1000');
    expect(href).not.toContain('group=');
  });
});
