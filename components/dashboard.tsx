'use client';
import React, { Suspense, useState } from 'react';
import { BookOpen, Database, LayoutDashboard, Package, RefreshCw, Settings, TrendingUp, Upload, type LucideIcon } from 'lucide-react';

// Lazy imports — each page loads independently, crashes are isolated
const ImportPage        = React.lazy(() => import('@/components/pages/ImportPage').then(m => ({ default: m.ImportPage })));
const ProcessingReviewPage = React.lazy(() => import('@/components/pages/ProcessingReviewPage').then(m => ({ default: m.ProcessingReviewPage })));
const TaxonomyQueuePage = React.lazy(() => import('@/components/pages/TaxonomyQueuePage').then(m => ({ default: m.TaxonomyQueuePage })));
const TaxonomyManagerPage = React.lazy(() => import('@/components/pages/TaxonomyManagerPage').then(m => ({ default: m.TaxonomyManagerPage })));
const ProductsPage      = React.lazy(() => import('@/components/pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const OverrideImportPage = React.lazy(() => import('@/components/pages/OverrideImportPage').then(m => ({ default: m.OverrideImportPage })));
const SeoCommandCenter  = React.lazy(() => import('@/components/seo-command-center').then(m => ({ default: m.SeoCommandCenter })));
const SettingsPage      = React.lazy(() => import('@/components/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

type Section = 'import' | 'processing' | 'taxonomy_queue' | 'taxonomy_manager' | 'products' | 'override_import' | 'settings' | 'seo';

const NAV_ITEMS: Array<{ id: Section; label: string; Icon: LucideIcon }> = [
  { id: 'import',           label: 'Import',             Icon: Upload },
  { id: 'processing',       label: 'Processing Review',  Icon: RefreshCw },
  { id: 'taxonomy_queue',   label: 'Taxonomy Queue',     Icon: Database },
  { id: 'taxonomy_manager', label: 'Taxonomy Manager',   Icon: BookOpen },
  { id: 'products',         label: 'Products',           Icon: Package },
  { id: 'override_import',  label: 'Override Import',    Icon: LayoutDashboard },
  { id: 'seo',              label: 'SEO Command Center', Icon: TrendingUp },
  { id: 'settings',         label: 'Settings',           Icon: Settings },
];

// Per-page error boundary
class PageErrorBoundary extends React.Component<{ name: string; children: React.ReactNode }, { error: Error | null }> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-10 text-center">
          <p className="text-rose-400 font-semibold mb-2">{this.props.name} failed to load</p>
          <p className="text-slate-500 text-xs font-mono">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} className="mt-4 text-xs text-violet-400 hover:text-violet-300">
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Sidebar({ active, onNavigate }: { active: Section; onNavigate: (s: Section) => void }) {
  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-white/10 bg-slate-900">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
        <span className="text-xl">🍷</span>
        <span className="text-sm font-semibold text-white">WNLQ9 PIM</span>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2 pt-3">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              active === id
                ? 'bg-violet-500/20 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function Dashboard() {
  const [section, setSection] = useState<Section>('import');

  const pages: Record<Section, React.ReactNode> = {
    import:           <ImportPage />,
    processing:       <ProcessingReviewPage />,
    taxonomy_queue:   <TaxonomyQueuePage />,
    taxonomy_manager: <TaxonomyManagerPage />,
    products:         <ProductsPage />,
    override_import:  <OverrideImportPage />,
    seo:              <SeoCommandCenter />,
    settings:         <SettingsPage />,
  };

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <Sidebar active={section} onNavigate={setSection} />
      <main className="flex-1 overflow-auto">
        <PageErrorBoundary name={section}>
          <Suspense fallback={<PageLoader />}>
            {pages[section]}
          </Suspense>
        </PageErrorBoundary>
      </main>
    </div>
  );
}
