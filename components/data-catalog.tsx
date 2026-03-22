'use client';

import { useEffect, useState } from 'react';
import { Search, Database, TrendingUp, AlertCircle, CheckCircle, Clock } from 'lucide-react';

interface CleanedProduct {
  id: string;
  sku: string;
  name: string;
  country: string;
  region: string;
  classification: string;
  flavor_profile?: string;
  overall_confidence: number;
  validation_status: string;
  taxonomy_confidence: number;
  description_confidence: number;
  full_description?: string;
  // Image support
  image_url?: string;
  image_scraped_url?: string;
  image_local_path?: string;
  image_alt_text?: string;
}

interface CatalogStats {
  total: number;
  validated: number;
  pending: number;
  needs_review: number;
  blocked: number;
  avg_confidence: number;
  avg_taxonomy_confidence: number;
  avg_description_confidence: number;
}

export function DataCatalog() {
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [products, setProducts] = useState<CleanedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<CleanedProduct | null>(null);

  const PAGE_SIZE = 50;

  // Load statistics
  useEffect(() => {
    async function loadStats() {
      try {
        const res = await fetch('/api/batch-process-db?action=stats');
        const data = await res.json();
        setStats(data);
      } catch (error) {
        console.error('Error loading stats:', error);
      }
    }
    loadStats();
  }, []);

  // Load products
  useEffect(() => {
    async function loadProducts() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (search) params.set('search', search);

        const res = await fetch(`/api/batch-process-db?action=products&${params}`);
        const data = await res.json();
        setProducts(data.products || []);
        setPage(0);
      } catch (error) {
        console.error('Error loading products:', error);
      } finally {
        setLoading(false);
      }
    }

    const timer = setTimeout(loadProducts, 300);
    return () => clearTimeout(timer);
  }, [statusFilter, search]);

  const statusColors = {
    validated: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30',
    pending: 'bg-slate-500/10 text-slate-300 border border-slate-500/30',
    needs_review: 'bg-amber-500/10 text-amber-300 border border-amber-500/30',
    blocked: 'bg-rose-500/10 text-rose-300 border border-rose-500/30',
  };

  const statusIcons = {
    validated: <CheckCircle size={14} />,
    pending: <Clock size={14} />,
    needs_review: <AlertCircle size={14} />,
    blocked: <AlertCircle size={14} />,
  };

  const paged = products.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Database size={24} className="text-cyan-400" />
          <h2 className="text-2xl font-bold text-white">Data Catalog</h2>
        </div>
        <p className="text-sm text-slate-400">View and manage all cleaned products with validated taxonomy</p>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Items', value: stats.total, icon: '📊', color: 'text-cyan-400' },
            { label: 'Validated', value: stats.validated, icon: '✓', color: 'text-emerald-400' },
            { label: 'Needs Review', value: stats.needs_review, icon: '⚠', color: 'text-amber-400' },
            { label: 'Avg Confidence', value: `${Math.round((stats.avg_confidence || 0) * 100)}%`, icon: '📈', color: 'text-violet-400' },
          ].map((stat, idx) => (
            <div key={idx} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-500">{stat.label}</p>
                <span className="text-lg">{stat.icon}</span>
              </div>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters and Search */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by SKU, name, country..."
            className="w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
        >
          <option value="all">All Status</option>
          <option value="validated">Validated</option>
          <option value="pending">Pending</option>
          <option value="needs_review">Needs Review</option>
          <option value="blocked">Blocked</option>
        </select>
      </div>

      {/* Products Table */}
      <div className="rounded-lg border border-white/10 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 animate-pulse">Loading products...</div>
        ) : paged.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No products found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 bg-white/5">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">SKU</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Product Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Country</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Classification</th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-300">Confidence</th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-300">Status</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(product => (
                  <tr
                    key={product.id}
                    onClick={() => setSelectedProduct(product)}
                    className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-slate-300 font-mono text-xs">{product.sku}</td>
                    <td className="px-4 py-3 text-white font-medium truncate">{product.name}</td>
                    <td className="px-4 py-3 text-slate-400">{product.country || '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{product.classification || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs font-semibold text-cyan-400">
                        {Math.round((product.overall_confidence || 0) * 100)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                          statusColors[product.validation_status as keyof typeof statusColors] || statusColors.pending
                        }`}
                      >
                        {statusIcons[product.validation_status as keyof typeof statusIcons]}
                        {product.validation_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {products.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 bg-white/5">
            <span className="text-xs text-slate-400">
              Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, products.length)} of {products.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded px-3 py-1 text-xs border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= products.length}
                className="rounded px-3 py-1 text-xs border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Product Detail Drawer */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-2xl border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 border-b border-white/10 bg-slate-900 p-6 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{selectedProduct.name}</h3>
              <button
                onClick={() => setSelectedProduct(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Product Image Section */}
              {selectedProduct.image_url && (
                <div className="rounded-lg bg-white/5 border border-white/10 p-4">
                  <p className="text-xs text-slate-500 mb-3">Product Image</p>
                  <div className="flex justify-center">
                    <img
                      src={selectedProduct.image_url}
                      alt={selectedProduct.image_alt_text || selectedProduct.name || 'Product image'}
                      className="max-w-full max-h-48 object-contain rounded-lg shadow-lg"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                      }}
                    />
                  </div>
                  {selectedProduct.image_alt_text && (
                    <p className="text-xs text-slate-400 mt-2 text-center">{selectedProduct.image_alt_text}</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">SKU</p>
                  <p className="text-sm font-mono text-white">{selectedProduct.sku}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Status</p>
                  <span
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                      statusColors[selectedProduct.validation_status as keyof typeof statusColors] ||
                      statusColors.pending
                    }`}
                  >
                    {statusIcons[selectedProduct.validation_status as keyof typeof statusIcons]}
                    {selectedProduct.validation_status}
                  </span>
                </div>

                <div>
                  <p className="text-xs text-slate-500 mb-1">Country</p>
                  <p className="text-sm text-white">{selectedProduct.country || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Region</p>
                  <p className="text-sm text-white">{selectedProduct.region || '—'}</p>
                </div>

                <div>
                  <p className="text-xs text-slate-500 mb-1">Classification</p>
                  <p className="text-sm text-white">{selectedProduct.classification || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Overall Confidence</p>
                  <p className="text-sm font-semibold text-cyan-400">
                    {Math.round((selectedProduct.overall_confidence || 0) * 100)}%
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-500 mb-1">Taxonomy Confidence</p>
                  <p className="text-sm font-semibold text-emerald-400">
                    {Math.round((selectedProduct.taxonomy_confidence || 0) * 100)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Description Confidence</p>
                  <p className="text-sm font-semibold text-violet-400">
                    {Math.round((selectedProduct.description_confidence || 0) * 100)}%
                  </p>
                </div>
              </div>

              {selectedProduct.full_description && (
                <div className="rounded-lg bg-white/5 border border-white/10 p-4">
                  <p className="text-xs text-slate-500 mb-2">Full Description</p>
                  <p className="text-sm text-slate-300 line-clamp-6">{selectedProduct.full_description}</p>
                </div>
              )}

              {selectedProduct.flavor_profile && (
                <div className="rounded-lg bg-white/5 border border-white/10 p-4">
                  <p className="text-xs text-slate-500 mb-2">Flavor Profile</p>
                  <p className="text-sm text-slate-300">{selectedProduct.flavor_profile}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
