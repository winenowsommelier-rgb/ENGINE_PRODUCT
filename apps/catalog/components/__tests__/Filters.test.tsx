import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Filters } from '../Filters';

// Filters calls useRouter/usePathname on render; jsdom has no Next app router
// mounted, so we stub next/navigation. useSearchParams returns an empty set so
// the component falls back to initialParams (its documented standalone path).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/shop',
  useSearchParams: () => new URLSearchParams(''),
}));

// jsdom polyfills for Radix Select / cmdk (same pattern as ui-primitives.test.tsx).
beforeAll(() => {
  if (!(global as any).ResizeObserver)
    (global as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!(global as any).PointerEvent) (global as any).PointerEvent = class extends Event {} as any;
  // Radix Select uses hasPointerCapture/releasePointerCapture
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const base = {
  countries: ['France'],
  availableSubCategories: [] as { value: string; count: number }[],
  availableRegions: [] as { value: string; count: number }[],
  availableSubRegions: [] as { value: string; count: number }[],
  grapeOptions: [] as string[],
  flavorOptions: [] as string[],
  bodyOptions: ['Light', 'Medium', 'Medium-Full', 'Full'],
  acidityOptions: ['Low', 'Medium', 'Medium-High', 'High'],
  tanninOptions: ['Low', 'Medium', 'Medium-High', 'High'],
};

it('shows sub-category chips with counts when a group is active', () => {
  render(<Filters {...base} availableSubCategories={[{ value: 'Red Wine', count: 12 }]} initialParams={{ group: 'Wine' }} />);
  expect(screen.getByRole('button', { name: /Red Wine/ })).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
});

it('does NOT show a sub-category row when no group is selected', () => {
  render(<Filters {...base} availableSubCategories={[{ value: 'Red Wine', count: 12 }]} initialParams={{}} />);
  expect(screen.queryByRole('button', { name: /Red Wine/ })).not.toBeInTheDocument();
});

it('does NOT show a region row when no country is selected', () => {
  render(<Filters {...base} availableRegions={[{ value: 'Bordeaux', count: 5 }]} initialParams={{}} />);
  expect(screen.queryByRole('button', { name: /Bordeaux/ })).not.toBeInTheDocument();
});

it('shows region chips when a country is active', () => {
  render(<Filters {...base} availableRegions={[{ value: 'Bordeaux', count: 5 }]} initialParams={{ country: 'France' }} />);
  expect(screen.getByRole('button', { name: /Bordeaux/ })).toBeInTheDocument();
});

it('shows sub-region chips when a region is active', () => {
  render(<Filters {...base} availableSubRegions={[{ value: 'Pauillac', count: 3 }]} initialParams={{ country: 'France', region: 'Bordeaux' }} />);
  expect(screen.getByRole('button', { name: /Pauillac/ })).toBeInTheDocument();
});
