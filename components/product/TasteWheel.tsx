// components/product/TasteWheel.tsx  (INTERNAL app — repo ROOT)
//
// SERVER-STYLE WRAPPER (no "use client"). Computes wedge geometry via the pure
// taste-geometry module, then hands plain serializable props to the "use client"
// TasteWheelInteractive, which owns interaction + motion. TasteProfileSection
// (the sole importer) is itself a server component, so a server child is fine and
// keeps the trig + tier data out of the client bundle.

import { buildSegments, type Tiers } from '@/lib/taste-geometry';
import { TasteWheelInteractive } from './TasteWheelInteractive';

export type { Tiers, Note } from '@/lib/taste-geometry';

interface TasteWheelProps {
  tiers: Tiers;
  size?: number;            // default 240
  varietalLabel?: string;   // idle center label (internal passes none → generic fallback)
}

export function TasteWheel({ tiers, size = 240, varietalLabel }: TasteWheelProps) {
  const { segments, order } = buildSegments(tiers, size);
  return (
    <TasteWheelInteractive
      segments={segments}
      tiers={tiers}
      order={order}
      size={size}
      varietalLabel={varietalLabel}
    />
  );
}
