'use client';

import { useEffect, useMemo, useState } from 'react';
import { runBatchProcessing } from '@/lib/batch-pipeline';
import { downloadFile, toCsv } from '@/lib/export';
import { magentoImportRows } from '@/lib/data';
import { countryIsoMap, grapeAliasMap, regionCountryMap } from '@/lib/taxonomy-mappings';

export type ImportLogEntry = {
  id: string;
  createdAt: string;
  rowCount: number;
  passed: number;
  blocked: number;
  mode: 'preview' | 'full';
  fileName: string;
};

function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function formatDate(timestamp: string) {
  return new Date(timestamp).toLocaleString(undefined, { hour12: false });
}

export function DataBrowser() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [log, setLog] = useLocalStorage<ImportLogEntry[]>('winenow-import-log', []);
  const [mode, setMode] = useState<'preview' | 'full'>('preview');

  const normalizedSearch = search.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    if (!normalizedSearch) return magentoImportRows;
    return magentoImportRows.filter((row) => {
      return (
        String(row.sku || '')
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(row.name || '')
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(row.category || '')
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(row.region || '')
          .toLowerCase()
          .includes(normalizedSearch)
      );
    });
  }, [normalizedSearch]);

  const pageSize = 40;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));

  const pagedRows = useMemo(() => {
    const start = page * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page]);

  const selectedRow = pagedRows[selectedIndex] ?? pagedRows[0];

  const selectedRowResult = useMemo(() => {
    if (!selectedRow) return null;
    return runBatchProcessing([selectedRow]).rows[0];
  }, [selectedRow]);

  const handleExport = () => {
    const rows = mode === 'full' ? filteredRows : pagedRows;
    const normalized = runBatchProcessing(rows).rows.map((r) => r.normalized);
    const fileName = `winenow-import-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    const csv = toCsv(normalized);
    downloadFile(csv, fileName);

    const passed = normalized.filter((r) => r.sku && r.name).length;
    const blocked = normalized.length - passed;

    setLog([
      ...log,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        createdAt: new Date().toISOString(),
        rowCount: normalized.length,
        passed,
        blocked,
        mode,
        fileName
      }
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="panel p-6">
          <h2 className="text-xl font-semibold text-white">Product catalog</h2>
          <p className="mt-2 text-sm text-slate-300">Browse the imported SKU feed, inspect item details, and understand why rows pass or fail validation.</p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Search SKU, name, country..."
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-slate-400"
              />
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'preview' | 'full')}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
              >
                <option value="preview">Preview (page)</option>
                <option value="full">Full set</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center justify-center rounded-2xl bg-violet-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-400"
            >
              Export CSV
            </button>
          </div>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
            <table className="w-full text-left text-sm text-slate-200">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">Region</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <tr
                      key={`${row.sku}-${index}`}
                      onClick={() => setSelectedIndex(index)}
                      className={`cursor-pointer transition ${
                        isSelected ? 'bg-violet-500/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <td className="px-4 py-3">{row.sku}</td>
                      <td className="px-4 py-3 truncate max-w-[260px]">{row.name}</td>
                      <td className="px-4 py-3">{row.category}</td>
                      <td className="px-4 py-3">{row.region}</td>
                      <td className="px-4 py-3">{row.type}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${row.status === 'Ready' ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/20 text-amber-100'}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-300">
            <div>
              Showing {pagedRows.length} of {filteredRows.length} rows
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page === 0}
                type="button"
                onClick={() => {
                  setPage((p) => Math.max(0, p - 1));
                  setSelectedIndex(0);
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200 disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {page + 1} of {pageCount}
              </span>
              <button
                disabled={page >= pageCount - 1}
                type="button"
                onClick={() => {
                  setPage((p) => Math.min(pageCount - 1, p + 1));
                  setSelectedIndex(0);
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-6">
            <h2 className="text-xl font-semibold text-white">Selected item detail</h2>
            <p className="mt-2 text-sm text-slate-300">Inspect raw row values, normalization results, and validation issues.</p>

            {selectedRowResult ? (
              <div className="mt-6 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-medium text-white">Normalized SKU</p>
                    <p className="mt-2 text-lg text-white">{selectedRowResult.normalized.sku || '—'}</p>
                    <p className="mt-1 text-xs text-slate-400">{selectedRowResult.normalized.name || 'No name detected'}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-medium text-white">Validation status</p>
                    <p className="mt-2 text-lg text-white">{selectedRowResult.issues.some((i) => i.severity === 'error') ? 'Blocked' : 'Ready'}</p>
                    <p className="mt-1 text-xs text-slate-400">{selectedRowResult.issues.length} issue(s) found.</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-medium text-white">Raw row (as imported)</p>
                    <pre className="mt-3 max-h-52 overflow-auto rounded-xl bg-slate-900/40 p-3 text-xs text-slate-200">
                      {JSON.stringify(selectedRow, null, 2)}
                    </pre>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-medium text-white">Auto-corrections & issues</p>
                    <div className="mt-3 space-y-2">
                      {selectedRowResult.corrections.length ? (
                        <div className="rounded-2xl bg-violet-500/10 p-3 text-sm text-violet-100">
                          <p className="font-medium">Corrections</p>
                          <ul className="mt-2 list-disc pl-5">
                            {selectedRowResult.corrections.map((correction) => (
                              <li key={`${correction.field}-${correction.to}`}>
                                <span className="font-medium">{correction.field}</span>: {correction.from || '∅'} → {correction.to}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-300">No automatic corrections were applied.</p>
                      )}

                      {selectedRowResult.issues.length ? (
                        <div className="rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-100">
                          <p className="font-medium">Issues</p>
                          <ul className="mt-2 list-disc pl-5">
                            {selectedRowResult.issues.map((issue, index) => (
                              <li key={`${issue.field}-${index}`}>[{issue.severity}] {issue.field}: {issue.message}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-300">No validation issues detected.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-6 text-sm text-slate-300">Select an item on the left to see details.</p>
            )}
          </div>

          <div className="panel p-6">
            <h2 className="text-xl font-semibold text-white">Taxonomy mappings</h2>
            <p className="mt-2 text-sm text-slate-300">
              Automatically derived country/region/ingredient mappings from your workbook.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="font-medium text-white">Country → ISO</p>
                <p className="mt-2 text-sm text-slate-300">Total {Object.keys(countryIsoMap).length} entries</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="font-medium text-white">Region → Country</p>
                <p className="mt-2 text-sm text-slate-300">Total {Object.keys(regionCountryMap).length} entries</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="font-medium text-white">Grape aliases</p>
                <p className="mt-2 text-sm text-slate-300">Total {Object.keys(grapeAliasMap).length} entries</p>
              </div>
            </div>
          </div>

          <div className="panel p-6">
            <h2 className="text-xl font-semibold text-white">Import history</h2>
            <p className="mt-2 text-sm text-slate-300">Your recent export runs are saved locally so you can re-download generated files.</p>
            <div className="mt-6 space-y-3">
              {log.length ? (
                log
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{entry.mode === 'full' ? 'Full export' : 'Preview export'}</p>
                          <p className="text-xs text-slate-400">{formatDate(entry.createdAt)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-100">{entry.rowCount} rows</span>
                          <button
                            type="button"
                            onClick={() => downloadFile('', entry.fileName)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200 hover:bg-white/10"
                          >
                            Re-download
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-300">
                        Passed: {entry.passed} · Blocked: {entry.blocked}
                      </p>
                    </div>
                  ))
              ) : (
                <p className="text-sm text-slate-300">No exports run yet. Click Export CSV to generate one.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
