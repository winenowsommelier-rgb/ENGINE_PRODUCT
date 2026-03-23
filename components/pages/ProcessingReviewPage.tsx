'use client';
import { useEffect, useState } from 'react';

export function ProcessingReviewPage() {
  const [stats, setStats] = useState<Record<string, any> | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/batch-process-db?action=stats').then(r => r.json()),
      fetch('/api/batch-process-db?action=logs').then(r => r.json()),
    ]).then(([s, l]) => {
      setStats(s);
      setLogs(l.logs ?? []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-white mb-6">Processing Review</h1>

      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total products', value: stats.total },
            { label: 'Validated', value: stats.validated },
            { label: 'Needs review', value: stats.needs_review },
            { label: 'Blocked', value: stats.blocked },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/5 rounded-xl p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="text-2xl font-semibold text-white mt-1">{value ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-medium text-slate-300 mb-3">Recent batch logs</h2>
      <div className="space-y-2">
        {logs.length === 0 && <p className="text-slate-500 text-sm">No batch logs yet.</p>}
        {logs.map((log: any, i: number) => (
          <div key={i} className="bg-white/5 rounded-lg p-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-white">{log.source_file}</p>
              <p className="text-xs text-slate-400 mt-0.5">{log.timestamp}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-300">{log.processed_rows} / {log.total_rows} rows</p>
              <p className="text-xs text-slate-500 mt-0.5">{log.status}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
