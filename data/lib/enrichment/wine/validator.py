"""Validate Haiku JSON output against schema + controlled vocabulary."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Literal

from data.lib.enrichment.wine import taxonomies
from data.lib.enrichment.wine.evidence import Evidence
from data.lib.enrichment.shared.taxonomies.food_pairing import FoodTaxonomy
from data.lib.enrichment.shared.vocab_loader import VocabLoader
from data.lib.enrichment.wine.schemas import CATEGORY_TO_STRUCTURE

ALLOWED_HTML_TAGS = {"p", "br", "strong", "em", "ul", "li"}

_VALID_INTENSITIES = {1, 2, 3}
_TIER_NAMES = ("primary", "secondary", "tertiary")
_VOCAB_PATH = Path(__file__).resolve().parents[2] / "shared" / "taste_vocab.yml"


@lru_cache(maxsize=1)
def _vocab_singleton() -> VocabLoader:
    return VocabLoader.from_path(_VOCAB_PATH)
HTML_TAG_RE = re.compile(r"</?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>")

_LABEL_GLOSS_RE = re.compile(r"\s*[\(\[].*?[\)\]]\s*$")


def _strip_label_gloss(s: str) -> str:
    """Remove surrounding double quotes and a trailing (...) or [...] gloss
    from a food-pairing label (defensive against Haiku copying the prompt's
    label-quoting verbatim).

    Quotes are stripped first so that a trailing gloss sitting inside outer
    quotes (e.g. '"Label [gloss]"') is exposed before the regex runs.
    """
    out = str(s).strip()
    if len(out) >= 2 and out.startswith('"') and out.endswith('"'):
        out = out[1:-1].strip()
    return _LABEL_GLOSS_RE.sub("", out).strip()


@dataclass
class ValidationResult:
    outcome: Literal["passed", "repaired", "rejected"]
    repaired_json: dict
    issues: list[str] = field(default_factory=list)
    can_retry: bool = False


def _strip_disallowed_html(s: str) -> tuple[str, bool]:
    modified = False
    def _replace(m: re.Match) -> str:
        nonlocal modified
        tag = m.group(1).lower()
        if tag in ALLOWED_HTML_TAGS:
            return m.group(0)
        modified = True
        return ""
    return HTML_TAG_RE.sub(_replace, s), modified


def _validate_taste_profile(tp: dict, vocab: VocabLoader, classification: str) -> dict:
    """Validate and repair a taste_profile dict in-place.

    Returns a result dict with keys:
        ok           bool   — False if any hard errors remain after repairs
        repairs      list[str] — descriptions of alias repairs applied
        unknown_notes list[str] — note names that could not be resolved
        issues       list[str] — structural / intensity / min-content failures
    """
    repairs: list[str] = []
    unknown_notes: list[str] = []
    issues: list[str] = []

    # 1. Check classification is known
    expected_structure = CATEGORY_TO_STRUCTURE.get(classification)
    if expected_structure is None:
        issues.append(f"classification '{classification}' not in CATEGORY_TO_STRUCTURE")
        return {"ok": False, "repairs": repairs, "unknown_notes": unknown_notes, "issues": issues}

    # 2. Check structure field matches expected
    actual_structure = tp.get("structure")
    if actual_structure != expected_structure:
        issues.append(
            f"taste_profile structure '{actual_structure}' != expected '{expected_structure}' "
            f"for classification '{classification}'"
        )
        return {"ok": False, "repairs": repairs, "unknown_notes": unknown_notes, "issues": issues}

    def _process_notes(notes: list[dict], tier_label: str) -> None:
        for n in notes:
            # Intensity check
            intensity = n.get("intensity")
            if intensity not in _VALID_INTENSITIES:
                issues.append(f"{tier_label}: intensity {intensity!r} not in {{1,2,3}}")
                continue
            # Vocab lookup
            raw_name = n.get("note", "")
            canon = vocab.lookup(raw_name)
            if canon is None:
                unknown_notes.append(raw_name)
            elif canon.name != raw_name:
                # Alias → repair in-place
                repairs.append(f"{tier_label}: '{raw_name}' -> '{canon.name}'")
                n["note"] = canon.name

    if actual_structure == "tiered":
        tiers = tp.get("tiers", {})
        for tier_name in _TIER_NAMES:
            tier_notes = tiers.get(tier_name) or []
            _process_notes(tier_notes, tier_name)
            # Sort intensity descending in-place
            tier_notes.sort(key=lambda n: n.get("intensity", 0), reverse=True)

        # Min-content: at least one tier non-empty
        total = sum(len(tiers.get(t) or []) for t in _TIER_NAMES)
        if total == 0:
            issues.append("taste_profile tiered: all tiers empty (minimum 1 note required)")

    else:  # flat
        flat_tags = tp.get("flat_tags") or []
        _process_notes(flat_tags, "flat_tags")
        flat_tags.sort(key=lambda n: n.get("intensity", 0), reverse=True)

        if len(flat_tags) < 3:
            issues.append(f"taste_profile flat: {len(flat_tags)} notes < minimum 3")

    ok = (not unknown_notes) and (not issues)
    return {"ok": ok, "repairs": repairs, "unknown_notes": unknown_notes, "issues": issues}


def validate(response_json: dict, evidence: Evidence, food_tax: FoodTaxonomy) -> ValidationResult:
    if not isinstance(response_json, dict):
        return ValidationResult("rejected", {}, ["response is not a JSON object"], can_retry=True)

    repaired = dict(response_json)
    issues: list[str] = []
    repaired_count = 0

    required = {
        "wine_body", "wine_acidity", "wine_tannin",
        "grape_variety", "grape_blend_type", "wine_production_style",
        "flavor_tags", "food_matching",
        "desc_en_short", "full_description",
        "confidence", "citations",
    }
    missing = required - set(repaired.keys())
    if missing:
        return ValidationResult("rejected", repaired, [f"missing required fields: {sorted(missing)}"], can_retry=True)

    def _check_or_repair(field_name: str, value, valid_set, repair_fn):
        nonlocal repaired_count
        if value in valid_set:
            return value
        if repair_fn:
            fixed = repair_fn(value)
            if fixed is not None:
                issues.append(f"{field_name} repaired: {value!r} -> {fixed!r}")
                repaired_count += 1
                return fixed
        issues.append(f"{field_name} out of vocab: {value!r}")
        return None

    body = _check_or_repair("wine_body", repaired["wine_body"], set(taxonomies.BODY_VALUES), taxonomies.repair_body)
    if body is None:
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["wine_body"] = body

    acid = _check_or_repair("wine_acidity", repaired["wine_acidity"], set(taxonomies.ACIDITY_VALUES), taxonomies.repair_acidity)
    if acid is None:
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["wine_acidity"] = acid

    tannin = _check_or_repair("wine_tannin", repaired["wine_tannin"], set(taxonomies.TANNIN_VALUES), taxonomies.repair_tannin)
    if tannin is None:
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["wine_tannin"] = tannin

    blend = _check_or_repair("grape_blend_type", repaired["grape_blend_type"], set(taxonomies.BLEND_TYPES), taxonomies.repair_blend_type)
    if blend is None:
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["grape_blend_type"] = blend

    prod_in = repaired.get("wine_production_style") or []
    if not isinstance(prod_in, list):
        return ValidationResult("rejected", repaired, ["wine_production_style must be a list"], can_retry=True)
    prod_valid = [p for p in prod_in if p in taxonomies.PRODUCTION_STYLES]
    if len(prod_valid) != len(prod_in):
        issues.append(f"dropped invalid production styles: {set(prod_in) - set(prod_valid)}")
        repaired_count += 1
    repaired["wine_production_style"] = prod_valid

    flavor = repaired.get("flavor_tags") or []
    if not isinstance(flavor, list):
        return ValidationResult("rejected", repaired, ["flavor_tags must be a list"], can_retry=True)
    flavor = [str(x)[:30].strip() for x in flavor if str(x).strip()]
    if len(flavor) < 5 or len(flavor) > 10:
        issues.append(f"flavor_tags count {len(flavor)} not in [5, 10]")
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["flavor_tags"] = flavor

    food_in = repaired.get("food_matching") or []
    if not isinstance(food_in, list):
        return ValidationResult("rejected", repaired, ["food_matching must be a list"], can_retry=True)
    food_labels = food_tax.labels
    food_valid = []
    for f in food_in:
        f_str = str(f)
        # 1. exact match
        if f_str in food_labels:
            food_valid.append(f_str)
            continue
        # 2. strip gloss and match
        stripped = _strip_label_gloss(f_str)
        if stripped in food_labels:
            food_valid.append(stripped)
            issues.append(f"food_matching repaired (stripped gloss): {f!r} -> {stripped!r}")
            repaired_count += 1
            continue
        # 3. case-insensitive match on stripped value
        ci_match = next((l for l in food_labels if l.lower() == stripped.lower()), None)
        if ci_match:
            food_valid.append(ci_match)
            issues.append(f"food_matching repaired (case+gloss): {f!r} -> {ci_match!r}")
            repaired_count += 1
            continue
        issues.append(f"food_matching dropped (not in taxonomy): {f!r}")
        repaired_count += 1
    if len(food_valid) < 3 or len(food_valid) > 6:
        issues.append(f"food_matching count {len(food_valid)} not in [3, 6]")
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["food_matching"] = food_valid

    desc = str(repaired.get("desc_en_short") or "").strip()
    if len(desc) > 200:
        return ValidationResult("rejected", repaired, [f"desc_en_short {len(desc)} > 200"], can_retry=True)
    if len(desc) > 160:
        truncated = desc[:160].rsplit(" ", 1)[0]
        repaired["desc_en_short"] = truncated
        issues.append(f"desc_en_short truncated to {len(truncated)} chars")
        repaired_count += 1
    elif len(desc) == 0:
        return ValidationResult("rejected", repaired, ["desc_en_short is empty"], can_retry=True)

    full = str(repaired.get("full_description") or "")
    if len(full) < 200 or len(full) > 800:
        return ValidationResult("rejected", repaired, [f"full_description length {len(full)} not in [200,800]"], can_retry=True)
    cleaned_full, html_modified = _strip_disallowed_html(full)
    if html_modified:
        repaired["full_description"] = cleaned_full
        issues.append("full_description stripped disallowed HTML tags")
        repaired_count += 1

    citations = repaired.get("citations") or {}
    if not isinstance(citations, dict):
        return ValidationResult("rejected", repaired, ["citations must be an object"], can_retry=True)
    valid_ws_ids = {m.record_id for m in evidence.winesensed_matches}
    cited_ws = citations.get("winesensed_record_ids") or []
    if not isinstance(cited_ws, list):
        cited_ws = []
        repaired_count += 1
    bad_ws = [x for x in cited_ws if x not in valid_ws_ids]
    if bad_ws:
        citations["winesensed_record_ids"] = [x for x in cited_ws if x in valid_ws_ids]
        issues.append(f"stripped hallucinated winesensed IDs: {bad_ws}")
        repaired_count += 1

    brand_cited = citations.get("brand_library_match")
    if brand_cited and (evidence.brand_description is None or brand_cited != evidence.brand_description.name):
        citations["brand_library_match"] = None
        issues.append(f"stripped hallucinated brand citation: {brand_cited!r}")
        repaired_count += 1

    repaired["citations"] = citations

    conf = repaired.get("confidence")
    try:
        conf_f = float(conf)
    except (ValueError, TypeError):
        return ValidationResult("rejected", repaired, [f"confidence not numeric: {conf!r}"], can_retry=True)
    if not (0.0 <= conf_f <= 1.0):
        return ValidationResult("rejected", repaired, [f"confidence out of [0,1]: {conf_f}"], can_retry=True)
    repaired["confidence"] = conf_f

    # Taste-profile validation (optional field; only when classification is known)
    if "taste_profile" in repaired and evidence.facts.get("classification") in CATEGORY_TO_STRUCTURE:
        vocab = _vocab_singleton()
        tp_result = _validate_taste_profile(
            repaired["taste_profile"],
            vocab,
            classification=evidence.facts["classification"],
        )
        if not tp_result["ok"]:
            combined_issues = [
                *issues,
                *tp_result["issues"],
                *(f"unknown note: {n}" for n in tp_result["unknown_notes"]),
            ]
            return ValidationResult(
                outcome="rejected",
                repaired_json=repaired,
                issues=combined_issues,
                can_retry=True,
            )
        if tp_result["repairs"]:
            issues.extend(f"taste_profile repair: {r}" for r in tp_result["repairs"])
            repaired_count += len(tp_result["repairs"])

    outcome: Literal["passed", "repaired"] = "passed" if repaired_count == 0 else "repaired"
    return ValidationResult(outcome=outcome, repaired_json=repaired, issues=issues)
