'use client';
// Stage 4: Review Queue — approve / edit / skip AI enrichment results before publish.
import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Edit2, SkipForward, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type EnrichmentRecord = {
  product_id: string;
  sku: string;
  sku_base: string;
  name: string;
  classification: string;
  desc_confidence: number;
  status: 'pending_review' | 'approved' | 'skipped' | 'published';
  manual_edited?: boolean;
  // Loaded from the enrichment result JSON — set by run-ai-enrichment.ts when it reads desc_source from Supabase
  original_desc_source?: string | null;
  result: Record<string, any>;
  original: { short_description_en: string | null; description_en_text: string | null };
  processed_at: string;
};

type FilterState = {
  category: string;
  confidence: 'all' | 'high' | 'medium' | 'low';
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function confBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.85) return 'high';
  if (score >= 0.70) return 'medium';
  return 'low';
}

const CONF_COLORS: Record<string, string> = {
  high:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  low:    'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

// ── Subcomponents ─────────────────────────────────────────────────────────────

function ConfBadge({ score }: { score: number }) {
  const band = confBand(score);
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${CONF_COLORS[band]}`}>
      {(score * 100).toFixed(0)}%
    </span>
  );
}

function DescriptionPreview({ html, label }: { html: string | null; label: string }) {
  const [show, setShow] = useState(false);
  if (!html) return <p className="text-slate-500 text-xs italic">—</p>;
  return (
    <div>
      <button onClick={() => setShow(v => !v)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mb-1">
        {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {label}
      </button>
      {show && (
        <div
          className="text-xs text-slate-300 prose prose-invert prose-sm max-w-none border border-white/10 rounded p-3 bg-black/20"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

function ProductCard({
  record,
  onApprove,
  onSkip,
  onEdit,
}: {
  record: EnrichmentRecord;
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
  onEdit: (id: string, field: 'desc_en_short' | 'desc_en_full', value: string) => void;
}) {
  const [editingShort, setEditingShort] = useState(false);
  const [editingFull, setEditingFull] = useState(false);
  const [shortVal, setShortVal] = useState(record.result.desc_en_short ?? '');
  const [fullVal, setFullVal] = useState(record.result.desc_en_full ?? '');

  const isManual = record.manual_edited === true;
  const statusColors: Record<string, string> = {
    approved: 'border-emerald-500/40',
    skipped:  'border-slate-600/40 opacity-60',
    pending_review: 'border-white/10',
  };

  return (
    <div className={`bg-white/5 border rounded-xl p-5 mb-4 ${statusColors[record.status] ?? 'border-white/10'}`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-sm font-medium text-white">{record.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{record.sku} · {record.classification}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isManual && <span className="text-xs px-2 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/30">manual</span>}
          <ConfBadge score={record.desc_confidence} />
        </div>
      </div>

      {/* Before / After descriptions */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">Before (original)</p>
          <p className="text-xs text-slate-400 line-clamp-3">{record.original.short_description_en ?? <em>—</em>}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">After (AI)</p>
          {editingShort ? (
            <div>
              <textarea
                value={shortVal}
                onChange={e => setShortVal(e.target.value)}
                className="w-full h-20 bg-black/40 border border-white/20 rounded p-2 text-xs text-slate-200 font-mono resize-y"
              />
              <button
                onClick={() => { onEdit(record.product_id, 'desc_en_short', shortVal); setEditingShort(false); }}
                className="text-xs text-emerald-400 hover:text-emerald-300 mr-2"
              >Save</button>
              <button onClick={() => setEditingShort(false)} className="text-xs text-slate-500 hover:text-slate-400">Cancel</button>
            </div>
          ) : (
            <div>
              <p className="text-xs text-slate-300">{record.result.desc_en_short}</p>
              <button onClick={() => setEditingShort(true)} className="text-xs text-violet-400 hover:text-violet-300 mt-1 flex items-center gap-1">
                <Edit2 size={10} /> Edit short
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Full description preview / editor */}
      <div className="mb-4">
        <DescriptionPreview html={record.result.desc_en_full} label="Full description preview" />
        <button onClick={() => setEditingFull(v => !v)} className="text-xs text-violet-400 hover:text-violet-300 mt-1 flex items-center gap-1">
          <Edit2 size={10} /> {editingFull ? 'Close editor' : 'Edit HTML'}
        </button>
        {editingFull && (
          <div className="mt-2">
            <textarea
              value={fullVal}
              onChange={e => setFullVal(e.target.value)}
              className="w-full h-48 bg-black/40 border border-white/20 rounded p-2 text-xs text-slate-200 font-mono resize-y"
            />
            <button
              onClick={() => { onEdit(record.product_id, 'desc_en_full', fullVal); setEditingFull(false); }}
              className="text-xs text-emerald-400 hover:text-emerald-300 mr-2"
            >Save</button>
            <button onClick={() => setEditingFull(false)} className="text-xs text-slate-500 hover:text-slate-400">Cancel</button>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {record.status === 'pending_review' && (
        <div className="flex gap-2">
          <button
            onClick={() => onApprove(record.product_id)}
            className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <Check size={12} /> Approve
          </button>
          <button
            onClick={() => onSkip(record.product_id)}
            className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/15 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <SkipForward size={12} /> Skip
          </button>
        </div>
      )}
      {record.status === 'approved' && (
        <span className="text-xs text-emerald-400 flex items-center gap-1"><Check size={12} /> Approved</span>
      )}
      {record.status === 'skipped' && (
        <span className="text-xs text-slate-500 flex items-center gap-1"><X size={12} /> Skipped</span>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AIReviewQueuePage() {
  const [records, setRecords] = useState<EnrichmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>({ category: 'all', confidence: 'all' });
  const [publishing, setPublishing] = useState(false);
  const [publishOutput, setPublishOutput] = useState('');
  const [loadError, setLoadError] = useState('');

  async function loadResults() {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/ai-enrichment/results');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      // Sort by confidence ascending (lowest confidence first)
      const sorted = (data.records ?? []).sort((a: EnrichmentRecord, b: EnrichmentRecord) =>
        a.desc_confidence - b.desc_confidence
      );
      setRecords(sorted);
    } catch (e: any) {
      setLoadError(e.message ?? 'Failed to load results');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadResults(); }, []);

  function handleApprove(id: string) {
    setRecords(rs => rs.map(r => r.product_id === id ? { ...r, status: 'approved' } : r));
  }

  function handleSkip(id: string) {
    setRecords(rs => rs.map(r => r.product_id === id ? { ...r, status: 'skipped' } : r));
  }

  function handleEdit(id: string, field: 'desc_en_short' | 'desc_en_full', value: string) {
    setRecords(rs => rs.map(r =>
      r.product_id === id
        ? { ...r, manual_edited: true, result: { ...r.result, [field]: value } }
        : r
    ));
  }

  // A record is "manually protected" if it was edited in this session OR it had
  // desc_source = 'manual' in Supabase before AI processing (pre-existing manual content).
  function isManuallyProtected(r: EnrichmentRecord): boolean {
    return r.manual_edited === true || r.original_desc_source === 'manual';
  }

  function handleApproveHighConfidence() {
    setRecords(rs => rs.map(r =>
      r.status === 'pending_review' && confBand(r.desc_confidence) === 'high' && !isManuallyProtected(r)
        ? { ...r, status: 'approved' }
        : r
    ));
  }

  function handleApproveAll() {
    setRecords(rs => rs.map(r =>
      r.status === 'pending_review' && !isManuallyProtected(r) ? { ...r, status: 'approved' } : r
    ));
  }

  async function handlePublish() {
    const approvedIds = records.filter(r => r.status === 'approved').map(r => r.product_id);
    if (approvedIds.length === 0) { setPublishOutput('No approved records to publish.'); return; }

    setPublishing(true);
    setPublishOutput('Publishing…');
    try {
      const res = await fetch('/api/ai-enrichment/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: approvedIds }),
      });
      const data = await res.json();
      const msg = [
        `Published: ${data.published}`,
        data.primaryFailed.length > 0 ? `Primary failures: ${data.primaryFailed.length}` : '',
        data.variantSyncFailed.length > 0 ? `Variant sync failures: ${data.variantSyncFailed.length}` : '',
      ].filter(Boolean).join(' | ');
      setPublishOutput(msg);
      if (data.ok) {
        setRecords(rs => rs.map(r => approvedIds.includes(r.product_id) ? { ...r, status: 'published' } : r));
      }
    } catch (e) {
      setPublishOutput(String(e));
    } finally {
      setPublishing(false);
    }
  }

  // ── Filtering ──
  const categories = ['all', ...Array.from(new Set(records.map(r => r.classification))).sort()];
  const filtered = records.filter(r => {
    if (filter.category !== 'all' && r.classification !== filter.category) return false;
    if (filter.confidence !== 'all' && confBand(r.desc_confidence) !== filter.confidence) return false;
    return true;
  });

  const pendingCount  = records.filter(r => r.status === 'pending_review').length;
  const approvedCount = records.filter(r => r.status === 'approved').length;
  const skippedCount  = records.filter(r => r.status === 'skipped').length;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (loadError) return (
    <div className="p-6 text-rose-400 text-sm">
      Failed to load enrichment results: {loadError}
      <button onClick={loadResults} className="ml-3 text-xs underline text-slate-400 hover:text-slate-200">Retry</button>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white mb-1">AI Review Queue</h1>
        <p className="text-sm text-slate-400">Review AI-generated descriptions and taxonomy before publishing to Supabase.</p>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-6">
        {[
          { label: 'Pending', count: pendingCount, color: 'text-amber-300' },
          { label: 'Approved', count: approvedCount, color: 'text-emerald-300' },
          { label: 'Skipped', count: skippedCount, color: 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center min-w-[100px]">
            <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button onClick={handleApproveHighConfidence} className="text-xs bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors">
          Approve all high-confidence (≥85%)
        </button>
        <button onClick={handleApproveAll} className="text-xs bg-white/10 hover:bg-white/15 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
          Approve all
        </button>
        <button
          onClick={handlePublish}
          disabled={publishing || approvedCount === 0}
          className="text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors ml-auto"
        >
          {publishing ? 'Publishing…' : `Publish ${approvedCount} approved`}
        </button>
      </div>

      {publishOutput && (
        <div className="bg-black/20 border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-300 mb-5">
          {publishOutput}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <select
          value={filter.category}
          onChange={e => setFilter(f => ({ ...f, category: e.target.value }))}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300"
        >
          {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
        </select>
        <select
          value={filter.confidence}
          onChange={e => setFilter(f => ({ ...f, confidence: e.target.value as any }))}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300"
        >
          <option value="all">All confidence</option>
          <option value="low">Low (&lt;70%)</option>
          <option value="medium">Medium (70–84%)</option>
          <option value="high">High (≥85%)</option>
        </select>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-16">No results match the current filter.</p>
      ) : (
        filtered.map(r => (
          <ProductCard
            key={r.product_id}
            record={r}
            onApprove={handleApprove}
            onSkip={handleSkip}
            onEdit={handleEdit}
          />
        ))
      )}
    </div>
  );
}
