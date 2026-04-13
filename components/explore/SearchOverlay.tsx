"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { CategoryScope } from "@/lib/explore/types";
import { searchLocations, type SearchResult } from "@/lib/explore/taxonomy-utils";

interface Props {
  category: CategoryScope | null;
  onSelect: (result: SearchResult) => void;
}

export default function SearchOverlay({ category, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setResults(searchLocations(query, category));
      setSelectedIdx(0);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, category]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[selectedIdx]) {
        onSelect(results[selectedIdx]);
        setOpen(false);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [results, selectedIdx, onSelect]
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/60 backdrop-blur-md transition-all hover:bg-white/10 hover:text-white"
        aria-label="Search regions"
      >
        <Search size={16} />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />

      {/* Search panel */}
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#12121f] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
          <Search size={18} className="text-white/40" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search countries, regions..."
            className="flex-1 bg-transparent text-white placeholder:text-white/30 outline-none"
          />
          <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {results.length > 0 && (
          <ul className="max-h-80 overflow-y-auto p-2">
            {results.map((r, i) => (
              <li key={`${r.type}-${r.slug}`}>
                <button
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors"
                  style={{
                    background: i === selectedIdx ? "rgba(255,255,255,0.08)" : "transparent",
                  }}
                  onMouseEnter={() => setSelectedIdx(i)}
                  onClick={() => { onSelect(r); setOpen(false); }}
                >
                  <div>
                    <span className="text-sm font-medium text-white">{r.name}</span>
                    {r.parentName && (
                      <span className="ml-2 text-xs text-white/40">{r.parentName}</span>
                    )}
                  </div>
                  <span className="text-xs text-white/30">
                    {r.total > 0 ? `${r.total} products` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {query && results.length === 0 && (
          <p className="p-4 text-center text-sm text-white/40">No regions found</p>
        )}
      </div>
    </div>
  );
}
