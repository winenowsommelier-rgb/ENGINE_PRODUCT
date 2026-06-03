'use client';

import { useState } from 'react';
import { Wine, Beer, Martini, GlassWater, Package, ScanLine } from 'lucide-react';

interface Props {
  src?: string | null;
  alt?: string | null;
  sku?: string;
  classification?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Show the label-zoom toggle button (detail views only). Default false. */
  showLabelZoom?: boolean;
}

// Fixed-height containers — width is narrow to suit bottle aspect ratio.
// All sizes enforce the same height so cards in a grid align perfectly.
const SIZE_CLASSES = {
  sm: 'w-10 h-10',
  md: 'w-16 h-[72px]',      // ~4:5 ratio suits most bottles
  lg: 'w-20 h-[110px]',
  xl: 'w-[100px] h-[140px]',
};

const ICON_SIZES = { sm: 16, md: 22, lg: 28, xl: 40 };

// CSS transform to approximate a label close-up.
// Scale up and shift down ~20% to focus on the mid-bottle label region.
const LABEL_ZOOM_STYLE: React.CSSProperties = {
  transform: 'scale(2.4) translateY(12%)',
  transformOrigin: 'center 45%',
  transition: 'transform 0.25s ease',
};

const FULL_BOTTLE_STYLE: React.CSSProperties = {
  transform: 'scale(1) translateY(0)',
  transition: 'transform 0.25s ease',
};

function getCategoryIcon(sku?: string, classification?: string) {
  const cls = (classification || '').toLowerCase();
  const prefix = (sku || '').substring(0, 3).toUpperCase();

  if (prefix.startsWith('W') || cls.includes('wine') || cls.includes('champagne') || cls.includes('sparkling')) {
    return Wine;
  }
  if (prefix === 'LBE' || cls.includes('beer') || cls.includes('lager') || cls.includes('ale')) {
    return Beer;
  }
  if (prefix.startsWith('L') || cls.includes('whisky') || cls.includes('gin') || cls.includes('rum') || cls.includes('vodka') || cls.includes('tequila') || cls.includes('brandy') || cls.includes('liqueur') || cls.includes('sake')) {
    return Martini;
  }
  if (prefix === 'NNA') return GlassWater;

  return Package;
}

function getCategoryColor(sku?: string, classification?: string): string {
  const cls = (classification || '').toLowerCase();
  const prefix = (sku || '').substring(0, 3).toUpperCase();

  if (cls.includes('red wine') || prefix === 'WRW') return 'from-red-950/40 to-red-900/20 text-red-400/50';
  if (cls.includes('white wine') || prefix === 'WWW') return 'from-amber-950/30 to-yellow-900/15 text-amber-400/50';
  if (cls.includes('sparkling') || cls.includes('champagne') || prefix === 'WSP' || prefix === 'WCH') return 'from-amber-950/30 to-amber-800/15 text-amber-300/50';
  if (cls.includes('rose') || prefix === 'WRS') return 'from-pink-950/30 to-pink-900/15 text-pink-400/50';
  if (prefix.startsWith('W')) return 'from-violet-950/30 to-violet-900/15 text-violet-400/50';
  if (cls.includes('whisky') || cls.includes('whiskey') || prefix === 'LWH') return 'from-orange-950/30 to-orange-900/15 text-orange-400/50';
  if (prefix.startsWith('L')) return 'from-amber-950/30 to-amber-800/15 text-amber-400/50';
  if (prefix === 'LBE') return 'from-yellow-950/30 to-yellow-900/15 text-yellow-400/50';

  return 'from-slate-800/30 to-slate-700/15 text-slate-500/50';
}

export function ProductImage({
  src,
  alt,
  sku,
  classification,
  size = 'md',
  className = '',
  showLabelZoom = false,
}: Props) {
  const [error, setError] = useState(false);
  const [labelZoom, setLabelZoom] = useState(false);
  const sizeClass = SIZE_CLASSES[size];
  const iconSize = ICON_SIZES[size];

  if (src && !error) {
    return (
      <div className={`relative ${sizeClass} shrink-0 ${className}`}>
        {/* Image container — clips the zoom transform */}
        <div className="w-full h-full rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
          <img
            src={src}
            alt={alt || 'Product image'}
            className="w-full h-full object-contain"
            style={labelZoom ? LABEL_ZOOM_STYLE : FULL_BOTTLE_STYLE}
            onError={() => setError(true)}
            loading="lazy"
          />
        </div>

        {/* Label-zoom toggle — only shown when prop is set and size is large enough */}
        {showLabelZoom && (size === 'lg' || size === 'xl') && (
          <button
            onClick={(e) => { e.stopPropagation(); setLabelZoom((v) => !v); }}
            title={labelZoom ? 'Show full bottle' : 'Zoom to label'}
            className={`absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md transition-colors
              ${labelZoom
                ? 'bg-violet-600 text-white'
                : 'bg-black/40 text-white/70 hover:bg-black/60 hover:text-white'
              }`}
          >
            <ScanLine size={11} />
          </button>
        )}
      </div>
    );
  }

  // Placeholder with category icon
  const Icon = getCategoryIcon(sku, classification);
  const colorClass = getCategoryColor(sku, classification);

  return (
    <div
      className={`${sizeClass} rounded-lg shrink-0 flex items-center justify-center bg-gradient-to-br ${colorClass} ${className}`}
    >
      <Icon size={iconSize} />
    </div>
  );
}
