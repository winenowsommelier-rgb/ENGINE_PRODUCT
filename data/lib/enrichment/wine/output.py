"""Output routing: Supabase products write (≥threshold) + CSV append (always).

Per §8 of the spec.
"""
from __future__ import annotations

import csv
import json
import urllib.error
import urllib.parse
import urllib.request


# Per §14.1 of spec. Order matters — kept stable for downstream Magento import.
CSV_COLUMNS: list[str] = [
    "sku", "confidence", "confidence_tier",
    "wine_body", "wine_acidity", "wine_tannin",
    "grape_variety", "grape_blend_type", "wine_production_style",
    "flavor_tags", "food_matching",
    "desc_en_short", "full_description",
    "score_max", "score_summary",
    "enrichment_note",
    "current_wine_body", "current_food_matching", "current_full_description",
    "cache_id", "enriched_at", "enriched_by",
]


def _pipe(seq) -> str:
    if not seq:
        return ""
    return "|".join(str(x) for x in seq)


def build_csv_row(
    sku: str,
    response: dict,
    final_confidence: float,
    tier: str,
    cache_id: str,
    current_values: dict,
    enrichment_note: str,
    model: str,
    enriched_at: str,
    score_max: float | None = None,
    score_summary: str = "",
) -> dict:
    return {
        "sku": sku,
        "confidence": round(final_confidence, 3),
        "confidence_tier": tier,
        "wine_body": response.get("wine_body", ""),
        "wine_acidity": response.get("wine_acidity", ""),
        "wine_tannin": response.get("wine_tannin", ""),
        "grape_variety": _pipe(response.get("grape_variety", [])),
        "grape_blend_type": response.get("grape_blend_type", ""),
        "wine_production_style": _pipe(response.get("wine_production_style", [])),
        "flavor_tags": _pipe(response.get("flavor_tags", [])),
        "food_matching": _pipe(response.get("food_matching", [])),
        "desc_en_short": response.get("desc_en_short", ""),
        "full_description": response.get("full_description", ""),
        "score_max": score_max if score_max is not None else "",
        "score_summary": score_summary,
        "enrichment_note": enrichment_note,
        "current_wine_body": current_values.get("wine_body", "") or "",
        "current_food_matching": current_values.get("food_matching", "") or "",
        "current_full_description": (current_values.get("full_description") or "")[:200],
        "cache_id": cache_id,
        "enriched_at": enriched_at,
        "enriched_by": model,
    }


class OutputRouter:
    """Routes one enrichment result: Supabase write (if high-conf) + CSV (always)."""

    def __init__(
        self,
        supabase_url: str,
        api_key: str,
        csv_writer: csv.DictWriter,
        write_threshold: float = 0.85,
    ):
        self.url = supabase_url.rstrip("/")
        self.api_key = api_key
        self.csv_writer = csv_writer
        self.write_threshold = write_threshold

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    def _write_to_products(
        self, products_id: str, response: dict, final_confidence: float,
        model: str, enrichment_note: str, enriched_at: str,
        score_max: float | None, score_summary: str,
    ) -> None:
        patch_url = f"{self.url}/rest/v1/products?id=eq.{urllib.parse.quote(products_id)}"
        payload = {
            "wine_body": response.get("wine_body"),
            "wine_acidity": response.get("wine_acidity"),
            "wine_tannin": response.get("wine_tannin"),
            "grape_variety": ", ".join(response.get("grape_variety", [])) or None,
            "grape_blend_type": response.get("grape_blend_type"),
            "wine_production_style": response.get("wine_production_style") or None,
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
        }
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(patch_url, data=body, method="PATCH", headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=30):
                pass
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"products write failed for {products_id}: {e.code} {e.read().decode('utf-8', errors='replace')[:200]}")

    def route(
        self,
        sku: str,
        products_id: str,
        response: dict,
        final_confidence: float,
        tier: str,
        cache_id: str,
        current_values: dict,
        enrichment_note: str,
        model: str,
        enriched_at: str,
        score_max: float | None = None,
        score_summary: str = "",
    ) -> bool:
        """Returns True if direct Supabase write happened, False if CSV-only."""
        wrote_supabase = False
        if final_confidence >= self.write_threshold and products_id:
            self._write_to_products(
                products_id, response, final_confidence, model,
                enrichment_note, enriched_at, score_max, score_summary,
            )
            wrote_supabase = True

        row = build_csv_row(
            sku=sku, response=response,
            final_confidence=final_confidence, tier=tier,
            cache_id=cache_id, current_values=current_values,
            enrichment_note=enrichment_note,
            model=model, enriched_at=enriched_at,
            score_max=score_max, score_summary=score_summary,
        )
        self.csv_writer.writerow(row)
        return wrote_supabase
