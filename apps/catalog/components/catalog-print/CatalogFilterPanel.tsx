'use client';

import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import styles from './catalog-filter-panel.module.css';

interface CatalogFilterPanelProps {
  countries: { name: string; count: number }[];
  resultCount: number;
}

/**
 * Pre-print narrowing UI. Writes selections to the URL as query params
 * (?country=France&country=Italy&minPrice=&maxPrice=&scoreOnly=1) so a
 * filtered selection is bookmarkable/shareable and reprintable later —
 * the page itself reads searchParams server-side and re-filters rows,
 * this component only edits the URL.
 */
export function CatalogFilterPanel({ countries, resultCount }: CatalogFilterPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const selectedCountries = new Set(searchParams.getAll('country'));
  const minPrice = searchParams.get('minPrice') ?? '';
  const maxPrice = searchParams.get('maxPrice') ?? '';
  const scoreOnly = searchParams.get('scoreOnly') === '1';
  const activeCount =
    selectedCountries.size + (minPrice ? 1 : 0) + (maxPrice ? 1 : 0) + (scoreOnly ? 1 : 0);

  function apply(next: URLSearchParams) {
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function toggleCountry(name: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('country');
    const nextSet = new Set(selectedCountries);
    if (nextSet.has(name)) nextSet.delete(name);
    else nextSet.add(name);
    for (const c of nextSet) next.append('country', c);
    apply(next);
  }

  function setPrice(key: 'minPrice' | 'maxPrice', value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    apply(next);
  }

  function toggleScoreOnly() {
    const next = new URLSearchParams(searchParams.toString());
    if (scoreOnly) next.delete('scoreOnly');
    else next.set('scoreOnly', '1');
    apply(next);
  }

  function clearAll() {
    router.push(pathname);
  }

  return (
    <>
      <div className={styles.wrap}>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="catalog-filter-panel"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 6h16M7 12h10M10 18h4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Filter before printing
          {activeCount > 0 && <span className={styles.badge}>{activeCount}</span>}
          <svg className={styles.chevron} width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={styles.count}>{resultCount.toLocaleString()} items</span>
        </button>
      </div>

      {open && (
        <div className={styles.panelWrap}>
          <div className={styles.panel} id="catalog-filter-panel">
            <div className={styles.group}>
              <span className={styles.label}>Price range (THB)</span>
              <div className={styles.priceRow}>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Min"
                  defaultValue={minPrice}
                  onBlur={(e) => setPrice('minPrice', e.target.value)}
                  className={styles.priceInput}
                  aria-label="Minimum price"
                />
                <span className={styles.dash}>–</span>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Max"
                  defaultValue={maxPrice}
                  onBlur={(e) => setPrice('maxPrice', e.target.value)}
                  className={styles.priceInput}
                  aria-label="Maximum price"
                />
              </div>
            </div>

            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={scoreOnly} onChange={toggleScoreOnly} />
              Has critic score only
            </label>

            {countries.length > 1 && (
              <div className={styles.group}>
                <span className={styles.label}>Country</span>
                <div className={styles.countryGrid}>
                  {countries.map((c) => (
                    <label key={c.name} className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={selectedCountries.has(c.name)}
                        onChange={() => toggleCountry(c.name)}
                      />
                      {c.name}
                      <span className={styles.countryCount}>{c.count.toLocaleString()}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {activeCount > 0 && (
              <button type="button" className={styles.clear} onClick={clearAll}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
