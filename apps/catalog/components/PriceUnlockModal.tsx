'use client';

import { useState } from 'react';
import { usePriceUnlock } from '@/components/PriceUnlockProvider';

const LINE_URL = 'https://lin.ee/vkJhAL5';

/**
 * PriceUnlockModal — passcode popup that reveals real prices site-wide.
 *
 * Rendered once (mounted alongside PriceUnlockProvider in the root layout),
 * visibility driven entirely by usePriceUnlock().modalOpen. Carries the
 * Thai alcohol-marketing disclosure required on this preview site.
 */
export function PriceUnlockModal() {
  const { modalOpen, closeModal, tryUnlock } = usePriceUnlock();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');

  if (!modalOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tryUnlock(passcode)) {
      setPasscode('');
      setError('');
    } else {
      setError('Incorrect passcode');
      setPasscode('');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Unlock prices"
      onClick={closeModal}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 text-center">
          <span className="text-xl font-bold tracking-tight text-neutral-900">WNLQ9</span>
          <p className="mt-2 text-sm text-neutral-500">Enter passcode to view prices</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            required
            autoFocus
            className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-neutral-400"
          />
          {error && <p className="text-center text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-neutral-900 py-3 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Unlock prices
          </button>
        </form>

        <p className="mt-6 whitespace-pre-line text-center text-xs leading-relaxed text-neutral-500">
          This website is intended to present product samples and pricing for
          business partners to review. Alcoholic beverages are not sold
          through this website. For further inquiries, please contact our
          staff directly. The company does not sell or deliver alcoholic
          beverages to persons under 20 years of age, in accordance with the
          Alcoholic Beverage Control Act B.E. 2551.
        </p>

        <a
          href={LINE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white text-sm font-medium text-neutral-800 transition-colors hover:border-neutral-400"
        >
          Contact us on LINE
        </a>

        <button
          type="button"
          onClick={closeModal}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center text-sm font-medium text-neutral-400 hover:text-neutral-600"
        >
          Close
        </button>
      </div>
    </div>
  );
}
