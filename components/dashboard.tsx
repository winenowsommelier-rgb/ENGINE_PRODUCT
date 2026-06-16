'use client';
import React, { Suspense, useEffect, useState } from 'react';
import { BarChart3, ClipboardCheck, Database, FileCheck2, FolderInput, Globe, Grid3X3, History, Home, Library, Package, Settings, Sparkles, Upload, type LucideIcon } from 'lucide-react';

const DashboardHomePage = React.lazy(() => import('@/components/pages/DashboardHomePage').then(m => ({ default: m.DashboardHomePage })));
const ProductsPage      = React.lazy(() => import('@/components/pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const ProductMatrixPage = React.lazy(() => import('@/components/pages/ProductMatrixPage').then(m => ({ default: m.ProductMatrixPage })));
const KnowledgeLibraryPage = React.lazy(() => import('@/components/pages/KnowledgeLibraryPage').then(m => ({ default: m.KnowledgeLibraryPage })));
const ResearchLibraryPage = React.lazy(() => import('@/components/pages/ResearchLibraryPage').then(m => ({ default: m.ResearchLibraryPage })));
const PublishReadinessPage = React.lazy(() => import('@/components/pages/PublishReadinessPage').then(m => ({ default: m.PublishReadinessPage })));
const ValidationDashboardPage = React.lazy(() => import('@/components/pages/ValidationDashboardPage').then(m => ({ default: m.ValidationDashboardPage })));
const ChangeLogPage = React.lazy(() => import('@/components/pages/ChangeLogPage').then(m => ({ default: m.ChangeLogPage })));
const ImportHubPage = React.lazy(() => import('@/components/pages/ImportHubPage').then(m => ({ default: m.ImportHubPage })));
const SupplierIntakePage = React.lazy(() => import('@/components/pages/SupplierIntakePage').then(m => ({ default: m.SupplierIntakePage })));
const CompletenessPage  = React.lazy(() => import('@/components/pages/CompletenessPage').then(m => ({ default: m.CompletenessPage })));
const SettingsPage      = React.lazy(() => import('@/components/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

type Section = 'home' | 'products' | 'matrix' | 'knowledge_library' | 'research_library' | 'publish_readiness' | 'validation' | 'changelog' | 'completeness' | 'import' | 'supplier_intake' | 'settings';

interface NavGroup {
  label: string;
  items: Array<{ id: Section; label: string; Icon: LucideIcon }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '',
    items: [
      { id: 'home',             label: 'Dashboard',          Icon: Home },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { id: 'products',         label: 'Products',           Icon: Package },
      { id: 'matrix',           label: 'Product Matrix',     Icon: Grid3X3 },
      { id: 'knowledge_library', label: 'Knowledge Library', Icon: Library },
      { id: 'research_library', label: 'Research Library',   Icon: Database },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'publish_readiness', label: 'Publish Readiness', Icon: FileCheck2 },
      { id: 'validation', label: 'Data Validation', Icon: ClipboardCheck },
      { id: 'completeness', label: 'Completeness',  Icon: BarChart3 },
      { id: 'changelog',  label: 'Change Log',      Icon: History },
    ],
  },
  {
    label: 'Data',
    items: [
      { id: 'import', label: 'Import', Icon: Upload },
      { id: 'supplier_intake', label: 'Supplier Intake', Icon: FolderInput },
    ],
  },
  {
    label: '',
    items: [
      { id: 'settings', label: 'Settings', Icon: Settings },
    ],
  },
];

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
      <div className="w-32 h-px bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-white/40 rounded-full animate-shimmer" />
      </div>
    </div>
  );
}

