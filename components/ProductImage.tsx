'use client';

import { useState } from 'react';
import { Wine, Beer, Martini, GlassWater, Package } from 'lucide-react';

interface Props {
  src?: string | null;
  alt?: string | null;
  sku?: string;
  classification?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'w-10 h-10',
  md: 'w-16 h-16',
  lg: 'w-24 h-24',
  xl: 'w-40 h-40',
};

const ICON_SIZES = { sm: 16, md: 24, lg: 32, xl: 48 };

function getCategoryIcon(sku?: string, classification?: string) {
  const cls = (classification || '').toLowerCase();
  const prefix = (sku || '').substring(0, 3).toUpperCase();

  // Wine
  if (prefix.startsWith('W') || cls.includes('wine') || cls.includes('champagne') || cls.includes('sparkling')) {
    return Wine;
  }
  // Beer
  if (prefix === 'LBE' || cls.includes('beer') || cls.includes('lager') || cls.includes('ale')) {
    return Beer;
  }
  // Spirits
  if (prefix.startsWith('L') || cls.includes('whisky') || cls.includes('gin') || cls.includes('rum') || cls.includes('vodka') || cls.includes('tequila') || cls.includes('brandy') || cls.includes('liqueur') || cls.includes('sake')) {
    return Martini;
  }
  // Non-alcoholic
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

export function ProductImage({ src, alt, sku, classification, size = 'md', className = '' }: Props) {
  const [error, setError] = useState(false);
  const sizeClass = SIZE_CLASSES[size];
  const iconSize = ICON_SIZES[size];

  if (src && !error) {
    return (
      <div className={`${sizeClass} rounded-lg overflow-hidden bg-white/5 shrink-0 ${className}`}>
        <img
          src={src}
          alt={alt || 'Product image'}
          className="w-full h-full object-cover"
          onError={function () { setError(true); }}
          loading="lazy"
        />
      </div>
    );
  }

  // Placeholder with category icon
  const Icon = getCategoryIcon(sku, classification);
  const colorClass = getCategoryColor(sku, classification);

  return (
    <div className={`${sizeClass} rounded-lg shrink-0 flex items-center justify-center bg-gradient-to-br ${colorClass} ${className}`}>
      <Icon size={iconSize} />
    </div>
  );
}
