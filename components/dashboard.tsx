'use client';
import { useState } from 'react';
import { BookOpen, Database, LayoutDashboard, Package, RefreshCw, Settings, TrendingUp, Upload, type LucideIcon } from 'lucide-react';
import { ImportPage } from '@/components/pages/ImportPage';
import { ProcessingReviewPage } from '@/components/pages/ProcessingReviewPage';
import { TaxonomyQueuePage } from '@/components/pages/TaxonomyQueuePage';
import { TaxonomyManagerPage } from '@/components/pages/TaxonomyManagerPage';
import { ProductsPage } from '@/components/pages/ProductsPage';
import { OverrideImportPage } from '@/components/pages/OverrideImportPage';
import { SettingsPage } from '@/components/pages/SettingsPage';
import { SeoCommandCenter } from '@/components/seo-command-center';

type Section = 'import' | 'processing' | 'taxonomy_queue' | 'taxonomy_manager' | 'products' | 'override_import' | 'settings' | 'seo';

const NAV_ITEMS: Array<{ id: Section; label: string; Icon: LucideIcon }> = [
  { id: 'import', label: 'Import', Icon: Upload },
  { id: 'processing', label: 'Processing Review', Icon: RefreshCw },
  { id: 'taxonomy_queue', label: 'Taxonomy Queue', Icon: Database },
  { id: 'taxonomy_manager', label: 'Taxonomy Manager', Icon: BookOpen },
  { id: 'products', label: 'Products', Icon: Package },
  { id: 'override_import', label: 'Override Import', Icon: LayoutDashboard },
  { id: 'seo', label: 'SEO Command Center', Icon: TrendingUp },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

function Sidebar({ active, onNavigate }: { active: Section; onNavigate: (s: Section) => void }): React.ReactElement {
  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-white/10 bg-slate-900">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
        <span className="text-xl">🍷</span>
        <span className="text-sm font-semibold text-white">WineNow PIM</span>
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
    import: <ImportPage />,
    processing: <ProcessingReviewPage />,
    taxonomy_queue: <TaxonomyQueuePage />,
    taxonomy_manager: <TaxonomyManagerPage />,
    products: <ProductsPage />,
    override_import: <OverrideImportPage />,
    seo: <SeoCommandCenter />,
    settings: <SettingsPage />,
  };

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <Sidebar active={section} onNavigate={setSection} />
      <main className="flex-1 overflow-auto">
        {pages[section]}
      </main>
    </div>
  );
}
