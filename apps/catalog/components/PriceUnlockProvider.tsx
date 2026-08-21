'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * PriceUnlockProvider — site-wide "are real prices visible" state.
 *
 * This is a DISPLAY gate, not a security boundary: every product's real price
 * is already present in the page's HTML/data (there is no server-side
 * redaction here), so a determined visitor could always find it in devtools.
 * The gate exists to keep casual browsers from seeing raw prices while still
 * letting partners unlock them in one click — not to hide pricing from
 * anyone who goes looking.
 *
 * State lives in sessionStorage (NOT a cookie): unlocking is per-tab-session,
 * cleared when the browser closes, matches the "session only" requirement,
 * and needs no server round-trip since there's nothing server-side to protect.
 */

const STORAGE_KEY = 'wnlq9_price_unlocked';
const PASSCODE = process.env.NEXT_PUBLIC_PRICE_PASSCODE ?? '';

interface PriceUnlockContextValue {
  unlocked: boolean;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  /** Returns true and unlocks on a correct passcode; false otherwise. */
  tryUnlock: (passcode: string) => boolean;
}

const PriceUnlockContext = createContext<PriceUnlockContextValue | null>(null);

export function PriceUnlockProvider({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Read session state once on mount (client-only — sessionStorage doesn't exist server-side).
  useEffect(() => {
    setUnlocked(sessionStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  const tryUnlock = useCallback((passcode: string) => {
    if (!PASSCODE || passcode !== PASSCODE) return false;
    sessionStorage.setItem(STORAGE_KEY, '1');
    setUnlocked(true);
    setModalOpen(false);
    return true;
  }, []);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  return (
    <PriceUnlockContext.Provider value={{ unlocked, modalOpen, openModal, closeModal, tryUnlock }}>
      {children}
    </PriceUnlockContext.Provider>
  );
}

export function usePriceUnlock(): PriceUnlockContextValue {
  const ctx = useContext(PriceUnlockContext);
  if (!ctx) throw new Error('usePriceUnlock must be used within a PriceUnlockProvider');
  return ctx;
}
