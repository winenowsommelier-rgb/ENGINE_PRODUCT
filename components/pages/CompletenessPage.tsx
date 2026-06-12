'use client';
import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';

type FieldStat = { key: string; label: string; filled: number; missing: number; pct: number };
type CategoryStat = { name: string; total: number; descPct: number; imagePct: number; tastePct: number };
type Data = { total: number; fields: FieldStat[]; categories: CategoryStat[] };

function PctBadge({ pct, label }: { pct: number; label?: string }) {
  const cls = pct >= 80 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-rose-400';
  const bar = pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2 flex-1">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ? `${label} coverage` : `${pct}% coverage`}
        className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden"
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold w-9 text-right ${cls}`}>{pct}%</span>
    </div>
  );
}

export function CompletenessPage() {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => { fetch('/api/products/completeness').then(r => r.json()).then(setData).catch(() => {}); }, []);

  if (!data) return <div role="status" aria-live="polite" className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading...</div>;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 size={20} className="text-violet-400" />
          <h1 className="text-lg font-semibold text-white">Enrichment Completeness</h1>
        </div>
        <p className="text-sm text-slate-500">Field coverage across {data.total.toLocaleString()} products</p>
      </div>

      {/* Field coverage */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-semibold text-slate-300">Field Coverage</h2>
        </div>
        <div className="divide-y divide-white/5">
          {data.fields.map(f => (
            <div key={f.key} className="px-4 py-2.5 flex items-center gap-4">
              <span className="text-xs text-slate-400 w-40 shrink-0">{f.label}</span>
              <PctBadge pct={f.pct} label={f.label} />
              <span className="text-[11px] text-slate-500 w-24 text-right shrink-0">{f.filled.toLocaleString()} / {(f.filled + f.missing).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* By category */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-semibold text-slate-300">By Category</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-500">
                <th scope="col" className="px-4 py-2 text-left font-medium">Category</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Total</th>
                <th scope="col" className="px-4 py-2 text-right font-medium" title="Description coverage">Desc</th>
                <th scope="col" className="px-4 py-2 text-right font-medium" title="Image coverage">Image</th>
                <th scope="col" className="px-4 py-2 text-right font-medium" title="Taste profile coverage">Taste</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.categories.map(c => (
                <tr key={c.name} className="hover:bg-white/5">
                  <td className="px-4 py-2 text-slate-300">{c.name}</td>
                  <td className="px-4 py-2 text-right text-slate-400">{c.total.toLocaleString()}</td>
                  {[c.descPct, c.imagePct, c.tastePct].map((pct, i) => {
                    const cls = pct >= 80 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-rose-400';
                    return <td key={i} className={`px-4 py-2 text-right font-semibold ${cls}`}>{pct}%</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
