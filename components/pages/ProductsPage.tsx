'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Edit2, X, Search, SlidersHorizontal, Layers, MapPin, Star, Droplets, Tag } from 'lucide-react';

type Product = Record<string, any>;

function parseTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(Boolean) : []; } catch { return []; }
}
function fmt(v: any) { return v === null || v === undefined || v === '' ? '—' : String(v); }
function fmtPrice(v: any, currency = 'usd') {
  if (!v && v !== 0) return '—';
  const n = parseFloat(String(v)); if (isNaN(n)) return '—';
  return (n / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() });
}
const FLAVOR_COLORS: Record<string, string> = {
  fruit: 'bg-pink-500/20 text-pink-300 border-pink-500/30', spice: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  herbal: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', earth: 'bg-stone-500/20 text-stone-300 border-stone-500/30',
  oak: 'bg-orange-500/20 text-orange-300 border-orange-500/30', floral: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  mineral: 'bg-slate-400/20 text-slate-300 border-slate-400/30', sweet: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};
const DEFAULT_FLAVOR = 'bg-blue-500/20 text-blue-300 border-blue-500/30';
function guessFlavorCat(f: string) {
  const s = f.toLowerCase();
  if (/apple|pear|cherry|plum|berry|fig|peach|citrus|lemon|lime|orange|mango|tropical|melon/.test(s)) return 'fruit';
  if (/pepper|spice|clove|cinnamon|ginger|nutmeg|vanilla/.test(s)) return 'spice';
  if (/grass|mint|herb|eucalyptus|thyme|sage|green/.test(s)) return 'herbal';
  if (/earth|soil|mushroom|truffle|leather|tobacco/.test(s)) return 'earth';
  if (/oak|cedar|wood|smoke|toast/.test(s)) return 'oak';
  if (/floral|rose|violet|jasmine|blossom|flower/.test(s)) return 'floral';
  if (/mineral|chalk|flint|stone|slate/.test(s)) return 'mineral';
  if (/honey|caramel|chocolate|cream|butter|sweet/.test(s)) return 'sweet';
  return 'other';
}
const SKU_TYPES: Record<string, string> = {
  WRW:'Red Wine',WWW:'White Wine',WSP:'Sparkling',WRS:'Rosé',WDW:'Dessert Wine',
  LWH:'Whisky',LGN:'Gin',LRM:'Rum',LTQ:'Tequila',LVK:'Vodka',LLQ:'Liqueur',
  LBD:'Brandy',LSK:'Sake',LOT:'Other Spirit',LBE:'Beer',
  ABA:'Accessory',AWC:'Wine Cooler',GWN:'Glassware',GLQ:'Glassware',GBE:'Glassware',NNA:'Non-Alcoholic',
};
function skuType(sku: string) { return SKU_TYPES[(sku??'').substring(0,3)]??'Other'; }
const STATUS_COLORS: Record<string,string> = {
  validated:'bg-emerald-500/20 text-emerald-300',
  needs_review:'bg-amber-500/20 text-amber-300',
  needs_attention:'bg-rose-500/20 text-rose-300',
};
const COUNTRIES = ['France','Italy','Australia','Scotland','Chile','Japan','USA','Spain','Mexico','England','New Zealand','Germany','Argentina','Thailand','South Africa'];
const EDITABLE = ['name','sku','brand','vintage','country','region','subregion','classification','grape_variety','wine_type','liquor_main_type','price','cost','currency','alcohol','bottle_size','validation_status'];

