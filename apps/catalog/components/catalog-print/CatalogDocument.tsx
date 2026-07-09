import type { CatalogGroup, CatalogRow } from '@/lib/catalog-print';
import styles from './catalog-print.module.css';

export type CatalogEdition = 'b2c' | 'b2b';

interface CatalogDocumentProps {
  edition: CatalogEdition;
  editionLabel: string;
  dateLabel: string;
  groups: CatalogGroup[];
  totalCount: number;
}

function money(v: number | undefined) {
  if (v === undefined || v === null) return null;
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

interface CriticEntry {
  abbr?: string;
  score_native?: string;
  score_value?: number;
}

function CriticPills({ scoreSummary }: { scoreSummary?: string }) {
  if (!scoreSummary) return <span className={styles.noscore}>—</span>;
  let critics: CriticEntry[] = [];
  try {
    const parsed = JSON.parse(scoreSummary) as { critics?: CriticEntry[] };
    critics = parsed.critics ?? [];
  } catch {
    return <span className={styles.noscore}>—</span>;
  }
  if (critics.length === 0) return <span className={styles.noscore}>—</span>;
  return (
    <>
      {critics.slice(0, 3).map((c, i) => {
        const val = c.score_native ?? c.score_value;
        return (
          <span className={styles.pill} key={i}>
            <b>{c.abbr}</b>
            {val}
          </span>
        );
      })}
    </>
  );
}

const YEAR_RE = /^(19|20)\d\d$/;

function subline(row: CatalogRow) {
  const bits: string[] = [row.sku];
  const v = row.vintage?.trim();
  if (v && YEAR_RE.test(v)) bits.push(v);
  const bs = row.bottleSize?.trim();
  if (bs) bits.push(bs);
  const variety = row.variety?.trim();
  if (variety && variety.length <= 34) bits.push(variety);
  return bits;
}

function displayName(name: string) {
  return name
    .replace(/\s*\((?:\d+(?:\.\d+)?\s*(?:ml|cl|L)\.?)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ProductRow({ row, edition }: { row: CatalogRow; edition: CatalogEdition }) {
  const sub = subline(row);
  return (
    <tr>
      <td className={styles.cThumb}>
        <span className={styles.thumb}>
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- print document, not the live storefront image pipeline
            <img src={row.imageUrl} alt="" loading="lazy" />
          ) : (
            <svg className={styles.ph} viewBox="0 0 96 40" xmlns="http://www.w3.org/2000/svg">
              <g fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.45">
                <path d="M6 20h12v-4h4c3 0 6 1 10 1h44a6 6 0 0 1 0 11H32c-4 0-7 1-10 1h-4v-4H6z" transform="translate(0,-4)" />
              </g>
            </svg>
          )}
        </span>
      </td>
      <td className={styles.cItem}>
        <span className={styles.pname}>{displayName(row.name)}</span>
        <span className={styles.pmeta}>
          {sub.map((b, i) => (
            <span key={i}>
              {i > 0 && <span className={styles.dot}>·</span>}
              <span className={i === 0 ? styles.sku : undefined}>{b}</span>
            </span>
          ))}
        </span>
      </td>
      <td className={styles.cScore}>
        <CriticPills scoreSummary={row.scoreSummary} />
      </td>
      {edition === 'b2c' ? (
        <>
          <td className={`${styles.num} ${row.specialPrice ? styles.strike : ''}`}>{money(row.price)}</td>
          <td className={`${styles.num} ${row.specialPrice ? styles.promo : styles.none}`}>
            {money(row.specialPrice) ?? '—'}
          </td>
        </>
      ) : (
        <>
          <td className={`${styles.num} ${styles.retail}`}>{money(row.price)}</td>
          <td className={`${styles.num} ${row.b2bPrice ? styles.trade : styles.none}`}>
            {money(row.b2bPrice) ?? '—'}
          </td>
          <td className={`${styles.num} ${styles.disc}`}>
            {row.b2bDiscountPct
              ? `${Math.round(parseFloat(row.b2bDiscountPct))}%`
              : row.b2bPrice && row.price
                ? `${Math.round((1 - row.b2bPrice / row.price) * 100)}%`
                : '—'}
          </td>
        </>
      )}
    </tr>
  );
}

function TableHead({ edition }: { edition: CatalogEdition }) {
  return (
    <thead>
      <tr>
        <th className={styles.cThumb}></th>
        <th className={styles.cItem}>Item</th>
        <th className={styles.cScore}>Critic scores</th>
        {edition === 'b2c' ? (
          <>
            <th className={styles.num}>
              Price <i>THB</i>
            </th>
            <th className={styles.num}>
              Promo <i>THB</i>
            </th>
          </>
        ) : (
          <>
            <th className={styles.num}>
              Retail <i>THB</i>
            </th>
            <th className={styles.num}>
              B2B <i>THB</i>
            </th>
            <th className={styles.num}>Disc.</th>
          </>
        )}
      </tr>
    </thead>
  );
}

export function CatalogDocument({ edition, editionLabel, dateLabel, groups, totalCount }: CatalogDocumentProps) {
  return (
    <div className={styles.root} data-edition={edition}>
      <div className={styles.paper}>
        <div className={styles.cover}>
          <div className={styles.top}>
            <small>Wine-Now · LIQ9</small>
            <div className={styles.lines}></div>
          </div>
          <div className={styles.mid}>
            <h1 className={styles.word}>WNLQ9</h1>
            <p className={styles.catWord}>Catalog</p>
            <span className={styles.edition}>{editionLabel}</span>
            <p className={styles.date}>{dateLabel} · Prices in THB incl. VAT</p>
          </div>
          <div className={styles.foot}>
            <div className={styles.lines}></div>
            Fine Wine &amp; Spirits · Bangkok
          </div>
        </div>

        <div className={styles.inner}>
          <div className={styles.contents}>
            <h2>Contents</h2>
            <p className={styles.sub}>Country · Region · Sub-region — {totalCount.toLocaleString()} items</p>
            {groups.map((g) => (
              <div className={styles.tocGroup} key={g.name}>
                <h3>{g.name}</h3>
                {g.countries.map((c) => (
                  <div className={styles.tocCountry} key={c.name}>
                    <h4>{c.name}</h4>
                    <ul>
                      {c.regions.map((r) => (
                        <li key={r.name}>
                          <span>{r.name}</span>
                          <span className={styles.leader}></span>
                          <span className={styles.cnt}>{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {groups.map((g) =>
            g.countries.map((c) => (
              <section className={styles.countrySection} key={`${g.name}-${c.name}`}>
                <header className={styles.countryHead}>
                  <span className={styles.kicker}>{g.name}</span>
                  <h2>{c.name}</h2>
                  <span className={styles.rule}></span>
                </header>
                {c.regions.map((r) => (
                  <div className={styles.regionBlock} key={r.name}>
                    <h3 className={styles.region}>{r.name}</h3>
                    {r.subregions.map((s) => (
                      <div key={s.name ?? '__none__'}>
                        {s.name && <h4 className={styles.subregion}>{s.name}</h4>}
                        <table className={styles.plist}>
                          <TableHead edition={edition} />
                          <tbody>
                            {s.rows.map((row) => (
                              <ProductRow row={row} edition={edition} key={row.sku} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            )),
          )}

          <div className={styles.legend}>
            <span>
              <b>Promo</b> — current promotional price
            </span>
            <span>JS James Suckling · WS Wine Spectator · WA Wine Advocate · WE Wine Enthusiast</span>
            <span>Prices THB · E&amp;OE · valid while stocks last</span>
          </div>
        </div>
      </div>
    </div>
  );
}
