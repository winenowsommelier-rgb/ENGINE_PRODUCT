'use client';
import React, { Suspense, useState } from 'react';
import { BookOpen, ClipboardCheck, Globe, Grid3X3, History, Library, Package, Settings, Upload, type LucideIcon } from 'lucide-react';

// Lazy imports — each page loads independently, crashes are isolated
const ProductsPage      = React.lazy(() => import('@/components/pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const ProductMatrixPage = React.lazy(() => import('@/components/pages/ProductMatrixPage').then(m => ({ default: m.ProductMatrixPage })));
const TaxonomyManagerPage = React.lazy(() => import('@/components/pages/TaxonomyManagerPage').then(m => ({ default: m.TaxonomyManagerPage })));
const KnowledgeLibraryPage = React.lazy(() => import('@/components/pages/KnowledgeLibraryPage').then(m => ({ default: m.KnowledgeLibraryPage })));
const ValidationDashboardPage = React.lazy(() => import('@/components/pages/ValidationDashboardPage').then(m => ({ default: m.ValidationDashboardPage })));
const ChangeLogPage = React.lazy(() => import('@/components/pages/ChangeLogPage').then(m => ({ default: m.ChangeLogPage })));
const ImportHubPage = React.lazy(() => import('@/components/pages/ImportHubPage').then(m => ({ default: m.ImportHubPage })));
const SettingsPage      = React.lazy(() => import('@/components/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

type Section = 'products' | 'matrix' | 'knowledge_library' | 'validation' | 'changelog' | 'import' | 'settings';

interface NavGroup {
  label: string;
  items: Array<{ id: Section; label: string; Icon: LucideIcon }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Catalog',
    items: [
      { id: 'products',         label: 'Products',           Icon: Package },
      { id: 'matrix',           label: 'Product Matrix',     Icon: Grid3X3 },
      { id: 'knowledge_library', label: 'Knowledge Library', Icon: Library },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'validation', label: 'Data Validation', Icon: ClipboardCheck },
      { id: 'changelog',  label: 'Change Log',      Icon: History },
    ],
  },
  {
    label: 'Data',
    items: [
      { id: 'import', label: 'Import', Icon: Upload },
    ],
  },
  {
    label: '',
    items: [
      { id: 'settings', label: 'Settings', Icon: Settings },
    ],
  },
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
        {/* Map Explorer — separate route */}
        <a
          href="/explore"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors mb-2"
        >
          <Globe size={15} />
          Map Explorer
          <span className="ml-auto text-[10px] text-slate-600">↗</span>
        </a>
        <div className="border-b border-white/5 mb-2" />
        {NAV_GROUPS.map((group, gi) => (
          <React.Fragment key={gi}>
            {group.label && (
              <p className={`px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600 ${gi > 0 ? 'mt-4' : ''} mb-1`}>
                {group.label}
              </p>
            )}
            {!group.label && gi > 0 && <div className="mt-auto" />}
            {group.items.map(({ id, label, Icon }) => (
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
          </React.Fragment>
        ))}
      </div>
    </nav>
  );
}

export function Dashboard() {
  const [section, setSection] = useState<Section>('products');

  const pages: Record<Section, React.ReactNode> = {
    products:         <ProductsPage />,
    matrix:           <ProductMatrixPage />,
    knowledge_library: <KnowledgeLibraryPage />,
    validation:       <ValidationDashboardPage />,
    changelog:        <ChangeLogPage />,
    import:           <ImportHubPage />,
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