export function ProductsPage() {
  const [data, setData] = useState<{items:Product[];total:number;totalPages:number;page:number}|null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [status, setStatus] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Product|null>(null);
  const [panelTab, setPanelTab] = useState<'info'|'edit'|'changelog'>('info');
  const [editFields, setEditFields] = useState<Record<string,string>>({});
  const [changelog, setChangelog] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string|null>(null);
  const [statsLine, setStatsLine] = useState('');

  async function load(p=page, q=search, c=country, s=status) {
    const params = new URLSearchParams({page:String(p)});
    if (q) params.set('search',q); if (c) params.set('country',c); if (s) params.set('validation_status',s);
    const res = await fetch(`/api/products?${params}`);
    setData(await res.json());
  }

  useEffect(() => {
    fetch('/api/enrich/status').then(r=>r.json()).then(d => {
      const s = d.stats;
      if (s) setStatsLine(`${s.total.toLocaleString()} products · ${s.validated.toLocaleString()} validated · ${s.needs_review.toLocaleString()} in queue`);
    }).catch(()=>{});
  }, []);

  useEffect(() => { load(page,search,country,status); }, [page,search,country,status]);

  async function openProduct(p: Product) {
    setSelected(p); setPanelTab('info');
    setEditFields(Object.fromEntries(Object.entries(p).map(([k,v])=>[k,v!=null?String(v):''])));
    setNote(''); setSaveMsg(null); setChangelog([]);
    const res = await fetch(`/api/products/${p.id}`);
    const json = await res.json();
    if (json.changelog) setChangelog(json.changelog);
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/products/${selected.id}`,{
      method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({fields:editFields,note:note||undefined}),
    });
    const json = await res.json();
    setSaving(false);
    if (res.ok) {
      setSaveMsg('Saved'); load();
      const r2=await fetch(`/api/products/${selected.id}`); const j2=await r2.json();
      if (j2.changelog) setChangelog(j2.changelog);
    } else { setSaveMsg(json.error??'Save failed'); }
  }

  const confBadge = (conf: number) => {
    const pct=Math.round(conf*100);
    const cls=conf>=0.75?'bg-emerald-500/20 text-emerald-300':conf>=0.4?'bg-amber-500/20 text-amber-300':'bg-rose-500/20 text-rose-300';
    return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{pct}%</span>;
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Products</h1>
          {statsLine && <p className="text-xs text-slate-500 mt-0.5">{statsLine}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input placeholder="Search name or SKU…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}
              className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-slate-600 w-56" />
          </div>
          <button onClick={()=>setShowFilters(f=>!f)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${showFilters?'bg-violet-500/20 border-violet-500/40 text-violet-300':'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}>
            <SlidersHorizontal size={13}/> Filters{(country||status)?' •':''}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-2 mb-5 p-4 bg-white/5 rounded-xl border border-white/10">
          <select value={country} onChange={e=>{setCountry(e.target.value);setPage(1);}} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white">
            <option value="">All countries</option>
            {COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white">
            <option value="">All statuses</option>
            <option value="validated">Validated</option>
            <option value="needs_review">Needs review</option>
          </select>
          {(country||status) && <button onClick={()=>{setCountry('');setStatus('');setPage(1);}} className="text-xs text-slate-400 hover:text-white px-2">Clear ×</button>}
        </div>
      )}

      <div className="bg-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {['SKU','Name','Type','Country · Region','Price','Confidence','Status',''].map(h=>(
                <th key={h} className="text-left px-4 py-3 text-xs text-slate-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items??[]).map((p:Product) => {
              const conf=parseFloat(String(p.overall_confidence??0));
              return (
                <tr key={p.id} onClick={()=>openProduct(p)} className="border-b border-white/5 hover:bg-white/5 cursor-pointer">
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-white max-w-[200px] truncate">{p.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{skuType(p.sku)}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">
                    {p.country||<span className="text-slate-600 italic">unknown</span>}
                    {p.region&&<span className="text-slate-500"> · {p.region}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{fmtPrice(p.price,p.currency)}</td>
                  <td className="px-4 py-3">{confBadge(conf)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[p.validation_status??'']??'bg-slate-500/20 text-slate-300'}`}>{p.validation_status??'—'}</span>
                  </td>
                  <td className="px-4 py-2"><Edit2 size={12} className="text-slate-600"/></td>
                </tr>
              );
            })}
            {data?.items.length===0&&<tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">No products found</td></tr>}
          </tbody>
        </table>
      </div>

      {data&&data.totalPages>1&&(
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-500">{data.total.toLocaleString()} products</p>
          <div className="flex items-center gap-2">
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} className="text-slate-400 disabled:opacity-30"><ChevronLeft size={16}/></button>
            <span className="text-xs text-slate-300">Page {data.page} / {data.totalPages}</span>
            <button onClick={()=>setPage(p=>Math.min(data.totalPages,p+1))} disabled={page===data.totalPages} className="text-slate-400 disabled:opacity-30"><ChevronRight size={16}/></button>
          </div>
        </div>
      )}

      {selected&&(
        <div className="fixed inset-y-0 right-0 w-[480px] bg-slate-950 border-l border-white/10 flex flex-col z-50">
          <div className="px-6 pt-5 pb-4 border-b border-white/10 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono text-slate-500">{selected.sku} · {skuType(selected.sku)}</p>
                <h2 className="text-base font-semibold text-white mt-0.5 leading-tight">{selected.name}</h2>
                {selected.brand&&<p className="text-xs text-slate-400 mt-0.5">{selected.brand}</p>}
              </div>
              <button onClick={()=>setSelected(null)} className="text-slate-400 hover:text-white shrink-0"><X size={16}/></button>
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[selected.validation_status??'']??'bg-slate-500/20 text-slate-300'}`}>{selected.validation_status??'unvalidated'}</span>
              {confBadge(parseFloat(String(selected.overall_confidence??0)))}
              {selected.vintage&&<span className="text-xs bg-white/5 text-slate-400 rounded px-2 py-0.5">Vintage {selected.vintage}</span>}
              {selected.enrichment_source&&<span className="text-xs text-slate-500">via {selected.enrichment_source}</span>}
            </div>
            <div className="flex gap-1 mt-4">
              {(['info','edit','changelog'] as const).map(tab=>(
                <button key={tab} onClick={()=>setPanelTab(tab)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${panelTab===tab?'bg-white/10 text-white':'text-slate-400 hover:text-slate-200'}`}>
                  {tab==='info'?'Details':tab==='edit'?<><Edit2 size={10} className="inline mr-1"/>Edit</>:<><Clock size={10} className="inline mr-1"/>History</>}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {panelTab==='info'&&(
              <>
                <div className="grid grid-cols-3 gap-2">
                  {[{label:'Price',value:fmtPrice(selected.price,selected.currency)},{label:'Alcohol',value:selected.alcohol?`${selected.alcohol}%`:'—'},{label:'Bottle',value:fmt(selected.bottle_size)}].map(({label,value})=>(
                    <div key={label} className="bg-white/5 rounded-xl p-3 text-center">
                      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                      <p className="text-sm font-medium text-white">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3"><Layers size={13} className="text-violet-400"/><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Taxonomy</h3></div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                    {[{label:'Type',value:selected.wine_type||selected.liquor_main_type||skuType(selected.sku)},{label:'Classification',value:selected.classification},{label:'Grape / Variety',value:selected.grape_variety},{label:'Origin',value:selected.origin}].map(({label,value})=>(
                      <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="text-white mt-0.5">{fmt(value)}</p></div>
                    ))}
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3"><MapPin size={13} className="text-violet-400"/><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Geography</h3></div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[selected.country,selected.region,selected.subregion].filter(Boolean).map((loc,i,arr)=>(
                      <span key={i} className="flex items-center gap-1.5 text-sm text-white">{loc}{i<arr.length-1&&<span className="text-slate-600">›</span>}</span>
                    ))}
                    {!selected.country&&<span className="text-sm text-slate-500 italic">Origin unknown</span>}
                  </div>
                  {selected.enrichment_note&&<p className="text-xs text-slate-500 mt-2 italic">{selected.enrichment_note}</p>}
                </div>
                {(()=>{ const traits=parseTags(selected.character_traits); if(!traits.length) return null; return (
                  <div className="bg-white/5 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3"><Star size={13} className="text-violet-400"/><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Character</h3></div>
                    <div className="flex flex-wrap gap-2">{traits.map(t=><span key={t} className="px-3 py-1 rounded-full text-xs font-medium bg-violet-500/15 text-violet-300 border border-violet-500/25 capitalize">{t}</span>)}</div>
                  </div>
                ); })()}
                {(()=>{ const flavors=parseTags(selected.flavor_profile); if(!flavors.length) return null;
                  const grouped=flavors.reduce<Record<string,string[]>>((acc,f)=>{const c=guessFlavorCat(f);acc[c]=[...(acc[c]||[]),f];return acc;},{});
                  return (
                    <div className="bg-white/5 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3"><Droplets size={13} className="text-violet-400"/><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Flavour Profile</h3></div>
                      {Object.entries(grouped).map(([cat,items])=>(
                        <div key={cat} className="mb-3 last:mb-0">
                          <p className="text-xs text-slate-500 mb-1.5 capitalize">{cat}</p>
                          <div className="flex flex-wrap gap-1.5">{items.map(f=><span key={f} className={`px-2.5 py-1 rounded-full text-xs border ${FLAVOR_COLORS[cat]??DEFAULT_FLAVOR}`}>{f}</span>)}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3"><Tag size={13} className="text-violet-400"/><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Confidence</h3></div>
                  {[{label:'Overall',value:parseFloat(String(selected.overall_confidence??0))},{label:'Taxonomy',value:parseFloat(String(selected.taxonomy_confidence??0))}].map(({label,value})=>(
                    <div key={label} className="mb-2.5 last:mb-0">
                      <div className="flex justify-between text-xs mb-1"><span className="text-slate-400">{label}</span><span className={value>=0.75?'text-emerald-400':value>=0.4?'text-amber-400':'text-rose-400'}>{Math.round(value*100)}%</span></div>
                      <div className="h-1.5 bg-white/10 rounded-full"><div className={`h-1.5 rounded-full ${value>=0.75?'bg-emerald-500':value>=0.4?'bg-amber-500':'bg-rose-500'}`} style={{width:`${Math.round(value*100)}%`}}/></div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {panelTab==='edit'&&(
              <div className="space-y-3">
                {EDITABLE.map(field=>(
                  <div key={field}>
                    <label className="text-xs text-slate-400 block mb-1 capitalize">{field.replace(/_/g,' ')}</label>
                    <input value={editFields[field]??''} onChange={e=>setEditFields(f=>({...f,[field]:e.target.value}))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500/50 focus:outline-none"/>
                  </div>
                ))}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Note (optional)</label>
                  <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Reason for this change…"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600"/>
                </div>
              </div>
            )}
            {panelTab==='changelog'&&(
              <div className="space-y-2">
                {changelog.length===0&&<p className="text-slate-500 text-sm">No changes recorded yet.</p>}
                {changelog.map((entry,i)=>(
                  <div key={i} className="bg-white/5 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-violet-300">{entry.source}</span>
                      <span className="text-xs text-slate-500">{new Date(entry.changed_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-slate-300"><span className="text-slate-500">{entry.field}:</span> {entry.old_value??'∅'} → {entry.new_value??'∅'}</p>
                    {entry.note&&<p className="text-xs text-slate-500 mt-1 italic">{entry.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {panelTab==='edit'&&(
            <div className="px-6 py-4 border-t border-white/10 shrink-0">
              {saveMsg&&<p className="text-xs text-slate-400 mb-2">{saveMsg}</p>}
              <button onClick={handleSave} disabled={saving}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl font-medium transition-colors">
                {saving?'Saving…':'Save changes'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
