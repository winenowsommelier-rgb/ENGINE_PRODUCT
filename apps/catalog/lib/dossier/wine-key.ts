/**
 * WINE_KEY_OVERRIDES -- TS twin of data/lib/dossier/wine_key.py's override map.
 * No runtime resolver here yet (nothing in the catalog consumes wine_key in
 * Phase 0); this file exists purely so the override map can't drift silently.
 * PARITY: tests/test_wine_key_normalizer.py checks both stay in lock-step.
 */
export const WINE_KEY_OVERRIDES: Record<string, string> = {};
