"""SQLite-backed product UPDATE (replaces the Supabase PATCH half of OutputRouter)."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Optional

from data.lib.enrichment.shared.vocab_loader import VocabLoader


class LocalRouter:
    def __init__(self, db_path: Path, write_threshold: float = 0.85):
        self.db_path = Path(db_path)
        self.write_threshold = write_threshold

    def update_product(
        self,
        products_id: str,
        response: dict,
        final_confidence: float,
        model: str,
        enrichment_note: str,
        enriched_at: str,
        score_max: float | None = None,
        score_summary: str = "",
        taste_profile: Optional[dict] = None,
        vocab: Optional[VocabLoader] = None,
    ) -> bool:
        """Returns True if a direct UPDATE happened, False if skipped."""
        if final_confidence < self.write_threshold or not products_id:
            return False

        payload = {
            "wine_body": response.get("wine_body"),
            "wine_acidity": response.get("wine_acidity"),
            "wine_tannin": response.get("wine_tannin"),
            "grape_variety": ", ".join(response.get("grape_variety", [])) or None,
            "grape_blend_type": response.get("grape_blend_type"),
            "wine_production_style": json.dumps(response.get("wine_production_style") or []),
            "flavor_tags": json.dumps(response.get("flavor_tags") or []),
            "food_matching": ", ".join(response.get("food_matching", [])) or None,
            "desc_en_short": response.get("desc_en_short"),
            "full_description": response.get("full_description"),
            "score_max": score_max,
            "score_summary": score_summary or None,
            "enrichment_confidence": round(final_confidence, 3),
            "enrichment_source": "ai_high_conf",
            "enrichment_note": enrichment_note,
            "enriched_at": enriched_at,
            "enriched_by": model,
            "updated_at": enriched_at,
        }
        if taste_profile is not None:
            payload["taste_profile"] = json.dumps(taste_profile)

        sets = ", ".join(f"{k}=?" for k in payload.keys())
        conn = sqlite3.connect(self.db_path)
        try:
            with conn:
                conn.execute(
                    f"UPDATE products SET {sets} WHERE id=?",
                    list(payload.values()) + [products_id],
                )
                if taste_profile is not None:
                    self._refresh_taste_notes(conn, products_id, taste_profile, vocab)
        finally:
            conn.close()
        return True

    def _refresh_taste_notes(
        self,
        conn: sqlite3.Connection,
        product_id: str,
        taste_profile: dict,
        vocab: Optional[VocabLoader],
    ) -> None:
        """Delete + re-insert product_taste_notes and queue for similarity recompute.

        All executed on the already-open connection (within the caller's transaction).
        """
        conn.execute("DELETE FROM product_taste_notes WHERE product_id = ?", (product_id,))

        structure = taste_profile.get("structure", "tiered")
        rows_to_insert: list[tuple[str, str, str, int, str]] = []

        if structure == "tiered":
            tiers = taste_profile.get("tiers", {})
            for tier_name in ("primary", "secondary", "tertiary"):
                for note_obj in tiers.get(tier_name, []):
                    note_name = note_obj.get("note", "")
                    intensity = int(note_obj.get("intensity", 2))
                    note_family = _resolve_family(note_name, vocab)
                    rows_to_insert.append((product_id, note_name, tier_name, intensity, note_family))
        else:  # flat
            for note_obj in taste_profile.get("flat_tags", []):
                note_name = note_obj.get("note", "")
                intensity = int(note_obj.get("intensity", 2))
                note_family = _resolve_family(note_name, vocab)
                rows_to_insert.append((product_id, note_name, "flat", intensity, note_family))

        if rows_to_insert:
            conn.executemany(
                "INSERT INTO product_taste_notes (product_id, note, tier, intensity, note_family)"
                " VALUES (?,?,?,?,?)",
                rows_to_insert,
            )

        conn.execute(
            "INSERT OR REPLACE INTO product_similar_dirty (product_id) VALUES (?)",
            (product_id,),
        )


def _resolve_family(note_name: str, vocab: Optional[VocabLoader]) -> str:
    """Return the note family from vocab, or 'unknown' if not found."""
    if vocab is not None:
        canonical = vocab.lookup(note_name)
        if canonical is not None:
            return canonical.family
    return "unknown"
