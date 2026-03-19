const taxonomyMetrics = [
  { label: 'Active SKUs', count: '10,482', detail: '+12.4% vs last import' },
  { label: 'Low confidence rows', count: '182', detail: '1.7% of current batch' },
  { label: 'Taxonomy tabs', count: '10', detail: 'Loaded from the global taxonomy workbook' },
  { label: 'Exports', count: '38', detail: 'Magento-ready feeds this week' }
];

const products = [
  { sku: 'WN-1001', name: 'Silver Ridge Napa Cabernet Sauvignon', grape: 'Cabernet Sauvignon', region: 'Napa Valley', style: 'Structured & Oak-Aged', status: 'Ready', category: 'Wine', type: 'Red Wine', country: 'USA', oak: 4, confidence: '5.0', metrics: { Body: 4.4, Acidity: 2.8, Tannin: 4.4, Sweetness: 0.4, Intensity: 3.8, Finish: 4.0 } },
  { sku: 'WN-1002', name: 'Azure Coast Marlborough Sauvignon Blanc', grape: 'Sauvignon Blanc', region: 'Marlborough', style: 'Crisp & Aromatic', status: 'Ready', category: 'Wine', type: 'White Wine', country: 'New Zealand', oak: 0, confidence: '5.0', metrics: { Body: 1.7, Acidity: 4.1, Tannin: 0.1, Sweetness: 0.6, Intensity: 2.9, Finish: 2.5 } },
  { sku: 'WN-2010', name: 'Casa Naranja Tequila Reposado', grape: 'Blue Weber Agave', region: 'Jalisco Highlands', style: 'Barrel Rested', status: 'Needs review', category: 'Spirits', type: 'Agave Spirit', country: 'Mexico', oak: 3, confidence: '4.4', metrics: { Body: 4.0, Acidity: 1.3, Tannin: 0.2, Sweetness: 1.0, Intensity: 2.8, Finish: 3.0 } },
  { sku: 'WN-3100', name: 'Velvet Ember Willamette Pinot Noir', grape: 'Pinot Noir', region: 'Willamette Valley', style: 'Elegant & Earthy', status: 'Draft', category: 'Wine', type: 'Red Wine', country: 'USA', oak: 2, confidence: '4.4', metrics: { Body: 2.6, Acidity: 3.7, Tannin: 2.3, Sweetness: 0.5, Intensity: 2.5, Finish: 2.5 } }
];

const importRows = [
  {
    name: 'Golden Mesa Reserve Cabernet',
    sku: 'WN-1003',
    region: 'Napa Valley',
    style: 'Structured & Oak-Aged',
    status: 'Ready',
    confidence: '5.0',
    corrections: ['sku:  wn-1003  → WN-1003', 'grape: cab sauv → Cabernet Sauvignon', 'region: napa → Napa Valley', 'style: structured oak aged → Structured & Oak-Aged'],
    issues: ['confidence: Confidence meets the auto-import threshold.']
  },
  {
    name: 'Untitled Marlboro Blanc',
    sku: 'Missing SKU',
    region: 'Marlborough',
    style: 'Crisp & Aromatic',
    status: 'Blocked',
    confidence: '3.6',
    corrections: ['grape: sauv blanc → Sauvignon Blanc', 'region: marlboro → Marlborough', 'style: crisp aromatic → Crisp & Aromatic'],
    issues: ['sku: SKU is required for batch import.', 'confidence: Row remains below the confidence threshold and should be reviewed.']
  },
  {
    name: 'Casa Naranja Highland Reposado',
    sku: 'WN-2011',
    region: 'Jalisco Highlands',
    style: 'Barrel Rested',
    status: 'Ready',
    confidence: '5.0',
    corrections: ['sku:   wn-2011 → WN-2011', 'grape: agave → Blue Weber Agave', 'region: jalisco → Jalisco Highlands'],
    issues: ['confidence: Confidence meets the auto-import threshold.']
  }
];

