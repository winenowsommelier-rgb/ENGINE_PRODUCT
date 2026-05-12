'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Database, Filter, Loader2, RefreshCw, Search } from 'lucide-react';

type WineSensedRecord = {
  id: string;
  vintage_id: number | null;
  review: string | null;
  year: number | null;
  wine_alcohol: number | null;
  country: string | null;
  region: string | null;
  price: number | null;
  rating: number | null;
  grape: string | null;
  review_language_hint: string;
};

type WineSensedSummary = {
  imported_at: string;
  source_file: string;
  imported_rows: number;
  rows_with_review: number;
  rows_with_country: number;
  rows_with_region: number;
  rows_with_grape: number;
  rows_with_rating: number;
  top_countries: Array<{ name: string; count: number }>;
  top_grapes: Array<{ name: string; count: number }>;
  top_regions: Array<{ name: string; count: number }>;
};

type ResearchResponse = {
  summary: WineSensedSummary | null;
  records: WineSensedRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  license_warning: string;
};

type GeographyEvidenceRow = {
  id: string;
  observed_name: string;
  observed_country: string | null;
  evidence_count: number;
  review_count: number;
  avg_rating: number | null;
  top_grapes: Array<{ name: string; count: number }>;
  matched_entity_type: string | null;
  matched_entity_name: string | null;
  match_status: 'matched' | 'ambiguous' | 'needs_classification';
  suggested_target_type: string;
  curation?: {
    status: string;
    reviewer: string;
    notes: string;
    source_urls: string[];
    confirmed_name: string | null;
    confirmed_parent_name: string | null;
    promoted_entity_id?: number | null;
    updated_at: string;
  };
};

type GeographyEvidenceResponse = {
  summary: {
    generated_at: string;
    source_records: number;
    evidence_rows: number;
    matched: number;
    ambiguous: number;
    needs_classification: number;
    by_suggested_type: Record<string, number>;
  } | null;
  evidence: GeographyEvidenceRow[];
  total: number;
};

type GeographyCandidateResponse = {
  summary: {
    confirmed_evidence_rows: number;
    candidate_rows: number;
    by_field: Record<string, number>;
    write_policy: string;
    next_step: string;
  };
  candidates: Array<{
    sku: string;
    name: string;
    field_name: string;
    old_value: string;
    new_value: string;
    match_reason: string;
  }>;
};

type AuthorityCandidate = {
  id: string;
  sku: string;
  sku_tier: string | null;
  sales_tier: 'S1' | 'S2' | 'S3';
  price_tier: string | null;
  product_name: string;
  brand: string | null;
  country: string | null;
  classification: string | null;
  grape_variety: string | null;
  missing_fields: string[];
  suggested_next_field: string;
  winesensed_signals: Array<{
    observed_name: string;
    suggested_target_type: string;
    evidence_count: number;
    curation_status: string;
    top_grapes: Array<{ name: string; count: number }>;
  }>;
  decision?: {
    status: string;
    authority_urls: string[];
    authority_notes: string;
    validated_value: string | null;
    validated_field: string | null;
    confidence: string | null;
    updated_at: string;
  };
};

type AuthorityResponse = {
  summary: {
    total_candidates: number;
    filtered_candidates: number;
    by_status: Record<string, number>;
    by_missing_field: Record<string, number>;
    by_sku_tier: Record<string, number>;
    by_sales_tier: Record<string, number>;
    by_price_tier: Record<string, number>;
  };
  candidates: AuthorityCandidate[];
};

type AuthorityProductCandidateResponse = {
  summary: {
    approved_decisions: number;
    ready_rows: number;
    blocked_rows: number;
    by_field: Record<string, number>;
    write_policy: string;
    next_step: string;
  };
  candidates: Array<{
    candidate_id: string;
    sku: string | null;
    product_name: string | null;
    country: string | null;
    field_name: string | null;
    current_value: string;
    new_value: string | null;
    confidence: string | null;
    authority_urls: string[];
  }>;
  blocked: Array<{
    candidate_id: string;
    sku: string | null;
    product_name: string | null;
    field_name: string | null;
    new_value: string | null;
    blockers: string[];
  }>;
};

