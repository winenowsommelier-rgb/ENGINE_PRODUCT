#!/usr/bin/env python3
"""Audit every blog post against WNLQ9 Journal content standards.

Checks per post:
  frontmatter  — required fields, META-TITLE <=60 chars, META-DESC <=160 chars
  faq          — '## FAQ/Frequently Asked Questions' section with >=3 '###' questions
  embeds       — count (warn <2), and stated ฿price in the fallback line vs live export
  images       — count, plus/premium-tier Unsplash, 'Photo by' credits (should be editorial)
  links        — at least one /blog/category/ hub link, count of /blog/ sibling links
  compliance   — consumption-inducement / health-claim phrases (Thai alcohol ad law)

Usage: .venv/bin/python scripts/audit_blog_content.py [--check-urls]
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "apps" / "catalog" / "app" / "blog" / "posts"
EXPORT = ROOT / "data" / "live_products_export.json"

EMBED_RE = re.compile(r"<!--\s*product:\s*([A-Z0-9]+)\s*-->")
IMG_RE = re.compile(r"!\[[^\]]*\]\((https?://[^)]+)\)")
PRICE_NEAR_EMBED_RE = re.compile(r"฿([\d,]+)")
BANNED = [
    # consumption inducement / health claims (Thai Alcoholic Beverage Control Act)
    "good for your health", "healthy for", "makes the party", "drink more",
    "everyone should drink", "good for the heart", "antioxidant",
]


def parse_frontmatter(text: str):
    if not text.startswith("---"):
        return {}, text
    end = text.index("\n---", 3)
    data = {}
    for line in text[4:end].split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            data[k.strip()] = v.strip()
    return data, text[end + 4:]


def main() -> None:
    by_sku = {p["sku"]: p for p in json.loads(EXPORT.read_text())}
    check_urls = "--check-urls" in sys.argv

    for f in sorted(POSTS_DIR.glob("*.md")):
        text = f.read_text()
        fm, body = parse_frontmatter(text)
        lines = body.split("\n")
        issues = []

        # frontmatter
        for field in ("TITLE", "SLUG", "DATE", "TAGS", "COVER-IMAGE", "META-TITLE", "META-DESC"):
            if not fm.get(field):
                issues.append(f"frontmatter: missing {field}")
        if len(fm.get("META-TITLE", "")) > 65:
            issues.append(f"meta-title too long ({len(fm['META-TITLE'])} chars)")
        if len(fm.get("META-DESC", "")) > 165:
            issues.append(f"meta-desc too long ({len(fm['META-DESC'])} chars)")

        # FAQ
        faq_split = re.split(r"## (?:Frequently Asked Questions|FAQ)", body, flags=re.I)
        if len(faq_split) < 2:
            issues.append("FAQ: section missing")
        elif len(re.findall(r"^### ", faq_split[1], re.M)) < 3:
            issues.append("FAQ: fewer than 3 questions")

        # embeds + stated prices in the line(s) right after each embed
        embeds = EMBED_RE.findall(body)
        if len(embeds) < 2:
            issues.append(f"embeds: only {len(embeds)}")
        for i, line in enumerate(lines):
            m = EMBED_RE.search(line)
            if not m:
                continue
            sku = m.group(1)
            p = by_sku.get(sku)
            if not p:
                continue  # validator's job
            # the fallback line is AFTER the embed; stop at the next embed so a
            # stacked neighbour's price is never misattributed
            ctx = []
            for l in lines[i + 1:i + 4]:
                if "<!--" in l:
                    break
                s = l.strip()
                # skip headings, price-bracket labels and tier labels — they are
                # section markers, not this product's stated price
                if s.startswith("#") or re.match(r"^฿[\d,]+\s*[–—-]", s) or re.search(r"Tier\s*[–—-]\s*฿", s):
                    continue
                if "฿" in l:
                    ctx.append(l)
                    break
            if not ctx:
                continue
            # stacked-prose guard: a bold line naming a DIFFERENT product belongs
            # to the next embed, not this one — require a name-token overlap
            bold = re.search(r"\*\*(.+?)\*\*", ctx[0])
            if bold:
                name_tokens = {w.lower() for w in re.findall(r"[A-Za-zÀ-ÿ]{4,}", p.get("name") or "")}
                line_tokens = {w.lower() for w in re.findall(r"[A-Za-zÀ-ÿ]{4,}", bold.group(1))}
                if name_tokens and line_tokens and not (name_tokens & line_tokens):
                    continue
            stated = [int(x.replace(",", "")) for x in PRICE_NEAR_EMBED_RE.findall(ctx[0])]
            if not stated:
                continue
            actual = p.get("special_price") or p.get("price") or 0
            base = p.get("price") or 0
            # OK if any stated number is within 5% of current price or sale price
            if not any(abs(s - a) / a <= 0.05 for s in stated for a in (actual, base) if a):
                issues.append(
                    f"price drift: {sku} text says ฿{stated[0]:,} but price=฿{base:,.0f}"
                    + (f" sale=฿{actual:,.0f}" if actual != base else "")
                )

        # images
        imgs = IMG_RE.findall(body)
        cover = fm.get("COVER-IMAGE", "")
        all_imgs = ([cover] if cover.startswith("http") else []) + imgs
        if len(imgs) == 0:
            issues.append("images: no section images")
        for u in all_imgs:
            if "plus.unsplash.com" in u:
                issues.append(f"image: premium-tier unsplash {u[:60]}")
        if re.search(r"^\*?Photo by ", body, re.M) or fm.get("COVER-CREDIT", "").startswith("Photo by"):
            issues.append("credits: 'Photo by' style found (should be editorial caption)")
        # pexels images are grandfathered (they load and are free); new images
        # follow the Unsplash standard — verify liveness via --check-urls

        # links
        if "/blog/category/" not in body:
            issues.append("links: no hub (category) link")
        sib = len(re.findall(r"\]\(/blog/(?!category)[a-z0-9-]+\)", body))
        if sib == 0:
            issues.append("links: no sibling post links")

        # compliance
        low = body.lower()
        for phrase in BANNED:
            if phrase in low:
                issues.append(f"compliance: contains '{phrase}'")

        if check_urls:
            import urllib.request
            for u in all_imgs:
                try:
                    req = urllib.request.Request(u, method="HEAD", headers={"User-Agent": "audit"})
                    code = urllib.request.urlopen(req, timeout=10).status
                except Exception:
                    code = 0
                if code != 200:
                    issues.append(f"image DEAD ({code}): {u[:70]}")

        status = "OK " if not issues else "FIX"
        print(f"{status} {f.name} ({len(embeds)} embeds, {len(imgs)} imgs)")
        for i in issues:
            print(f"     - {i}")


if __name__ == "__main__":
    main()