const taxonomySheets = [
  ['countries', 'Canonical origin-country lookup with IDs and ISO codes.'],
  ['regions', 'Primary regional taxonomy used for origin and merchandising filters.'],
  ['subregions', 'Nested appellations or secondary location groupings.'],
  ['Origin', 'Origin-facing mapping layer that should be aligned with regions/countries.'],
  ['classification_master', 'Product classification and taxonomy control rules.'],
  ['ingredient_master', 'Controlled ingredient vocabulary for products and blends.'],
  ['flavor_note_master', 'Approved tasting-note vocabulary for enrichment and rendering.'],
  ['category_render_config', 'UI/render configuration by product category.'],
  ['expert_sources', 'External validation references and citation sources.'],
  ['Magento item data', 'Commerce/export-oriented column mapping layer.']
];

const taxonomyIssues = [
  ['Tab naming', 'The workbook mixes snake_case tabs with human-readable names like Origin and Magento item data.', 'warning'],
  ['Country row formatting', 'The final visible country entry appears malformed as Other (N/A)NA.', 'warning'],
  ['ISO strategy', 'The workbook mixes ISO alpha-2 and sub-national ISO values.', 'good']
];

const countries = [
  [1, 'France', 'FR'], [2, 'Italy', 'IT'], [3, 'Spain', 'ES'], [4, 'Germany', 'DE'], [5, 'Portugal', 'PT'], [6, 'USA', 'US'], [7, 'Chile', 'CL'], [8, 'Argentina', 'AR'], [9, 'Australia', 'AU'], [10, 'New Zealand', 'NZ'], [11, 'South Africa', 'ZA'], [12, 'Austria', 'AT'], [13, 'Greece', 'GR'], [14, 'Hungary', 'HU'], [15, 'Canada', 'CA'], [16, 'Japan', 'JP'], [17, 'Mexico', 'MX'], [18, 'Scotland', 'GB-SCT'], [19, 'Ireland', 'IE'], [20, 'China', 'CN'], [21, 'England', 'GB-ENG'], [22, 'Brazil', 'BR'], [23, 'Uruguay', 'UY'], [24, 'Lebanon', 'LB'], [25, 'Israel', 'IL'], [26, 'Georgia', 'GE'], [27, 'Thailand', 'TH'], [28, 'Other (N/A)', 'NA']
];

const workspaces = ['Overview', 'Catalog workspace', 'Import studio', 'Taxonomy control'];
let activeWorkspace = 'Overview';
let activeProduct = 0;
let activeImport = 0;

const statsEl = document.getElementById('top-stats');
statsEl.innerHTML = taxonomyMetrics.map(metric => `
  <article class="metric">
    <div class="metric-label">${metric.label}</div>
    <div class="metric-value">${metric.count}</div>
    <div class="metric-detail">${metric.detail}</div>
  </article>
`).join('');

const navEl = document.getElementById('workspace-nav');
const contentEl = document.getElementById('workspace-content');

function pill(text, tone = 'good') {
  return `<span class="status-pill ${tone}">${text}</span>`;
}