function Sidebar({ active, onNavigate }: { active: Section; onNavigate: (s: Section) => void }) {
  return (
    <nav className="flex w-48 shrink-0 flex-col bg-[#080808] border-r border-white/[0.06]">
      {/* Logo */}
      <div className="flex h-12 items-center gap-2 px-4 border-b border-white/[0.06]">
        <div className="w-5 h-5 rounded bg-white flex items-center justify-center shrink-0">
          <span className="text-black text-[10px] font-bold leading-none">W</span>
        </div>
        <span className="text-[13px] font-semibold text-white tracking-tight">WNLQ9 PIM</span>
      </div>

      {/* Nav content */}
      <div className="flex flex-1 flex-col gap-0 p-2 pt-3 overflow-y-auto">
        {/* External links */}
        <div className="mb-3 space-y-0.5">
          <a href="/explore"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-white/70 hover:bg-white/[0.05] hover:text-white/90 transition-colors group">
            <Globe size={13} className="shrink-0" />
            <span>Map Explorer</span>
            <span className="ml-auto text-[10px] text-white/40 group-hover:text-white/60">↗</span>
          </a>
          <a href="/curation"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-white/70 hover:bg-white/[0.05] hover:text-white/90 transition-colors group">
            <Sparkles size={13} className="shrink-0" />
            <span>Curation Engine</span>
            <span className="ml-auto text-[10px] text-white/40 group-hover:text-white/60">↗</span>
          </a>
        </div>

        <div className="h-px bg-white/[0.06] mb-3" />

        {/* Nav groups */}
        {NAV_GROUPS.map((group, gi) => (
          <React.Fragment key={gi}>
            {group.label && (
              <p className={'px-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/50 ' + (gi > 0 ? 'mt-5 ' : '') + 'mb-1.5'}>
                {group.label}
              </p>
            )}
            {!group.label && gi > 0 && <div className="mt-auto" />}
            <div className="space-y-0.5">
              {group.items.map(function ({ id, label, Icon }) {
                const isActive = active === id;
                return (
                  <button key={id} type="button" onClick={function () { onNavigate(id); }}
                    className={
                      'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ' +
                      (isActive
                        ? 'bg-white text-black font-medium'
                        : 'text-white/70 hover:bg-white/[0.05] hover:text-white/90')
                    }>
                    <Icon size={13} className="shrink-0" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </React.Fragment>
        ))}
      </div>
    </nav>
  );
}

const VALID_SECTIONS = new Set<Section>(['home','products','matrix','knowledge_library','research_library','publish_readiness','validation','changelog','completeness','import','supplier_intake','settings']);

function sectionFromHash(): Section {
  try {
    const hash = window.location.hash.replace('#', '') as Section;
    return VALID_SECTIONS.has(hash) ? hash : 'home';
  } catch { return 'home'; }
}

export function Dashboard() {
  const [section, setSection] = useState<Section>('home');

  // Read hash on mount
  useEffect(() => {
    setSection(sectionFromHash());
  }, []);

  // Write hash when section changes
  useEffect(() => {
    try { window.location.hash = section; } catch { /* noop */ }
  }, [section]);

  // Respond to browser back/forward
  useEffect(() => {
    function onHashChange() { setSection(sectionFromHash()); }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const pages: Record<Section, React.ReactNode> = {
    home:             <DashboardHomePage onNavigate={function (s: string) { setSection(s as Section); }} />,
    products:         <ProductsPage />,
    matrix:           <ProductMatrixPage />,
    knowledge_library: <KnowledgeLibraryPage />,
    research_library: <ResearchLibraryPage />,
    publish_readiness: <PublishReadinessPage />,
    validation:       <ValidationDashboardPage />,
    changelog:        <ChangeLogPage />,
    completeness:     <CompletenessPage />,
    import:           <ImportHubPage />,
    supplier_intake:  <SupplierIntakePage />,
    settings:         <SettingsPage />,
  };

  return (
    <div className="flex h-screen bg-[#080808] text-white overflow-hidden">
      <Sidebar active={section} onNavigate={setSection} />
      <main className="flex-1 overflow-auto bg-[#080808]">
        <PageErrorBoundary key={section} name={section}>
          <Suspense fallback={<PageLoader />}>
            {pages[section]}
          </Suspense>
        </PageErrorBoundary>
      </main>
    </div>
  );
}
