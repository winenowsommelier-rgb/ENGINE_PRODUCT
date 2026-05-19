"""Per-SKU evidence collection for wine enrichment.

Pure functions. Collector reads pre-loaded data structures (no I/O at call time);
driver loads the inputs once and constructs the collector.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Literal

from data.lib.enrichment.wine import taxonomies


@dataclass(frozen=True)
class WinesensedMatch:
    record_id: str
    year: int | None
    region: str
    grape: str
    rating: float
    review_text: str
    match_type: Literal["tight", "loose", "country"]


@dataclass(frozen=True)
class BrandDescription:
    name: str
    tier: str
    desc_short: str
    desc_full: str


@dataclass(frozen=True)
class CriticScore:
    critic: str
    score: float
    score_max: float
    vintage: str | None
    tasting_year: int | None


@dataclass(frozen=True)
class Evidence:
    sku: str
    facts: dict
    winesensed_matches: tuple[WinesensedMatch, ...]
    brand_description: BrandDescription | None
    heuristic_profile: str
    critic_scores: tuple[CriticScore, ...]
    quality_tier: Literal["A", "B", "C"]
    evidence_hash: str


def _normalize(value: str | None) -> str:
    return (value or "").strip().lower()


def _brand_tier_from_count(product_count: int | str) -> str:
    """Match enrich_s1/s2/s3 conventions: S1 = ≥10, S2 = 3-9, S3 = ≤2."""
    try:
        n = int(product_count)
    except (ValueError, TypeError):
        return "S3"
    if n >= 10:
        return "S1"
    if n >= 3:
        return "S2"
    return "S3"


class EvidenceCollector:
    """Builds an Evidence object per SKU from pre-loaded source data.

    Construct once at driver start (loading Winesensed records, brand library,
    and critic_scores). Then call collect_evidence(sku, row) per SKU.
    """

    def __init__(
        self,
        winesensed_records: list[dict],
        brand_library: list[dict],
        critic_scores_by_sku: dict[str, list[dict]],
    ):
        self.winesensed = winesensed_records
        self.brand_lib_by_name = {
            (r.get("entity_name") or "").strip().lower(): r
            for r in brand_library
            if (r.get("entity_type") or "") == "brand"
        }
        self.critic_scores_by_sku = critic_scores_by_sku

    def _find_winesensed_matches(
        self, grape: str, region: str, country: str, limit: int = 5
    ) -> list[WinesensedMatch]:
        g, r, c = _normalize(grape), _normalize(region), _normalize(country)
        if not g and not r and not c:
            return []

        tight, loose, country_only = [], [], []
        for rec in self.winesensed:
            ng = (rec.get("normalized_grape") or "").lower()
            nr = (rec.get("normalized_region") or "").lower()
            nc = (rec.get("normalized_country") or "").lower()
            if g and ng == g and r and nr == r:
                tight.append(rec)
            elif g and ng == g:
                loose.append(rec)
            elif c and nc == c and r and nr == r:
                country_only.append(rec)

        tight.sort(key=lambda x: -float(x.get("rating") or 0))
        loose.sort(key=lambda x: -float(x.get("rating") or 0))
        country_only.sort(key=lambda x: -float(x.get("rating") or 0))

        out: list[WinesensedMatch] = []
        for rec in tight:
            out.append(self._build_match(rec, "tight"))
            if len(out) >= limit:
                return out
        # Only add loose if we have <2 tight matches
        if len([m for m in out if m.match_type == "tight"]) < 2:
            for rec in loose:
                if rec.get("id") in {m.record_id for m in out}:
                    continue
                out.append(self._build_match(rec, "loose"))
                if len(out) >= limit:
                    return out
        # Only add country-only if we still have no grape matches
        if not any(m.match_type in ("tight", "loose") for m in out):
            for rec in country_only:
                out.append(self._build_match(rec, "country"))
                if len(out) >= limit:
                    return out

        return out

    def _build_match(self, rec: dict, match_type: str) -> WinesensedMatch:
        return WinesensedMatch(
            record_id=rec.get("id", ""),
            year=rec.get("year"),
            region=rec.get("region", ""),
            grape=rec.get("grape", ""),
            rating=float(rec.get("rating") or 0),
            review_text=(rec.get("review") or "")[:300],
            match_type=match_type,  # type: ignore[arg-type]
        )

    def _find_brand_description(self, brand: str) -> BrandDescription | None:
        if not brand:
            return None
        rec = self.brand_lib_by_name.get(brand.strip().lower())
        if not rec:
            return None
        tier = _brand_tier_from_count(rec.get("product_count", "0"))
        return BrandDescription(
            name=rec.get("entity_name", ""),
            tier=tier,
            desc_short=rec.get("description_short_en", "") or "",
            desc_full=rec.get("description_full_en", "") or "",
        )

    def _critic_scores_for(self, sku: str) -> list[CriticScore]:
        rows = self.critic_scores_by_sku.get(sku, [])
        sorted_rows = sorted(
            rows,
            key=lambda r: (-(r.get("tasting_year") or 0), -float(r.get("score") or 0)),
        )
        return [
            CriticScore(
                critic=str(r.get("critic", "")),
                score=float(r.get("score") or 0),
                score_max=float(r.get("score_max") or 100),
                vintage=r.get("vintage"),
                tasting_year=r.get("tasting_year"),
            )
            for r in sorted_rows[:6]
        ]

    def _quality_tier(
        self,
        winesensed_matches: list[WinesensedMatch],
        brand_desc: BrandDescription | None,
        critic_scores: list[CriticScore],
    ) -> Literal["A", "B", "C"]:
        tight = sum(1 for m in winesensed_matches if m.match_type == "tight")
        any_winesensed = len(winesensed_matches) > 0
        has_brand = brand_desc is not None and (brand_desc.desc_short or brand_desc.desc_full)
        is_tier1 = brand_desc is not None and brand_desc.tier == "S1"

        # Tier A
        if tight >= 2:
            return "A"
        if tight >= 1 and is_tier1:
            return "A"
        if len(critic_scores) >= 2:
            return "A"
        # Tier B
        if any_winesensed:
            return "B"
        if has_brand:
            return "B"
        if len(critic_scores) >= 1:
            return "B"
        return "C"

    def collect_evidence(self, sku: str, products_row: dict) -> Evidence:
        grape = products_row.get("grape_variety", "") or ""
        primary_grape = grape.split(",")[0].strip() if grape else ""
        region = products_row.get("region", "") or ""
        country = products_row.get("country", "") or ""

        ws_matches = self._find_winesensed_matches(primary_grape, region, country)
        brand_desc = self._find_brand_description(products_row.get("brand", "") or "")
        heuristic = taxonomies.heuristic_for(
            primary_grape, region, products_row.get("classification", "") or ""
        )
        scores = self._critic_scores_for(sku)
        tier = self._quality_tier(ws_matches, brand_desc, scores)

        facts = {
            "name": products_row.get("name", "") or "",
            "brand": products_row.get("brand", "") or "",
            "vintage": products_row.get("vintage", "") or "",
            "bottle_size": products_row.get("bottle_size", "") or "",
            "country": country,
            "region": region,
            "subregion": products_row.get("subregion", "") or "",
            "classification": products_row.get("classification", "") or "",
            "grape_variety_raw": grape,
            "price": products_row.get("price", 0),
            "alcohol": products_row.get("alcohol", "") or "",
        }

        hash_input = json.dumps({
            "facts": facts,
            "winesensed_ids": [m.record_id for m in ws_matches],
            "brand_match": brand_desc.name if brand_desc else None,
            "brand_desc_short": brand_desc.desc_short if brand_desc else None,
            "heuristic": heuristic,
            "critic_scores": [(s.critic, s.score, s.score_max, s.vintage) for s in scores],
        }, sort_keys=True)
        evidence_hash = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()

        return Evidence(
            sku=sku,
            facts=facts,
            winesensed_matches=tuple(ws_matches),
            brand_description=brand_desc,
            heuristic_profile=heuristic,
            critic_scores=tuple(scores),
            quality_tier=tier,
            evidence_hash=evidence_hash,
        )
