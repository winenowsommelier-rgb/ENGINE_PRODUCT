const SCALE_DEFINITIONS: Record<string, { scale: string[]; color: string }> = {
  body:        { scale: ['Light', 'Medium', 'Medium-Full', 'Full'],         color: '#a4392b' },
  acidity:     { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#5a8542' },
  tannin:      { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#5a4a3c' },
  sweetness:   { scale: ['Dry',   'Off-Dry','Medium-Sweet','Sweet'],         color: '#d4a017' },
  bitterness:  { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#5a4a3c' },
  carbonation: { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#4a7ec9' },
  intensity:   { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#a4392b' },
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
