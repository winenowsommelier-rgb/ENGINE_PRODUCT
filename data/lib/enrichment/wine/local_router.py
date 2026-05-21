"""SQLite-backed product UPDATE (replaces the Supabase PATCH half of OutputRouter)."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path


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
        sets = ", ".join(f"{k}=?" for k in payload.keys())
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                f"UPDATE products SET {sets} WHERE id=?",
                list(payload.values()) + [products_id],
            )
            conn.commit()
        finally:
            conn.close()
        return True
