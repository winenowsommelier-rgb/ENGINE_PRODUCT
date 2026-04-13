"use client";

import { Plus, Minus } from "lucide-react";

interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export default function ZoomControls({ onZoomIn, onZoomOut }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onZoomIn}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-black/60 text-white/70 backdrop-blur-md transition-all hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none"
        aria-label="Zoom in"
      >
        <Plus size={16} />
      </button>
      <button
        onClick={onZoomOut}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-black/60 text-white/70 backdrop-blur-md transition-all hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none"
        aria-label="Zoom out"
      >
        <Minus size={16} />
      </button>
    </div>
  );
}
