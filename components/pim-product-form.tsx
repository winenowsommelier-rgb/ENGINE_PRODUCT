'use client';

/**
 * pim-product-form.tsx
 * Full PIM product attribute form using master taxonomy hierarchy.
 * Cascading selects: Category → Country → Region → Sub-region → Origin → Classification → Ingredient → Flavours
 */

import { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import {
  countries, getRegionsByCountry, getSubregionsByRegion, getOriginsBySubregion,
  getIngredientsByScope, getClassificationsByScope, getFlavourFamilies, getFlavoursByFamily,
  categoryConfigs, type TaxIngredient, type TaxFlavour,
} from '@/lib/taxonomy-service';
import { buildFlavorProfile, calculateConfidence } from '@/lib/auto-mapping';
import type { ProductRecord } from '@/lib/data';

// ─── PIM Product (extended ProductRecord with all taxonomy fields) ─────────────

export type PIMProduct = {
  // Core identity
  sku: string;
  name: string;
  brand: string;
  status: 'Ready' | 'Needs review' | 'Draft';
  // Category & type
  mainCategory: string;        // from category_render_config
  wine_type: string;           // Red Wine, White Wine, Rosé, etc.
  liquor_main_type: string;    // Rum, Whisky, Tequila, etc.
  other_type: string;
  whisky_type: string;
  // Geography (cascading)
  country: string;
  countryId: number | null;
  region: string;
  regionId: number | null;
  subregion: string;
  subregionId: number | null;
  origin: string;
  // Taxonomy
  classificationId: number | null;
  classification: string;
  ingredients: string[];       // canonical names from ingredient_master
  flavorNotes: string[];       // from flavor_note_master
  // Product specs
  vintage: string;
  bottle_size: string;
  alcohol: string;
  // Pricing
  price: number;
  costPrice: number;
  currency: string;
  // Sensory (for flavor radar)
  oak: number;
};

export function emptyPIMProduct(): PIMProduct {
  return {
    sku: '', name: '', brand: '', status: 'Draft',
    mainCategory: '', wine_type: '', liquor_main_type: '', other_type: '', whisky_type: '',
    country: '', countryId: null, region: '', regionId: null, subregion: '', subregionId: null, origin: '',
    classificationId: null, classification: '', ingredients: [], flavorNotes: [],
    vintage: '', bottle_size: '', alcohol: '',
    price: 0, costPrice: 0, currency: 'THB', oak: 0,
  };
}

export function pimProductToProductRecord(p: PIMProduct): ProductRecord {
  return {
    sku: p.sku,
    name: p.name,
    category: p.mainCategory.toLowerCase().includes('spirit') || p.liquor_main_type ? 'Spirits' : 'Wine',
    type: p.wine_type || p.liquor_main_type || p.mainCategory,
    grape: p.ingredients[0] ?? '',
    region: p.region,
    style: p.classification || '',
    price: p.price,
    costPrice: p.costPrice,
    currency: p.currency,
    status: p.status,
    oak: p.oak,
    country: p.country,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">{children}</p>;
}

function Select({ value, onChange, children, disabled }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-40 focus:border-violet-400/40 focus:outline-none">
      {children}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-violet-400/40 focus:outline-none" />
  );
}

// Multi-select pill picker for ingredients and flavour notes
function MultiPicker<T extends { id: number; label: string; group?: string }>({
  label, all, selected, onToggle, groupKey,
}: {
  label: string;
  all: T[];
  selected: string[];
  onToggle: (label: string) => void;
  groupKey?: keyof T;
}) {
  const [open, setOpen] = useState(false);
  const grouped = useMemo(() => {
    if (!groupKey) return new Map([['', all]]);
    const map = new Map<string, T[]>();
    for (const item of all) {
      const g = String(item[groupKey] ?? '');
      const arr = map.get(g) ?? [];
      arr.push(item);
      map.set(g, arr);
    }
    return map;
  }, [all, groupKey]);

  return (
    <div>
      <Label>{label}</Label>
      {/* Selected pills */}
      <div className="mb-2 flex flex-wrap gap-1.5 min-h-8">
        {selected.map(s => (
          <span key={s} className="flex items-center gap-1 rounded-full bg-violet-500/20 px-2.5 py-1 text-xs text-violet-200">
            {s}
            <button onClick={() => onToggle(s)} className="hover:text-rose-300"><X size={10} /></button>
          </span>
        ))}
        {selected.length === 0 && <span className="text-xs text-slate-600">None selected</span>}
      </div>
      {/* Picker toggle */}
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-1.5 text-xs text-slate-400 hover:border-violet-400/30 hover:text-violet-300">
        <ChevronDown size={11} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        {open ? 'Close picker' : 'Pick…'}
      </button>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-3 space-y-4">
          {[...grouped.entries()].map(([group, items]) => (
            <div key={group}>
              {group && <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{group.replace(/_/g, ' ')}</p>}
              <div className="flex flex-wrap gap-1.5">
                {items.map(item => {
                  const isSelected = selected.includes(item.label);
                  return (
                    <button key={item.id} type="button" onClick={() => onToggle(item.label)}
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${isSelected ? 'border-violet-400/40 bg-violet-500/20 text-violet-200' : 'border-white/10 bg-white/5 text-slate-300 hover:border-violet-400/20 hover:text-white'}`}>
                      {isSelected && <Check size={9} />}
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main PIMProductForm ──────────────────────────────────────────────────────

export function PIMProductForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<PIMProduct>;
  onSave: (product: PIMProduct) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<PIMProduct>({ ...emptyPIMProduct(), ...initial });

  function set<K extends keyof PIMProduct>(key: K, value: PIMProduct[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  // ── Cascading data based on selections ──────────────────────────────────────
  const availableRegions = useMemo(() =>
    form.countryId ? getRegionsByCountry(form.countryId) : [], [form.countryId]);

  const availableSubregions = useMemo(() =>
    form.regionId ? getSubregionsByRegion(form.regionId) : [], [form.regionId]);

  const availableOrigins = useMemo(() =>
    form.subregionId ? getOriginsBySubregion(form.subregionId) : [], [form.subregionId]);

  const isWine = useMemo(() =>
    form.mainCategory === 'wine' || form.mainCategory === 'sparkling_wine' ||
    form.wine_type.toLowerCase().includes('wine'), [form.mainCategory, form.wine_type]);

  const activeScope = useMemo(() => {
    if (!form.mainCategory) return 'all';
    // Map category config keys to ingredient scope keys
    const scopeMap: Record<string, string> = {
      wine: 'wine', sparkling_wine: 'wine', whisky: 'whisky', rum: 'rum',
      tequila: 'tequila', gin: 'gin', vodka: 'gin', sake: 'sake', liqueur: 'liqueur',
    };
    return scopeMap[form.mainCategory] ?? 'all';
  }, [form.mainCategory]);

  const availableIngredients = useMemo(() => {
    const raw = getIngredientsByScope(activeScope);
    return raw.map(i => ({ id: i.ingredient_id, label: i.ingredient, group: i.ingredient_group }));
  }, [activeScope]);

  const flavourFamilies = useMemo(() => getFlavourFamilies(), []);
  const allFlavours = useMemo(() => {
    return flavourFamilies.flatMap(fam =>
      getFlavoursByFamily(fam).map(f => ({ id: f.note_id, label: f.note, group: f.note_family }))
    );
  }, [flavourFamilies]);

  const availableClassifications = useMemo(() => getClassificationsByScope(activeScope), [activeScope]);

  // Live flavor profile preview
  const liveProfile = useMemo(() => buildFlavorProfile(pimProductToProductRecord(form)), [form]);
  const liveConfidence = useMemo(() => calculateConfidence(pimProductToProductRecord(form)), [form]);

  // Wine types from Magento taxonomy
  const WINE_TYPES = ['Red Wine', 'White Wine', 'Rosé Wine', 'Sparkling Wine', 'Champagne', 'Prosecco', 'Cava', 'Dessert Wine', 'Fortified Wine', 'Orange Wine'];
  const SPIRIT_TYPES = ['Rum', 'Whisky', 'Scotch Whisky', 'Bourbon', 'Irish Whiskey', 'Japanese Whisky', 'Tequila', 'Mezcal', 'Gin', 'Vodka', 'Cognac', 'Brandy', 'Calvados', 'Armagnac', 'Grappa', 'Liqueur', 'Sake', 'Baijiu'];
  const BOTTLE_SIZES = ['187 ml', '375 ml', '500 ml', '700 ml', '750 ml', '1 L', '1.5 L', '3 L', '6 L'];
  const CURRENCIES = ['THB', 'USD', 'EUR', 'GBP', 'AUD', 'NZD', 'SGD', 'JPY'];

  function toggleIngredient(name: string) {
    set('ingredients', form.ingredients.includes(name)
      ? form.ingredients.filter(i => i !== name)
      : [...form.ingredients, name]);
  }

  function toggleFlavour(name: string) {
    set('flavorNotes', form.flavorNotes.includes(name)
      ? form.flavorNotes.filter(f => f !== name)
      : [...form.flavorNotes, name]);
  }

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-6">

      {/* ── Section 1: Identity ── */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Identity</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SKU">
            <TextInput value={form.sku} onChange={v => set('sku', v.toUpperCase())} placeholder="e.g. WN-1001" />
          </Field>
          <Field label="Brand">
            <TextInput value={form.brand} onChange={v => set('brand', v)} placeholder="e.g. Château Margaux" />
          </Field>
        </div>
        <Field label="Product name">
          <TextInput value={form.name} onChange={v => set('name', v)} placeholder="Full product name" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Vintage">
            <TextInput value={form.vintage} onChange={v => set('vintage', v)} placeholder="e.g. 2021" />
          </Field>
          <Field label="Bottle size">
            <Select value={form.bottle_size} onChange={v => set('bottle_size', v)}>
              <option value="">Select size</option>
              {BOTTLE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Alcohol %">
            <TextInput value={form.alcohol} onChange={v => set('alcohol', v)} placeholder="e.g. 13.5" />
          </Field>
        </div>
        <Field label="Status">
          <Select value={form.status} onChange={v => set('status', v as PIMProduct['status'])}>
            <option value="Draft">Draft</option>
            <option value="Needs review">Needs review</option>
            <option value="Ready">Ready</option>
          </Select>
        </Field>
      </section>

      {/* ── Section 2: Category & Type ── */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Category & Type</p>
        <Field label="Main category">
          <Select value={form.mainCategory} onChange={v => {
            set('mainCategory', v);
            set('wine_type', ''); set('liquor_main_type', '');
          }}>
            <option value="">Select category…</option>
            {categoryConfigs.filter(c => c.is_active).map(c => (
              <option key={c.category} value={c.category}>{c.category.replace(/_/g, ' ')}</option>
            ))}
          </Select>
        </Field>
        {form.mainCategory && (
          <div className="grid gap-4 sm:grid-cols-2">
            {(form.mainCategory === 'wine' || form.mainCategory === 'sparkling_wine') ? (
              <Field label="Wine type">
                <Select value={form.wine_type} onChange={v => set('wine_type', v)}>
                  <option value="">Select wine type…</option>
                  {WINE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Spirit type">
                <Select value={form.liquor_main_type} onChange={v => set('liquor_main_type', v)}>
                  <option value="">Select spirit type…</option>
                  {SPIRIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Other / sub-type">
              <TextInput value={form.other_type} onChange={v => set('other_type', v)} placeholder="e.g. Single Malt, NV…" />
            </Field>
          </div>
        )}
        {form.liquor_main_type.toLowerCase().includes('whisky') || form.liquor_main_type.toLowerCase().includes('whiskey') ? (
          <Field label="Whisky type">
            <Select value={form.whisky_type} onChange={v => set('whisky_type', v)}>
              <option value="">Select whisky type…</option>
              {['Single Malt', 'Blended Malt', 'Blended', 'Single Grain', 'Blended Grain'].map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
        ) : null}
      </section>

      {/* ── Section 3: Geography (cascading) ── */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Geography</p>

        {/* Country */}
        <Field label="Country">
          <Select value={form.countryId?.toString() ?? ''} onChange={v => {
            const id = Number(v) || null;
            const c = countries.find(x => x.id === id);
            set('countryId', id); set('country', c?.name ?? '');
            set('regionId', null); set('region', '');
            set('subregionId', null); set('subregion', '');
            set('origin', '');
          }}>
            <option value="">Select country…</option>
            {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>

        {/* Region */}
        <Field label="Region">
          <Select value={form.regionId?.toString() ?? ''} onChange={v => {
            const id = Number(v) || null;
            const r = availableRegions.find(x => x.id === id);
            set('regionId', id); set('region', r?.name ?? '');
            set('subregionId', null); set('subregion', '');
            set('origin', '');
          }} disabled={!form.countryId}>
            <option value="">{form.countryId ? 'Select region…' : '— select country first —'}</option>
            {availableRegions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>

        {/* Sub-region */}
        <Field label="Sub-region / Appellation zone">
          <Select value={form.subregionId?.toString() ?? ''} onChange={v => {
            const id = Number(v) || null;
            const sr = availableSubregions.find(x => x.id === id);
            set('subregionId', id); set('subregion', sr?.name ?? '');
            set('origin', '');
          }} disabled={!form.regionId}>
            <option value="">{form.regionId ? (availableSubregions.length ? 'Select sub-region…' : '— no sub-regions —') : '— select region first —'}</option>
            {availableSubregions.map(sr => <option key={sr.id} value={sr.id}>{sr.name}</option>)}
          </Select>
        </Field>

        {/* Origin / Appellation */}
        {availableOrigins.length > 0 && (
          <Field label="Origin / Appellation">
            <Select value={form.origin} onChange={v => set('origin', v)}>
              <option value="">Select origin…</option>
              {availableOrigins.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
            </Select>
          </Field>
        )}
      </section>

      {/* ── Section 4: Classification ── */}
      {availableClassifications.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Classification</p>
          <Field label={`Classification (${activeScope} scope)`}>
            <Select value={form.classificationId?.toString() ?? ''} onChange={v => {
              const id = Number(v) || null;
              const c = availableClassifications.find(x => x.classification_id === id);
              set('classificationId', id); set('classification', c?.classification ?? '');
            }}>
              <option value="">None / not applicable</option>
              {availableClassifications.sort((a, b) => a.priority - b.priority).map(c => (
                <option key={c.classification_id} value={c.classification_id}>
                  {c.classification}{c.classification_group ? ` (${c.classification_group.replace(/_/g, ' ')})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          {form.classification && (
            <div className="rounded-xl bg-violet-500/10 border border-violet-400/20 px-3 py-2 text-xs text-violet-200">
              {availableClassifications.find(c => c.classification === form.classification)?.description}
            </div>
          )}
        </section>
      )}

      {/* ── Section 5: Ingredients / Grapes ── */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Ingredients & Grapes</p>
        <MultiPicker
          label={`Primary ingredient${isWine ? ' / Grape variety' : ''}`}
          all={availableIngredients}
          selected={form.ingredients}
          onToggle={toggleIngredient}
          groupKey="group"
        />
      </section>

      {/* ── Section 6: Flavour notes ── */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Flavour profile</p>
        <MultiPicker
          label="Tasting notes"
          all={allFlavours}
          selected={form.flavorNotes}
          onToggle={toggleFlavour}
          groupKey="group"
        />

        {/* Live sensory radar preview */}
        {form.ingredients.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-white">Live sensory preview</p>
              <span className="text-xs text-slate-400">Confidence {(liveConfidence / 5 * 100).toFixed(0)}%</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Body', value: liveProfile.body },
                { label: 'Acidity', value: liveProfile.acidity },
                { label: 'Tannin', value: liveProfile.tannin },
                { label: 'Sweetness', value: liveProfile.sweetness },
                { label: 'Intensity', value: liveProfile.intensity },
                { label: 'Finish', value: liveProfile.finish },
              ].map(item => (
                <div key={item.label}>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-slate-400">{item.label}</span>
                    <span className="text-white">{item.value.toFixed(1)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400" style={{ width: `${(item.value / 5) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Oak intensity */}
        <div>
          <Label>Oak intensity</Label>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={5} step={0.5} value={form.oak} onChange={e => set('oak', Number(e.target.value))}
              className="flex-1 accent-violet-400" />
            <span className="w-10 text-center text-sm font-semibold text-white">{form.oak}/5</span>
          </div>
        </div>
      </section>

      {/* ── Section 7: Pricing ── */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Pricing</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Retail price">
            <input type="number" min={0} step={0.01} value={form.price || ''} onChange={e => set('price', Number(e.target.value))}
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white focus:border-violet-400/40 focus:outline-none" />
          </Field>
          <Field label="Cost price">
            <input type="number" min={0} step={0.01} value={form.costPrice || ''} onChange={e => set('costPrice', Number(e.target.value))}
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white focus:border-violet-400/40 focus:outline-none" />
          </Field>
          <Field label="Currency">
            <Select value={form.currency} onChange={v => set('currency', v)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        {form.price > 0 && form.costPrice > 0 && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-4 py-2 flex items-center gap-6 text-sm">
            <span className="text-slate-400">Margin</span>
            <span className="font-semibold text-emerald-300">{form.currency} {(form.price - form.costPrice).toFixed(2)}</span>
            <span className="text-emerald-400">{(((form.price - form.costPrice) / form.price) * 100).toFixed(1)}%</span>
          </div>
        )}
      </section>

      {/* ── Actions ── */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="rounded-full border border-white/10 px-6 py-2.5 text-sm text-slate-300 hover:text-white">
            Cancel
          </button>
        )}
        <button type="submit"
          className="rounded-full bg-violet-500 px-8 py-2.5 text-sm font-semibold text-white hover:bg-violet-400">
          Save product
        </button>
      </div>
    </form>
  );
}
