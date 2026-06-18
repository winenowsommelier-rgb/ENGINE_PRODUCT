// components/product/StructuralGauges.tsx
//
// PORTED verbatim from the internal app (repo-root components/product/StructuralGauges.tsx).
// Pure render, no hooks → server component. Light-theme-safe (warm-neutral empty
// cells, per-axis accent on filled cells).
//
// SCALE CONTRACT (Rule 2 / Rule 6 — silent-empty-gauge guard):
//   filledCount = scale.indexOf(value) + 1. If `value` is NOT in `scale`,
//   indexOf returns -1, filledCount becomes 0, and the gauge renders ALL-EMPTY
//   with NO warning. The live export's flat fields contain values OUTSIDE these
//   scales (e.g. acidity 'Medium-Full'/'Full'/'Light'). Callers MUST pass values
//   already normalised into these scales — that is the job of
//   lib/taste-adapter.ts:normalizeScale(), regression-tested in
//   lib/__tests__/taste-adapter.test.ts. SCALE_DEFINITIONS is exported so that
//   test can assert the adapter's output lands inside the component's scale.

export const SCALE_DEFINITIONS: Record<string, { scale: string[]; color: string }> = {
  body:        { scale: ['Light', 'Medium', 'Medium-Full', 'Full'],         color: '#7c2d3a' },
  acidity:     { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#5a8542' },
  tannin:      { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#5a4a3c' },
  sweetness:   { scale: ['Dry',   'Off-Dry','Medium-Sweet','Sweet'],         color: '#d4a017' },
  bitterness:  { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#5a4a3c' },
  carbonation: { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#4a7ec9' },
  intensity:   { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#7c2d3a' },
};

interface StructuralGaugesProps { structural: Record<string, string | null>; }

export function StructuralGauges({ structural }: StructuralGaugesProps) {
  return (
    <div className="structural-gauges">
      {Object.entries(structural).map(([axis, value]) => {
        if (!value) return null;
        const def = SCALE_DEFINITIONS[axis];
        if (!def) return null;
        const filledCount = def.scale.indexOf(value) + 1;
        return (
          <div key={axis} className="gauge-row">
            <div className="gauge-header">
              <span className="gauge-label">{axis.charAt(0).toUpperCase() + axis.slice(1)}</span>
              <span className="gauge-value" style={{ color: def.color }}>{value}</span>
            </div>
            <div className="gauge-track">
              {def.scale.map((_, i) => (
                <div
                  key={i}
                  className="gauge-cell"
                  style={{ background: i < filledCount ? def.color : '#e5dccb' }}
                />
              ))}
            </div>
            <div className="gauge-scale-labels">
              {def.scale.map((label, i) => <span key={i}>{label}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