function renderRadar(metrics) {
  const labels = Object.keys(metrics);
  const values = Object.values(metrics);
  const center = 150;
  const radius = 100;
  const levels = [0.2, 0.4, 0.6, 0.8, 1];
  const toPoint = (value, index, scale = 1) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / labels.length;
    const scaled = radius * scale * (value / 5);
    return [center + Math.cos(angle) * scaled, center + Math.sin(angle) * scaled];
  };
  const polygon = values.map((value, index) => toPoint(value, index).join(',')).join(' ');
  const grids = levels.map(level => {
    const points = labels.map((_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / labels.length;
      return `${center + Math.cos(angle) * radius * level},${center + Math.sin(angle) * radius * level}`;
    }).join(' ');
    return `<polygon points="${points}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"></polygon>`;
  }).join('');
  const spokes = labels.map((label, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / labels.length;
    const x = center + Math.cos(angle) * (radius + 26);
    const y = center + Math.sin(angle) * (radius + 26);
    return `<line x1="${center}" y1="${center}" x2="${center + Math.cos(angle) * radius}" y2="${center + Math.sin(angle) * radius}" stroke="rgba(255,255,255,0.12)"></line><text x="${x}" y="${y}" text-anchor="middle" fill="#cbd5e1" font-size="12">${label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 300 300" width="300" height="300">${grids}${spokes}<polygon points="${polygon}" fill="rgba(124,58,237,0.3)" stroke="#c4b5fd" stroke-width="2"></polygon>${values.map((value, index) => { const [x, y] = toPoint(value, index); return `<circle cx="${x}" cy="${y}" r="4" fill="#f5d0fe"></circle>`; }).join('')}</svg>`;
}

function renderOverview() {
  return `
    <div class="workspace-layout">
      <section class="card stack">
        <div>
          <div class="section-label">Overview</div>
          <h2>Frontend ready to access</h2>
          <p>The preview is available immediately with the Python server command shown above, and the Next.js app remains in the repo for when package installation is allowed.</p>
        </div>
        <div class="grid-3">
          <article class="metric"><div class="metric-label">Products</div><div class="metric-value">${products.length}</div><div class="metric-detail">Sample catalog rows</div></article>
          <article class="metric"><div class="metric-label">Import rows</div><div class="metric-value">${importRows.length}</div><div class="metric-detail">Rows in the review queue</div></article>
          <article class="metric"><div class="metric-label">Countries</div><div class="metric-value">${countries.length}</div><div class="metric-detail">Visible taxonomy entries</div></article>
        </div>
      </section>
      <section class="card stack">
        <div>
          <div class="section-label">Supabase status</div>
          <h2>Configuration context</h2>
        </div>
        <div class="list-card">${pill('URL configured')} ${pill('Publishable key configured')} ${pill('Password stays local', 'warn')}</div>
        <div class="list-card"><strong>Project URL</strong><p class="small-copy">https://xfcvliyxxguhihehqwkg.supabase.co</p></div>
        <div class="list-card"><strong>Direct DB URL template</strong><p class="small-copy">postgresql://postgres:[YOUR-PASSWORD]@db.xfcvliyxxguhihehqwkg.supabase.co:5432/postgres</p></div>
      </section>
    </div>
  `;
}

function renderCatalog() {
  const productList = products.map((product, index) => `
    <button class="list-button ${index === activeProduct ? 'active' : ''}" onclick="selectProduct(${index})">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div>
          <strong>${product.name}</strong>
          <div class="list-meta">${product.grape} · ${product.region} · ${product.style}</div>
        </div>
        ${pill(product.status, product.status === 'Ready' ? 'good' : product.status === 'Needs review' ? 'warn' : 'bad')}
      </div>
      <div class="meta-row">
        <span class="pill">${product.sku}</span>
        <span class="pill">Confidence ${product.confidence}/5</span>
        <span class="pill">${product.country}</span>
      </div>
    </button>
  `).join('');
  const product = products[activeProduct];
  const flavorRows = Object.entries(product.metrics).map(([label, value]) => `
    <div class="progress-row">
      <div class="progress-head"><span>${label}</span><span>${value.toFixed(1)}/5</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${value * 20}%"></div></div>
    </div>
  `).join('');
  return `
    <div class="workspace-layout">
      <section class="card stack">
        <div><div class="section-label">Catalog workspace</div><h2>Browse products</h2><p>Select a row to inspect it.</p></div>
        ${productList}
      </section>
      <div class="stack">
        <section class="card stack">
          <div><div class="section-label">Selected product</div><h2>${product.name}</h2><p>${product.type} · ${product.country}</p></div>
          <div class="grid-2">
            <div class="radar-wrap">${renderRadar(product.metrics)}</div>
            <div class="stack">
              <div class="info-grid">
                <div class="kpi"><div class="metric-label">Category</div><div class="metric-detail">${product.category}</div></div>
                <div class="kpi"><div class="metric-label">Type</div><div class="metric-detail">${product.type}</div></div>
                <div class="kpi"><div class="metric-label">Country</div><div class="metric-detail">${product.country}</div></div>
                <div class="kpi"><div class="metric-label">Oak</div><div class="metric-detail">${product.oak}/5</div></div>
              </div>
              <div class="list-card"><strong>Pairing logic</strong><p class="small-copy">High tannin and elevated body bind to protein-rich dishes while oak-derived spice reinforces roasted and umami-driven preparations.</p></div>
            </div>
          </div>
        </section>
        <section class="card stack">
          <div><div class="section-label">Flavor distribution</div><h2>Metric detail</h2></div>
          ${flavorRows}
        </section>
      </div>
    </div>
  `;
}

function renderImportStudio() {
  const list = importRows.map((row, index) => `
    <button class="list-button ${index === activeImport ? 'active' : ''}" onclick="selectImportRow(${index})">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div>
          <strong>${row.name}</strong>
          <div class="list-meta">${row.sku} · ${row.region} · ${row.style}</div>
        </div>
        ${pill(row.status, row.status === 'Blocked' ? 'bad' : 'good')}
      </div>
      <div class="meta-row">
        <span class="pill">Corrections ${row.corrections.length}</span>
        <span class="pill">Issues ${row.issues.length}</span>
        <span class="pill">Confidence ${row.confidence}/5</span>
      </div>
    </button>
  `).join('');
  const row = importRows[activeImport];
  return `
    <div class="workspace-layout">
      <section class="card stack">
        <div><div class="section-label">Import studio</div><h2>Self-healing review queue</h2><p>Inspect how the batch process normalized each row.</p></div>
        <div class="grid-4">
          <article class="metric"><div class="metric-label">Rows previewed</div><div class="metric-value">3</div></article>
          <article class="metric"><div class="metric-label">Auto-corrected</div><div class="metric-value">3</div></article>
          <article class="metric"><div class="metric-label">Ready</div><div class="metric-value">2</div></article>
          <article class="metric"><div class="metric-label">Blocked</div><div class="metric-value">1</div></article>
        </div>
        ${list}
      </section>
      <div class="stack">
        <section class="card stack">
          <div><div class="section-label">Selected row</div><h2>${row.name}</h2><p>${row.region} · ${row.style}</p></div>
          <div class="grid-2">
            <div class="list-card"><strong>Corrections</strong>${row.corrections.map(item => `<div class="issue-card">${item}</div>`).join('')}</div>
            <div class="list-card"><strong>Issues</strong>${row.issues.map(item => `<div class="issue-card">${item}</div>`).join('')}</div>
          </div>
        </section>
        <section class="card stack">
          <div><div class="section-label">Excel process</div><h2>How to prepare your file</h2></div>
          ${['Download the CSV template and keep the header row unchanged.', 'Paste or export your Excel data into the template columns.', 'Run the self-healing import preview.', 'Approve only rows with valid SKU and acceptable confidence.'].map(step => `<div class="list-card">${step}</div>`).join('')}
        </section>
      </div>
    </div>
  `;
}

function renderTaxonomy() {
  return `
    <div class="workspace-layout">
      <section class="card stack">
        <div><div class="section-label">Taxonomy control</div><h2>Workbook sheet review</h2><p>Use this registry as the current spreadsheet map.</p></div>
        ${taxonomySheets.map(([name, purpose]) => `<div class="list-card"><strong>${name}</strong><p class="small-copy">${purpose}</p></div>`).join('')}
      </section>
      <div class="stack">
        <section class="card stack">
          <div><div class="section-label">Audit findings</div><h2>Cleanup guidance</h2></div>
          ${taxonomyIssues.map(([title, message, tone]) => `<div class="issue-card"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;"><strong>${title}</strong>${pill(tone === 'good' ? 'info' : 'warning', tone === 'good' ? 'good' : 'warn')}</div><p class="small-copy">${message}</p></div>`).join('')}
        </section>
        <section class="card stack">
          <div><div class="section-label">Country registry</div><h2>Visible countries and markets</h2></div>
          <div class="table">
            <div class="table-head"><span>ID</span><span>Name</span><span>ISO</span></div>
            ${countries.map(country => `<div class="table-row"><span>${country[0]}</span><span>${country[1]}</span><span>${country[2]}</span></div>`).join('')}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderNav() {
  navEl.innerHTML = workspaces.map(workspace => `
    <button class="workspace-button ${workspace === activeWorkspace ? 'active' : ''}" onclick="setWorkspace('${workspace}')">${workspace}</button>
  `).join('');
}

function renderWorkspace() {
  renderNav();
  if (activeWorkspace === 'Catalog workspace') contentEl.innerHTML = renderCatalog();
  else if (activeWorkspace === 'Import studio') contentEl.innerHTML = renderImportStudio();
  else if (activeWorkspace === 'Taxonomy control') contentEl.innerHTML = renderTaxonomy();
  else contentEl.innerHTML = renderOverview();
}

window.setWorkspace = (workspace) => {
  activeWorkspace = workspace;
  renderWorkspace();
};

window.selectProduct = (index) => {
  activeProduct = index;
  renderWorkspace();
};

window.selectImportRow = (index) => {
  activeImport = index;
  renderWorkspace();
};

renderWorkspace();
