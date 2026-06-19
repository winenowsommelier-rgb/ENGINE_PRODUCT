import { render, screen, fireEvent } from '@testing-library/react';
import { SearchableSelect } from '../SearchableSelect';

// NOTE: this project does not ship @testing-library/user-event, so we drive the
// component with fireEvent (the same primitive the existing ui-primitives test
// uses). Both required behaviors are covered: type-to-filter + click-select, and
// the Enter-no-exact-match free-type fallback.

beforeAll(() => {
  // cmdk wires these on mount; jsdom implements neither.
  if (!(global as any).ResizeObserver)
    (global as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

it('filters options as you type and calls onSelect with the chosen value', async () => {
  const onSelect = vi.fn();
  render(
    <SearchableSelect
      label="Grape"
      value=""
      options={['Pinot Noir', 'Merlot', 'Syrah']}
      onSelect={onSelect}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /grape/i }));
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'mer' } });
  // cmdk filters its list to the matching item; non-matches are removed.
  expect(screen.queryByText('Syrah')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByText('Merlot'));
  expect(onSelect).toHaveBeenCalledWith('Merlot');
});

it('Enter on a free-typed query that has no exact match selects the raw query (blend fallback)', () => {
  const onSelect = vi.fn();
  render(
    <SearchableSelect
      label="Grape"
      value=""
      options={['Pinot Noir']}
      onSelect={onSelect}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /grape/i }));
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'Touriga' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledWith('Touriga');
});
