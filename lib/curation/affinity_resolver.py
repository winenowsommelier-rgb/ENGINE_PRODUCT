from __future__ import annotations
from lib.curation.knowledge_base import PairingKnowledgeBase


def find_affinities(
    anchor: dict,
    catalog: list[dict],
    kb: PairingKnowledgeBase,
    relationship_type: str = "similar",
    max_results: int = 6,
) -> list[dict]:
    anchor_sku = anchor.get("sku", "")
    anchor_tags = set(t.lower() for t in (anchor.get("flavor_tags") or []))
    anchor_cls = anchor.get("classification", "")

    results: list[tuple[float, dict]] = []

    for rule in kb.product_affinity_rules:
        if rule.get("relationship_type") != relationship_type:
            continue

        for product in catalog:
            if product.get("sku") == anchor_sku:
                continue

            tags = set(t.lower() for t in (product.get("flavor_tags") or []))
            cls = product.get("classification", "")
            body = product.get("wine_body") or ""

            if relationship_type == "similar":
                mp = rule.get("match_profile", {})
                ap = rule.get("anchor_profile", {})
                cls_ok = not mp.get("classification") or cls in mp["classification"]
                body_ok = not mp.get("wine_body") or body in mp.get("wine_body", [])
                # Check anchor matches rule's anchor_profile
                anchor_cls_ok = not ap.get("classification") or anchor_cls in ap.get("classification", [])
                anchor_body_ok = not ap.get("wine_body") or (anchor.get("wine_body") or "") in ap.get("wine_body", [])
                if not anchor_cls_ok or not anchor_body_ok:
                    continue
                # Count how many anchor_profile reference tags appear in candidate tags
                # OR direct anchor/candidate tag overlap — whichever is greater
                anchor_ref_tags = set(t.lower() for t in ap.get("flavor_tags_include", []))
                direct_overlap = len(anchor_tags & tags)
                ref_in_candidate = len(anchor_ref_tags & tags)
                ref_in_anchor = len(anchor_ref_tags & anchor_tags)
                # Effective overlap: direct overlap + reference tags that appear in both anchor and candidate
                effective_overlap = direct_overlap + (1 if ref_in_candidate > 0 and ref_in_anchor > 0 else 0)
                min_overlap = mp.get("flavor_tags_overlap_min", 1)
                if cls_ok and body_ok and effective_overlap >= min_overlap:
                    results.append((float(effective_overlap), product))

            elif relationship_type == "overlap":
                shared = set(s.lower() for s in rule.get("shared_signals", []))
                eligible = rule.get("eligible_categories", [])
                if (not eligible or cls in eligible) and (anchor_tags & tags) >= shared:
                    results.append((float(len(anchor_tags & tags)), product))

            elif relationship_type == "contrast":
                pa = rule.get("profile_a", {})
                pb = rule.get("profile_b", {})
                a_cls = pa.get("category", "")
                b_cls = pb.get("category", "")
                if a_cls.lower() in anchor_cls.lower() and b_cls.lower() in cls.lower():
                    results.append((1.0, product))
                elif b_cls.lower() in anchor_cls.lower() and a_cls.lower() in cls.lower():
                    results.append((1.0, product))

    results.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in results[:max_results]]
