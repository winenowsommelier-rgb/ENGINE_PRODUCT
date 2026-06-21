// components/product/TasteWheel.tsx
//
// SERVER COMPONENT (no "use client"). Computes wedge geometry at build time via
// the pure taste-geometry module, then hands plain serializable props to the
// "use client" TasteWheelInteractive, which owns interaction + motion. This
// keeps the trig and tier data OUT of the client bundle (SSG-friendly).

import { buildSegments, type Tiers } from '@/lib/taste-geometry';
import { TasteWheelInteractive } from './TasteWheelInteractive';

export type { Tiers } from '@/lib/taste-geometry';
export interface Note { note: string; intensity: 1 | 2 | 3; }

interface TasteWheelProps {
  tiers: Tiers;
  size?: number;            // default 240
  varietalLabel?: string;   // idle center label (catalog passes grape/name)
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
