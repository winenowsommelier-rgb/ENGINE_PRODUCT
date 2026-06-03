'use client';
import { useState } from 'react';

interface CurationProduct {
  rank: number;
  sku: string;
  name: string;
  score: number;
  rationale: string;
  contraindication: boolean;
  matched_rules: string[];
}

interface CurationResult {
  brief: string;
  resolved_query: {
    category_filter: string[];
    country_filter: string[];
    pairing_context: string | null;
    in_stock_only: boolean;
    output_size: number;
  };
  candidate_count: number;
  products: CurationProduct[];
  run_time_s: number;
  llm_cost_usd: number;
}

export default function CurationPage() {
  const [brief, setBrief] = useState('');
  const [result, setResult] = useState<CurationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  async function handleRun() {
    if (!brief.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setApproved(new Set());
    setSkipped(new Set());
    try {
      const res = await fetch('/api/curation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function toggle(sku: string, list: Set<string>, setter: (s: Set<string>) => void) {
    const next = new Set(list);
    next.has(sku) ? next.delete(sku) : next.add(sku);
    setter(next);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Curation Engine</h1>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Curation Brief</label>
        <textarea
          className="w-full border rounded-lg p-3 text-sm font-mono h-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder='e.g. "Best USA wine collection this year" or "Whisky pairing with Thai food, 90pts+"'
          value={brief}
          onChange={e => setBrief(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleRun(); }}
        />
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          onClick={handleRun}
          disabled={loading || !brief.trim()}
        >
          {loading ? 'Running…' : 'Run Curation'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="bg-gray-50 border rounded-lg p-4 text-sm text-gray-600 space-y-1">
            <div><span className="font-medium">Brief resolved:</span> {result.resolved_query.category_filter.join(', ') || 'all categories'} &middot; {result.resolved_query.country_filter.join(', ') || 'all countries'} &middot; {result.candidate_count} candidates</div>
            {result.resolved_query.pairing_context && <div><span className="font-medium">Pairing:</span> {result.resolved_query.pairing_context}</div>}
            <div><span className="font-medium">Run time:</span> {result.run_time_s}s &middot; <span className="font-medium">LLM cost:</span> ${result.llm_cost_usd.toFixed(2)} (Ollama)</div>
          </div>

          <div className="space-y-3">
            {result.products.map(p => {
              const isApproved = approved.has(p.sku);
              const isSkipped = skipped.has(p.sku);
              return (
                <div
                  key={p.sku}
                  className={`border rounded-lg p-4 space-y-2 ${isApproved ? 'border-green-400 bg-green-50' : isSkipped ? 'border-gray-300 bg-gray-50 opacity-60' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-gray-400">#{p.rank}</span>
                      <div>
                        <span className="font-semibold text-gray-900">{p.name}</span>
                        <span className="ml-2 text-xs text-gray-400">{p.sku}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-bold ${p.score >= 80 ? 'text-green-600' : p.score >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>{p.score}/100</span>
                      {p.contraindication && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">&#9888; Contraindication</span>
                      )}
                    </div>
                  </div>
                  <p className="text-sm italic text-gray-700">&ldquo;{p.rationale}&rdquo;</p>
                  {p.matched_rules.length > 0 && (
                    <div className="text-xs text-gray-400">Rules: {p.matched_rules.join(', ')}</div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      className={`px-3 py-1 text-xs rounded font-medium ${isApproved ? 'bg-green-600 text-white' : 'bg-white border border-green-500 text-green-700 hover:bg-green-50'}`}
                      onClick={() => toggle(p.sku, approved, setApproved)}
                    >
                      {isApproved ? '✓ Approved' : 'Approve'}
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded font-medium ${isSkipped ? 'bg-gray-500 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                      onClick={() => toggle(p.sku, skipped, setSkipped)}
                    >
                      {isSkipped ? 'Skipped' : 'Skip'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
              onClick={() => setApproved(new Set(result.products.map(p => p.sku)))}
            >
              Approve All
            </button>
            <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              Export Collection (coming Phase 3)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
