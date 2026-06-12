'use client';

import React, { Suspense, useState } from 'react';
import { Upload, LayoutDashboard, RefreshCw, Sparkles, Database } from 'lucide-react';

const ImportPage        = React.lazy(() => import('@/components/pages/ImportPage').then(m => ({ default: m.ImportPage })));
const OverrideImportPage = React.lazy(() => import('@/components/pages/OverrideImportPage').then(m => ({ default: m.OverrideImportPage })));
const ProcessingReviewPage = React.lazy(() => import('@/components/pages/ProcessingReviewPage').then(m => ({ default: m.ProcessingReviewPage })));
const AIReviewQueuePage = React.lazy(() => import('@/components/pages/AIReviewQueuePage').then(m => ({ default: m.AIReviewQueuePage })));
const TaxonomyQueuePage = React.lazy(() => import('@/components/pages/TaxonomyQueuePage').then(m => ({ default: m.TaxonomyQueuePage })));

type Tab = 'csv_import' | 'override' | 'processing' | 'ai_review' | 'taxonomy_queue';

const TABS: Array<{ id: Tab; label: string; Icon: React.ElementType; description: string }> = [
  { id: 'csv_import',     label: 'New Products',       Icon: Upload,          description: 'Import new products from CSV with AI enrichment' },
  { id: 'override',       label: 'Field Override',     Icon: LayoutDashboard, description: 'Override specific fields for existing products by SKU' },
  { id: 'processing',     label: 'Processing Review',  Icon: RefreshCw,       description: 'Review batch processing results' },
  { id: 'ai_review',      label: 'AI Review Queue',    Icon: Sparkles,        description: 'Review AI-enriched products before validation' },
  { id: 'taxonomy_queue', label: 'Taxonomy Queue',     Icon: Database,        description: 'Review and validate taxonomy assignments' },
];

function TabLoader() {
  return (
    <div role="status" aria-label="Loading" className="flex items-center justify-center h-48">
      <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function ImportHubPage() {
  const [activeTab, setActiveTab] = useState<Tab>('csv_import');

  return (
    <div className="space-y-0">
      {/* Tab header */}
      <div className="border-b border-white/8 bg-slate-900/50">
        <div role="tablist" aria-label="Import sections" className="flex items-center gap-1 px-4 pt-4 pb-0 overflow-x-auto">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`tabpanel-${id}`}
              id={`tab-${id}`}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                activeTab === id
                  ? 'border-violet-500 text-white bg-white/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/3'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        className="p-6"
      >
        <Suspense fallback={<TabLoader />}>
          {activeTab === 'csv_import' && <ImportPage />}
          {activeTab === 'override' && <OverrideImportPage />}
          {activeTab === 'processing' && <ProcessingReviewPage onNavigateToReview={() => setActiveTab('ai_review')} />}
          {activeTab === 'ai_review' && <AIReviewQueuePage />}
          {activeTab === 'taxonomy_queue' && <TaxonomyQueuePage />}
        </Suspense>
      </div>
    </div>
  );
}