export function ResearchLibraryPage() {
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [geoData, setGeoData] = useState<GeographyEvidenceResponse | null>(null);
  const [candidateData, setCandidateData] = useState<GeographyCandidateResponse | null>(null);
  const [authorityData, setAuthorityData] = useState<AuthorityResponse | null>(null);
  const [authorityProductData, setAuthorityProductData] = useState<AuthorityProductCandidateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [geoLoading, setGeoLoading] = useState(true);
  const [authorityLoading, setAuthorityLoading] = useState(true);
  const [q, setQ] = useState('');
  const [geoQ, setGeoQ] = useState('');
  const [geoStatus, setGeoStatus] = useState('needs_classification');
  const [curationStatus, setCurationStatus] = useState('');
  const [savingCuration, setSavingCuration] = useState<string | null>(null);
  const [promotionMessage, setPromotionMessage] = useState<Record<string, string>>({});
  const [authorityQ, setAuthorityQ] = useState('');
  const [authorityStatus, setAuthorityStatus] = useState('new');
  const [authorityField, setAuthorityField] = useState('region');
  const [authoritySalesTier, setAuthoritySalesTier] = useState('S1');
  const [savingAuthority, setSavingAuthority] = useState<string | null>(null);
  const [country, setCountry] = useState('');
  const [grape, setGrape] = useState('');
  const [hasReview, setHasReview] = useState(true);

  const fetchData = useCallback(async function () {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (country.trim()) params.set('country', country.trim());
    if (grape.trim()) params.set('grape', grape.trim());
    if (hasReview) params.set('has_review', 'true');
    params.set('limit', '50');

    try {
      const res = await fetch(`/api/research-library/winesensed?${params}`, { cache: 'no-store' });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [q, country, grape, hasReview]);

  const fetchGeoData = useCallback(async function () {
    setGeoLoading(true);
    const params = new URLSearchParams();
    if (geoQ.trim()) params.set('q', geoQ.trim());
    if (geoStatus) params.set('status', geoStatus);
    if (curationStatus) params.set('curation_status', curationStatus);
    params.set('limit', '80');

    try {
      const res = await fetch(`/api/research-library/geography-evidence?${params}`, { cache: 'no-store' });
      setGeoData(await res.json());
    } finally {
      setGeoLoading(false);
    }
  }, [geoQ, geoStatus, curationStatus]);

  async function updateCuration(row: GeographyEvidenceRow, patch: Record<string, any>) {
    setSavingCuration(row.id);
    try {
      await fetch('/api/research-library/geography-evidence', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidence_id: row.id,
          reviewer: 'pim-review',
          ...patch,
        }),
      });
      await fetchGeoData();
    } finally {
      setSavingCuration(null);
    }
  }

  async function promote(row: GeographyEvidenceRow, apply: boolean) {
    setSavingCuration(row.id);
    try {
      const res = await fetch('/api/research-library/geography-evidence/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidence_id: row.id, apply }),
      });
      const data = await res.json();
      const blockers = data.preview?.blockers ?? [];
      const label = apply ? 'Apply' : 'Dry run';
      setPromotionMessage(prev => ({
        ...prev,
        [row.id]: res.ok
          ? blockers.length > 0
            ? `${label}: blocked - ${blockers.join('; ')}`
            : `${label}: ${data.preview?.action ?? 'ok'} ${data.preview?.confirmed_name ?? ''}`.trim()
          : `${label}: ${data.error ?? 'failed'}`,
      }));
      await fetchGeoData();
    } finally {
      setSavingCuration(null);
    }
  }

  async function fetchCandidates() {
    const res = await fetch('/api/research-library/geography-candidates', { cache: 'no-store' });
    setCandidateData(await res.json());
  }

  async function fetchAuthorityProductCandidates() {
    const res = await fetch('/api/research-library/authority-product-candidates', { cache: 'no-store' });
    setAuthorityProductData(await res.json());
  }

  const fetchAuthorityData = useCallback(async function () {
    setAuthorityLoading(true);
    const params = new URLSearchParams();
    if (authorityQ.trim()) params.set('q', authorityQ.trim());
    if (authorityStatus) params.set('status', authorityStatus);
    if (authorityField) params.set('missing_field', authorityField);
    if (authoritySalesTier) params.set('sales_tier', authoritySalesTier);
    params.set('limit', '80');
    try {
      const res = await fetch(`/api/research-library/authority-validation?${params}`, { cache: 'no-store' });
      setAuthorityData(await res.json());
    } finally {
      setAuthorityLoading(false);
    }
  }, [authorityQ, authorityStatus, authorityField, authoritySalesTier]);

  useEffect(function () {
    const timer = setTimeout(fetchAuthorityData, authorityQ ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchAuthorityData, authorityQ]);

  async function updateAuthority(candidate: AuthorityCandidate, patch: Record<string, any>) {
    setSavingAuthority(candidate.id);
    try {
      await fetch('/api/research-library/authority-validation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: candidate.id,
          reviewer: 'pim-review',
          ...patch,
        }),
      });
      await fetchAuthorityData();
    } finally {
      setSavingAuthority(null);
    }
  }

  useEffect(function () {
    const timer = setTimeout(fetchData, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchData, q]);

  useEffect(function () {
    const timer = setTimeout(fetchGeoData, geoQ ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchGeoData, geoQ]);

  const summary = data?.summary;
  const geoSummary = geoData?.summary;

  return (
    <div className="max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Research Library</h1>
          <p className="mt-1 text-sm text-slate-400">External datasets for internal taxonomy, flavor, and validation research.</p>
        </div>
        <button
          onClick={() => { void fetchData(); void fetchGeoData(); void fetchAuthorityData(); }}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <RefreshCw size={13} className={loading || geoLoading || authorityLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <p className="text-sm font-medium text-amber-100">WineSensed is research-only</p>
            <p className="mt-1 text-xs leading-5 text-amber-100/70">
              The dataset is licensed CC BY-NC-ND 4.0. Do not publish review text, label images, or direct derived copy into customer-facing product pages.
            </p>
          </div>
        </div>
      </div>

      {!summary ? (
        <div className="rounded-lg border border-white/8 bg-white/3 p-6 text-center">
          <Database className="mx-auto mb-3 h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-300">No WineSensed research records imported yet.</p>
          <p className="mt-2 text-xs text-slate-500">
            Download `metadata/wt_session/wt_session.jsonl` into `data/research/`, then run `npm run import:winesensed`.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-white/8 bg-white/3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
              <div>
                <h2 className="text-sm font-medium text-white">Authority Validation Queue</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Missing product geography waits here until an authority source confirms the value.
                </p>
              </div>
              {authorityData && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge label="Candidates" value={authorityData.summary.total_candidates} tone="amber" />
                  <Badge label="Region gaps" value={authorityData.summary.by_missing_field.region ?? 0} tone="rose" />
                  <Badge label="Appellation gaps" value={authorityData.summary.by_missing_field.appellation ?? 0} tone="rose" />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
              <div className="relative min-w-64 flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={authorityQ}
                  onChange={event => setAuthorityQ(event.target.value)}
                  placeholder="Search SKU, product, brand, country, grape"
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-violet-500/50 focus:outline-none"
                />
              </div>
              <select
                value={authorityStatus}
                onChange={event => setAuthorityStatus(event.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500/50 focus:outline-none"
              >
                <option value="new" className="bg-slate-900">New</option>
                <option value="needs_authority_source" className="bg-slate-900">Needs authority source</option>
                <option value="source_found" className="bg-slate-900">Source found</option>
                <option value="approved_for_taxonomy" className="bg-slate-900">Approved for taxonomy</option>
                <option value="approved_for_product_update" className="bg-slate-900">Approved for product update</option>
                <option value="rejected" className="bg-slate-900">Rejected</option>
                <option value="published" className="bg-slate-900">Published</option>
                <option value="" className="bg-slate-900">All statuses</option>
              </select>
              <select
                value={authorityField}
                onChange={event => setAuthorityField(event.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500/50 focus:outline-none"
              >
                <option value="region" className="bg-slate-900">Region first</option>
                <option value="subregion" className="bg-slate-900">Subregion</option>
                <option value="appellation" className="bg-slate-900">Appellation</option>
                <option value="" className="bg-slate-900">All missing fields</option>
              </select>
              <select
                value={authoritySalesTier}
                onChange={event => setAuthoritySalesTier(event.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500/50 focus:outline-none"
              >
                <option value="S1" className="bg-slate-900">Sales S1 ({authorityData?.summary.by_sales_tier.S1 ?? 0})</option>
                <option value="S2" className="bg-slate-900">Sales S2 ({authorityData?.summary.by_sales_tier.S2 ?? 0})</option>
                <option value="S3" className="bg-slate-900">Sales S3 ({authorityData?.summary.by_sales_tier.S3 ?? 0})</option>
                <option value="" className="bg-slate-900">All sales tiers</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              {authorityLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/10 text-slate-500">
                    <tr>
                      <th className="py-2 pl-4 pr-3 font-medium">Product</th>
                      <th className="py-2 pr-3 font-medium">Missing</th>
                      <th className="py-2 pr-3 font-medium">WineSensed Signal</th>
                      <th className="py-2 pr-3 font-medium">Validated Value</th>
                      <th className="py-2 pr-4 font-medium">Authority Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(authorityData?.candidates ?? []).map(candidate => {
                      const signal = candidate.winesensed_signals[0];
                      return (
                        <tr key={candidate.id} className="border-b border-white/5 text-slate-300">
                          <td className="max-w-sm py-2 pl-4 pr-3">
                            <p className="font-mono text-slate-500">{candidate.sku}</p>
                            <p className="font-medium text-slate-200">{candidate.product_name}</p>
                            <p className="text-[10px] text-slate-600">
                              {candidate.country} · Sales {candidate.sales_tier} · {candidate.price_tier ?? 'no price tier'}
                            </p>
                            <p className="text-[10px] text-slate-600">{candidate.grape_variety || candidate.classification || '-'}</p>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex flex-wrap gap-1">
                              {candidate.missing_fields.map(field => (
                                <span key={field} className="rounded-full bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">{field}</span>
                              ))}
                            </div>
                          </td>
                          <td className="max-w-xs py-2 pr-3 text-slate-400">
                            {signal ? (
                              <>
                                <p className="text-slate-200">{signal.observed_name}</p>
                                <p className="text-[10px] text-slate-600">{signal.suggested_target_type} · {signal.evidence_count} rows · {signal.curation_status}</p>
                              </>
                            ) : (
                              <span className="text-slate-600">No WineSensed signal</span>
                            )}
                          </td>
                          <td className="min-w-56 py-2 pr-3">
                            <div className="space-y-2">
                              <select
                                value={candidate.decision?.validated_field ?? candidate.suggested_next_field}
                                disabled={savingAuthority === candidate.id}
                                onChange={event => void updateAuthority(candidate, { validated_field: event.target.value })}
                                className="w-full rounded-md border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-white"
                              >
                                <option value="country">country</option>
                                <option value="region">region</option>
                                <option value="subregion">subregion</option>
                                <option value="appellation">appellation</option>
                              </select>
                              <input
                                defaultValue={candidate.decision?.validated_value ?? ''}
                                disabled={savingAuthority === candidate.id}
                                onBlur={event => {
                                  if (event.target.value !== (candidate.decision?.validated_value ?? '')) {
                                    void updateAuthority(candidate, { validated_value: event.target.value });
                                  }
                                }}
                                placeholder="Authority-confirmed value"
                                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600"
                              />
                            </div>
                          </td>
                          <td className="min-w-80 py-2 pr-4">
                            <div className="space-y-2">
                              <select
                                value={candidate.decision?.status ?? 'new'}
                                disabled={savingAuthority === candidate.id}
                                onChange={event => void updateAuthority(candidate, { status: event.target.value })}
                                className="w-full rounded-md border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-white"
                              >
                                <option value="new">New</option>
                                <option value="needs_authority_source">Needs authority source</option>
                                <option value="source_found">Source found</option>
                                <option value="approved_for_taxonomy">Approved for taxonomy</option>
                                <option value="approved_for_product_update">Approved for product update</option>
                                <option value="rejected">Rejected</option>
                                <option value="published">Published</option>
                              </select>
                              <input
                                defaultValue={(candidate.decision?.authority_urls ?? []).join(', ')}
                                disabled={savingAuthority === candidate.id}
                                onBlur={event => {
                                  const urls = event.target.value.split(',').map(v => v.trim()).filter(Boolean);
                                  if (event.target.value !== (candidate.decision?.authority_urls ?? []).join(', ')) {
                                    void updateAuthority(candidate, { authority_urls: urls });
                                  }
                                }}
                                placeholder="Authority source URLs, comma separated"
                                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600"
                              />
                              <input
                                defaultValue={candidate.decision?.authority_notes ?? ''}
                                disabled={savingAuthority === candidate.id}
                                onBlur={event => {
                                  if (event.target.value !== (candidate.decision?.authority_notes ?? '')) {
                                    void updateAuthority(candidate, { authority_notes: event.target.value });
                                  }
                                }}
                                placeholder="Authority note / comparison with WineSensed"
                                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600"
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="border-t border-white/10 px-4 py-2 text-xs text-slate-500">
              Showing {(authorityData?.candidates.length ?? 0).toLocaleString()} of {(authorityData?.summary.filtered_candidates ?? 0).toLocaleString()} authority candidates.
            </div>
          </section>

          <section className="rounded-lg border border-white/8 bg-white/3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
              <div>
                <h2 className="text-sm font-medium text-white">Authority Product Update Preview</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Read-only preview for approved authority decisions with taxonomy checks before bulk update.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void fetchAuthorityProductCandidates()}
                className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
              >
                Build authority preview
              </button>
            </div>
            {authorityProductData && (
              <>
                <div className="grid grid-cols-1 gap-3 border-b border-white/10 p-4 sm:grid-cols-3">
                  <Metric label="Approved Decisions" value={authorityProductData.summary.approved_decisions} />
                  <Metric label="Ready Rows" value={authorityProductData.summary.ready_rows} />
                  <Metric label="Blocked Rows" value={authorityProductData.summary.blocked_rows} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/10 text-slate-500">
                      <tr>
                        <th className="py-2 pl-4 pr-3 font-medium">SKU</th>
                        <th className="py-2 pr-3 font-medium">Product</th>
                        <th className="py-2 pr-3 font-medium">Field</th>
                        <th className="py-2 pr-3 font-medium">Current</th>
                        <th className="py-2 pr-3 font-medium">Validated</th>
                        <th className="py-2 pr-4 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {authorityProductData.candidates.slice(0, 30).map(row => (
                        <tr key={row.candidate_id} className="border-b border-white/5 text-slate-300">
                          <td className="py-2 pl-4 pr-3 font-mono text-slate-400">{row.sku}</td>
                          <td className="max-w-xs py-2 pr-3 text-slate-200">{row.product_name}</td>
                          <td className="py-2 pr-3">{row.field_name}</td>
                          <td className="py-2 pr-3">{row.current_value || '-'}</td>
                          <td className="py-2 pr-3 text-emerald-300">{row.new_value}</td>
                          <td className="max-w-md py-2 pr-4 text-slate-500">{row.authority_urls.join(', ')}</td>
                        </tr>
                      ))}
                      {authorityProductData.blocked.slice(0, 20).map(row => (
                        <tr key={row.candidate_id} className="border-b border-white/5 text-slate-400">
                          <td className="py-2 pl-4 pr-3 font-mono text-slate-500">{row.sku}</td>
                          <td className="max-w-xs py-2 pr-3">{row.product_name}</td>
                          <td className="py-2 pr-3">{row.field_name}</td>
                          <td className="py-2 pr-3">Blocked</td>
                          <td className="py-2 pr-3">{row.new_value ?? '-'}</td>
                          <td className="max-w-md py-2 pr-4 text-rose-300">{row.blockers.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-white/10 px-4 py-2 text-xs text-slate-500">
                  {authorityProductData.summary.next_step}
                </div>
              </>
            )}
          </section>

          <section className="rounded-lg border border-white/8 bg-white/3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
              <div>
                <h2 className="text-sm font-medium text-white">Region / Subregion / Appellation Evidence</h2>
                <p className="mt-1 text-xs text-slate-500">
                  WineSensed geography strings matched against our taxonomy; review unknowns before adding canonical entries.
                </p>
              </div>
              {geoSummary && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge label="Matched" value={geoSummary.matched} tone="emerald" />
                  <Badge label="Ambiguous" value={geoSummary.ambiguous} tone="amber" />
                  <Badge label="Needs classification" value={geoSummary.needs_classification} tone="rose" />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
              <div className="relative min-w-64 flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={geoQ}
                  onChange={event => setGeoQ(event.target.value)}
                  placeholder="Search geography evidence"
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-violet-500/50 focus:outline-none"
                />
              </div>
              <select
                value={geoStatus}
                onChange={event => setGeoStatus(event.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500/50 focus:outline-none"
              >
                <option value="needs_classification" className="bg-slate-900">Needs classification</option>
                <option value="ambiguous" className="bg-slate-900">Ambiguous</option>
                <option value="matched" className="bg-slate-900">Matched</option>
                <option value="" className="bg-slate-900">All</option>
              </select>
              <select
                value={curationStatus}
                onChange={event => setCurationStatus(event.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-violet-500/50 focus:outline-none"
              >
                <option value="" className="bg-slate-900">All review states</option>
                <option value="new" className="bg-slate-900">New</option>
                <option value="needs_research" className="bg-slate-900">Needs research</option>
                <option value="confirmed_region" className="bg-slate-900">Confirmed region</option>
                <option value="confirmed_subregion" className="bg-slate-900">Confirmed subregion</option>
                <option value="confirmed_appellation" className="bg-slate-900">Confirmed appellation</option>
                <option value="rejected_generic" className="bg-slate-900">Rejected generic</option>
                <option value="promoted" className="bg-slate-900">Promoted</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              {geoLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/10 text-slate-500">
                    <tr>
                      <th className="py-2 pl-4 pr-3 font-medium">Observed Geography</th>
                      <th className="py-2 pr-3 font-medium">Country</th>
                      <th className="py-2 pr-3 font-medium">Evidence</th>
                      <th className="py-2 pr-3 font-medium">Top Grapes</th>
                      <th className="py-2 pr-3 font-medium">Matched Canonical</th>
                      <th className="py-2 pr-4 font-medium">Suggested Type</th>
                      <th className="py-2 pr-4 font-medium">Review State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(geoData?.evidence ?? []).map(row => (
                      <tr key={row.id} className="border-b border-white/5 text-slate-300">
                        <td className="py-2 pl-4 pr-3 font-medium text-slate-200">{row.observed_name}</td>
                        <td className="py-2 pr-3">{row.observed_country ?? '-'}</td>
                        <td className="py-2 pr-3">
                          <p>{row.evidence_count.toLocaleString()} rows</p>
                          <p className="text-[10px] text-slate-600">{row.review_count.toLocaleString()} reviews · rating {row.avg_rating ?? '-'}</p>
                        </td>
                        <td className="max-w-xs py-2 pr-3 text-slate-400">
                          {row.top_grapes.map(grapeRow => `${grapeRow.name} (${grapeRow.count})`).join(', ') || '-'}
                        </td>
                        <td className="py-2 pr-3">
                          {row.matched_entity_name ? (
                            <>
                              <p className="text-slate-200">{row.matched_entity_name}</p>
                              <p className="text-[10px] text-slate-600">{row.matched_entity_type}</p>
                            </>
                          ) : (
                            <span className="text-slate-600">Unmatched</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`rounded-full px-2 py-1 text-[11px] ${row.match_status === 'matched' ? 'bg-emerald-500/10 text-emerald-300' : row.match_status === 'ambiguous' ? 'bg-amber-500/10 text-amber-300' : 'bg-rose-500/10 text-rose-300'}`}>
                            {row.suggested_target_type}
                          </span>
                        </td>
                        <td className="min-w-72 py-2 pr-4">
                          <div className="space-y-2">
                            <select
                              value={row.curation?.status ?? 'new'}
                              disabled={savingCuration === row.id}
                              onChange={event => updateCuration(row, { status: event.target.value })}
                              className="w-full rounded-md border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-violet-500/50 focus:outline-none"
                            >
                              <option value="new">New</option>
                              <option value="needs_research">Needs research</option>
                              <option value="confirmed_region">Confirmed region</option>
                              <option value="confirmed_subregion">Confirmed subregion</option>
                              <option value="confirmed_appellation">Confirmed appellation</option>
                              <option value="rejected_generic">Rejected generic</option>
                              <option value="promoted">Promoted</option>
                            </select>
                            <input
                              defaultValue={row.curation?.notes ?? ''}
                              disabled={savingCuration === row.id}
                              onBlur={event => {
                                if (event.target.value !== (row.curation?.notes ?? '')) {
                                  void updateCuration(row, { notes: event.target.value });
                                }
                              }}
                              placeholder="Review note / source reminder"
                              className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-violet-500/50 focus:outline-none"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                defaultValue={row.curation?.confirmed_name ?? row.observed_name}
                                disabled={savingCuration === row.id}
                                onBlur={event => {
                                  if (event.target.value !== (row.curation?.confirmed_name ?? row.observed_name)) {
                                    void updateCuration(row, { confirmed_name: event.target.value });
                                  }
                                }}
                                placeholder="Confirmed name"
                                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-violet-500/50 focus:outline-none"
                              />
                              <input
                                defaultValue={row.curation?.confirmed_parent_name ?? ''}
                                disabled={savingCuration === row.id}
                                onBlur={event => {
                                  if (event.target.value !== (row.curation?.confirmed_parent_name ?? '')) {
                                    void updateCuration(row, { confirmed_parent_name: event.target.value });
                                  }
                                }}
                                placeholder="Parent region/subregion"
                                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-violet-500/50 focus:outline-none"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={savingCuration === row.id}
                                onClick={() => void promote(row, false)}
                                className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5"
                              >
                                Dry run
                              </button>
                              <button
                                type="button"
                                disabled={savingCuration === row.id}
                                onClick={() => void promote(row, true)}
                                className="rounded-md bg-violet-600 px-2 py-1 text-[11px] text-white hover:bg-violet-500 disabled:opacity-50"
                              >
                                Promote
                              </button>
                              {row.curation?.promoted_entity_id && (
                                <span className="self-center text-[10px] text-emerald-400">Entity #{row.curation.promoted_entity_id}</span>
                              )}
                            </div>
                            {promotionMessage[row.id] && (
                              <p className="text-[10px] text-slate-500">{promotionMessage[row.id]}</p>
                            )}
                            {row.curation?.updated_at && (
                              <p className="text-[10px] text-slate-600">Updated {new Date(row.curation.updated_at).toLocaleString()}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="border-t border-white/10 px-4 py-2 text-xs text-slate-500">
              Showing {(geoData?.evidence.length ?? 0).toLocaleString()} of {(geoData?.total ?? 0).toLocaleString()} geography evidence rows.
            </div>
          </section>

          <section className="rounded-lg border border-white/8 bg-white/3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
              <div>
                <h2 className="text-sm font-medium text-white">Product Canonicalization Preview</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Read-only gate for item updates. It only proposes changes where a product already has a reviewed observed value.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void fetchCandidates()}
                className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
              >
                Build preview
              </button>
            </div>
            {candidateData && (
              <>
                <div className="grid grid-cols-1 gap-3 border-b border-white/10 p-4 sm:grid-cols-3">
                  <Metric label="Confirmed Evidence" value={candidateData.summary.confirmed_evidence_rows} />
                  <Metric label="Candidate Rows" value={candidateData.summary.candidate_rows} />
                  <div className="rounded-lg border border-white/8 bg-white/3 p-4">
                    <p className="text-xs text-slate-500">Policy</p>
                    <p className="mt-1 text-sm font-medium text-slate-200">{candidateData.summary.write_policy}</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/10 text-slate-500">
                      <tr>
                        <th className="py-2 pl-4 pr-3 font-medium">SKU</th>
                        <th className="py-2 pr-3 font-medium">Product</th>
                        <th className="py-2 pr-3 font-medium">Field</th>
                        <th className="py-2 pr-3 font-medium">Old</th>
                        <th className="py-2 pr-3 font-medium">New</th>
                        <th className="py-2 pr-4 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidateData.candidates.slice(0, 30).map(row => (
                        <tr key={`${row.sku}-${row.field_name}-${row.old_value}`} className="border-b border-white/5 text-slate-300">
                          <td className="py-2 pl-4 pr-3 font-mono text-slate-400">{row.sku}</td>
                          <td className="max-w-xs py-2 pr-3 text-slate-200">{row.name}</td>
                          <td className="py-2 pr-3">{row.field_name}</td>
                          <td className="py-2 pr-3">{row.old_value}</td>
                          <td className="py-2 pr-3 text-emerald-300">{row.new_value}</td>
                          <td className="max-w-lg py-2 pr-4 text-slate-500">{row.match_reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-white/10 px-4 py-2 text-xs text-slate-500">
                  {candidateData.summary.next_step}
                </div>
              </>
            )}
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Metric label="Rows" value={summary.imported_rows} />
            <Metric label="Reviews" value={summary.rows_with_review} />
            <Metric label="Countries" value={summary.rows_with_country} />
            <Metric label="Regions" value={summary.rows_with_region} />
            <Metric label="Grapes" value={summary.rows_with_grape} />
            <Metric label="Ratings" value={summary.rows_with_rating} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <TopList title="Top Countries" rows={summary.top_countries} />
            <TopList title="Top Grapes" rows={summary.top_grapes} />
            <TopList title="Top Regions" rows={summary.top_regions} />
          </div>

          <section className="rounded-lg border border-white/8 bg-white/3">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
              <div className="relative min-w-64 flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={q}
                  onChange={event => setQ(event.target.value)}
                  placeholder="Search review, region, grape, or vintage id"
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-violet-500/50 focus:outline-none"
                />
              </div>
              <FilterInput label="Country" value={country} onChange={setCountry} />
              <FilterInput label="Grape" value={grape} onChange={setGrape} />
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={hasReview} onChange={event => setHasReview(event.target.checked)} className="accent-violet-500" />
                With review
              </label>
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/10 text-slate-500">
                    <tr>
                      <th className="py-2 pl-4 pr-3 font-medium">Vintage</th>
                      <th className="py-2 pr-3 font-medium">Country</th>
                      <th className="py-2 pr-3 font-medium">Region</th>
                      <th className="py-2 pr-3 font-medium">Grape</th>
                      <th className="py-2 pr-3 font-medium">Rating</th>
                      <th className="py-2 pr-4 font-medium">Review Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.records ?? []).map(record => (
                      <tr key={record.id} className="border-b border-white/5 text-slate-300">
                        <td className="py-2 pl-4 pr-3 font-mono text-slate-400">{record.vintage_id ?? '-'}</td>
                        <td className="py-2 pr-3">{record.country ?? '-'}</td>
                        <td className="py-2 pr-3">{record.region ?? '-'}</td>
                        <td className="py-2 pr-3">{record.grape ?? '-'}</td>
                        <td className="py-2 pr-3">{record.rating ?? '-'}</td>
                        <td className="max-w-xl py-2 pr-4">
                          <p className="truncate text-slate-400">{record.review ?? '-'}</p>
                          <p className="mt-0.5 text-[10px] text-slate-600">{record.review_language_hint}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="border-t border-white/10 px-4 py-2 text-xs text-slate-500">
              Showing {(data?.records.length ?? 0).toLocaleString()} of {(data?.total ?? 0).toLocaleString()} matching rows. Imported from {summary.source_file}.
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/3 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value.toLocaleString()}</p>
    </div>
  );
}

function Badge({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' }) {
  const tones = {
    emerald: 'bg-emerald-500/10 text-emerald-300',
    amber: 'bg-amber-500/10 text-amber-300',
    rose: 'bg-rose-500/10 text-rose-300',
  };
  return (
    <span className={`rounded-full px-2.5 py-1 ${tones[tone]}`}>
      {label}: {value.toLocaleString()}
    </span>
  );
}

function TopList({ title, rows }: { title: string; rows: Array<{ name: string; count: number }> }) {
  const max = rows[0]?.count || 1;
  return (
    <div className="rounded-lg border border-white/8 bg-white/3 p-4">
      <h2 className="mb-3 text-sm font-medium text-white">{title}</h2>
      <div className="space-y-2">
        {rows.slice(0, 8).map(row => (
          <div key={row.name}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="truncate text-xs text-slate-300">{row.name}</span>
              <span className="text-xs text-slate-500">{row.count.toLocaleString()}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
              <div className="h-full rounded-full bg-violet-500/70" style={{ width: `${Math.max(3, (row.count / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      {label}
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-36 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-violet-500/50 focus:outline-none"
      />
    </label>
  );
}
