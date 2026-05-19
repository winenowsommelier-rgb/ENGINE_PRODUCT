"""Confidence scoring + direct-write threshold."""
from __future__ import annotations

from typing import Literal


_TIER_MULTIPLIER: dict[str, float] = {"A": 1.00, "B": 0.90, "C": 0.75}
_VALIDATOR_MULTIPLIER: dict[str, float] = {
    "passed": 1.00,
    "repaired": 0.95,
    "failed_then_retried": 0.85,
}

DEFAULT_THRESHOLD = 0.85


def final_confidence(
    ai_confidence: float,
    tier: Literal["A", "B", "C"],
    validator_outcome: Literal["passed", "repaired", "failed_then_retried"],
) -> float:
    """Compute final confidence in [0,1] from the three signals."""
    ai = max(0.0, min(1.0, float(ai_confidence)))
    tier_m = _TIER_MULTIPLIER.get(tier, 0.75)
    val_m = _VALIDATOR_MULTIPLIER.get(validator_outcome, 0.85)
    return max(0.0, min(1.0, ai * tier_m * val_m))


def should_direct_write(final_conf: float, threshold: float = DEFAULT_THRESHOLD) -> bool:
    return final_conf >= threshold
