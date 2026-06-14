'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type {
  SupplierPricingStructure,
  PricingMode,
  RoundingMode,
  SupplierDefinition,
} from '@/lib/supplier-intake/types';

type FormState = {
  id?: string;
  name: string;
  supplier_code: string;
  pricing_structure: SupplierPricingStructure;
  drive_bucket_folder_id: string;
  drive_folder_id: string;
  pricing_mode: PricingMode;
  target_margin_pct: number;
  minimum_margin_pct: number;
  vat_pct: number;
  rounding: RoundingMode;
  review_price_change_pct: number;
};

const EMPTY_FORM: FormState = {
  name: '',
  supplier_code: '',
  pricing_structure: 'no_rsp_price',
  drive_bucket_folder_id: '',
  drive_folder_id: '',
  pricing_mode: 'hybrid',
  target_margin_pct: 35,
  minimum_margin_pct: 25,
  vat_pct: 0,
  rounding: 'nearest_10',
  review_price_change_pct: 20,
};

function supplierToForm(s: SupplierDefinition): FormState {
  return {
    id: s.id,
    name: s.name,
    supplier_code: s.supplier_code,
    pricing_structure: s.pricing_structure,
    drive_bucket_folder_id: s.drive_bucket_folder_id ?? '',
    drive_folder_id: s.drive_folder_id ?? '',
    pricing_mode: s.pricing_rule.mode,
    target_margin_pct: s.pricing_rule.target_margin_pct,
    minimum_margin_pct: s.pricing_rule.minimum_margin_pct,
    vat_pct: s.pricing_rule.vat_pct ?? 0,
    rounding: s.pricing_rule.rounding,
    review_price_change_pct: s.pricing_rule.review_price_change_pct,
  };
}

export function SupplierSettingsPage() {
  const [suppliers, setSuppliers] = useState<SupplierDefinition[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function loadSuppliers() {
    const res = await fetch('/api/settings/suppliers');
    const json = await res.json();
    setSuppliers(json.suppliers ?? []);
  }

  useEffect(() => {
    loadSuppliers();
  }, []);

  function selectSupplier(s: SupplierDefinition) {
    setForm(supplierToForm(s));
    setSaveMsg(null);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setSaveMsg(null);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.supplier_code.trim()) {
      setSaveMsg('Name and Supplier Code are required.');
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/settings/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id,
          name: form.name.trim(),
          supplier_code: form.supplier_code.trim().toUpperCase(),
          pricing_structure: form.pricing_structure,
          drive_bucket_folder_id: form.drive_bucket_folder_id || undefined,
          drive_folder_id: form.drive_folder_id || undefined,
          pricing_rule: {
            mode: form.pricing_mode,
            target_margin_pct: form.target_margin_pct,
            minimum_margin_pct: form.minimum_margin_pct,
            vat_pct: form.vat_pct,
            rounding: form.rounding,
            review_price_change_pct: form.review_price_change_pct,
          },
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setSaveMsg(form.id ? 'Supplier updated.' : 'Supplier created.');
      resetForm();
      loadSuppliers();
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed.');
    }
    setSaving(false);
  }

  const inputCls =
    'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600';
  const selectCls =
    'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white';
  const labelCls = 'block text-xs text-slate-400 mb-1';

  return (
    <div>
      {/* Supplier list */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-slate-500">
            {suppliers.length === 0
              ? 'No suppliers configured yet.'
              : `${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''} configured.`}
          </p>
          <button
            onClick={resetForm}
            className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
          >
            <Plus size={12} /> New supplier
          </button>
        </div>
        {suppliers.length > 0 && (
          <div className="space-y-1">
            {suppliers.map(s => (
              <button
                key={s.id}
                onClick={() => selectSupplier(s)}
                className={`w-full text-left flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${
                  form.id === s.id
                    ? 'bg-violet-600/30 border border-violet-500/40'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <span className="text-sm text-white">{s.name}</span>
                <span className="text-xs text-slate-500">{s.supplier_code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Form */}
      <div className="border border-white/10 rounded-lg p-5 bg-white/3">
        <h3 className="text-xs font-medium text-slate-300 mb-4">
          {form.id ? 'Edit supplier' : 'New supplier'}
        </h3>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelCls}>Name</label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Supplier name…"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Supplier Code (2 letters)</label>
            <input
              value={form.supplier_code}
              onChange={e => set('supplier_code', e.target.value.toUpperCase().slice(0, 2))}
              placeholder="e.g. AB"
              maxLength={2}
              className={inputCls}
            />
          </div>
        </div>

        <div className="mb-4">
          <label className={labelCls}>Pricing Structure</label>
          <select
            aria-label="Pricing structure"
            value={form.pricing_structure}
            onChange={e => set('pricing_structure', e.target.value as SupplierPricingStructure)}
            className={selectCls}
          >
            <option value="rsp_price">RSP Price</option>
            <option value="no_rsp_price">No RSP Price</option>
            <option value="retail_cash_store">Retail Cash Store</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelCls}>Drive Bucket Folder ID (optional)</label>
            <input
              value={form.drive_bucket_folder_id}
              onChange={e => set('drive_bucket_folder_id', e.target.value)}
              placeholder="Google Drive folder ID…"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Drive Folder ID (optional)</label>
            <input
              value={form.drive_folder_id}
              onChange={e => set('drive_folder_id', e.target.value)}
              placeholder="Google Drive folder ID…"
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelCls}>Pricing Mode</label>
            <select
              aria-label="Pricing mode"
              value={form.pricing_mode}
              onChange={e => set('pricing_mode', e.target.value as PricingMode)}
              className={selectCls}
            >
              <option value="supplier_rsp">supplier_rsp</option>
              <option value="formula">formula</option>
              <option value="hybrid">hybrid</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Rounding</label>
            <select
              aria-label="Price rounding"
              value={form.rounding}
              onChange={e => set('rounding', e.target.value as RoundingMode)}
              className={selectCls}
            >
              <option value="none">none</option>
              <option value="nearest_1">nearest_1</option>
              <option value="nearest_5">nearest_5</option>
              <option value="nearest_9">nearest_9</option>
              <option value="nearest_10">nearest_10</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-5">
          <div>
            <label className={labelCls}>Target Margin %</label>
            <input
              type="number"
              value={form.target_margin_pct}
              onChange={e => set('target_margin_pct', Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Minimum Margin %</label>
            <input
              type="number"
              value={form.minimum_margin_pct}
              onChange={e => set('minimum_margin_pct', Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>VAT %</label>
            <input
              type="number"
              value={form.vat_pct}
              onChange={e => set('vat_pct', Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Review Price Change %</label>
            <input
              type="number"
              value={form.review_price_change_pct}
              onChange={e => set('review_price_change_pct', Number(e.target.value))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save supplier'}
          </button>
          {form.id && (
            <button
              onClick={resetForm}
              className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
            >
              Cancel
            </button>
          )}
          {saveMsg && <p className="text-xs text-slate-400">{saveMsg}</p>}
        </div>
      </div>
    </div>
  );
}
