#!/usr/bin/env python3
"""Source candidate product bottle images from official producer sites (headless).

Reads a targets TSV (sku<TAB>brand<TAB>name), and for each:
  1. searches the web for the official producer product page,
  2. renders it with a headless browser (so JS-loaded images resolve),
  3. picks the most-likely bottle image (largest rendered <img>, prefers
     og:image / product-gallery candidates),
  4. records sku<TAB>image_url<TAB>source_page<TAB>width x height<TAB>note.

It DOES NOT modify the catalog/export. Output is a review sheet a human vets
before any URL goes live (see CLAUDE.md Rule 1 + the wrong-image history).

Usage:
  .venv/bin/python scripts/source_product_images.py \
      --targets data/image_sourcing/targets.tsv \
      --out data/image_sourcing/candidates.tsv \
      [--limit N] [--headed]
"""
from __future__ import annotations

import argparse
import csv
import sys
import urllib.parse
from pathlib import Path

from playwright.sync_api import sync_playwright

# Hosts we will NOT take images from (retailer/marketplace/review = copyright /
# wrong-label risk). We want producer or official-importer domains only.
BLOCKED_HOST_SUBSTR = (
    "wine.com", "totalwine", "vivino", "wine-searcher", "winesearcher",
    "selfridges", "lcbo", "klwines", "caskers", "amazon", "ebay",
    "wineenthusiast", "falstaff", "drizly", "bevmo", "facebook", "instagram",
    "gstatic", "google", "duckduckgo", "bing", "yandex", "pinterest",
)

# Minimum rendered size for a plausible bottle shot (skip icons/logos/sprites).
MIN_DIM = 150


def host_of(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lower()
    except Exception:
        return ""


def is_blocked(url: str) -> bool:
    h = host_of(url)
    return any(b in h for b in BLOCKED_HOST_SUBSTR)


def find_official_page(page, query: str) -> str | None:
    """Use DuckDuckGo HTML (no-JS friendly) to find a non-retailer result."""
    page.goto("https://duckduckgo.com/html/?q=" + urllib.parse.quote(query + " official site"),
              wait_until="domcontentloaded", timeout=30000)
    links = page.eval_on_selector_all(
        "a.result__a, a.result__url",
        "els => els.map(e => e.href)",
    )
    for href in links:
        # DDG wraps targets in a redirect; unwrap uddg= param.
        real = href
        if "uddg=" in href:
            q = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
            real = (q.get("uddg") or [href])[0]
        if real.startswith("http") and not is_blocked(real):
            return real
    return None


def best_image_on(page) -> tuple[str | None, int, int]:
    """Return (url, w, h) of the largest plausible product image after render."""
    # Prefer og:image if it is on an allowed host.
    og = page.eval_on_selector(
        'meta[property="og:image"]', "e => e && e.content"
    ) if page.query_selector('meta[property="og:image"]') else None
    candidates = page.eval_on_selector_all(
        "img",
        """els => els.map(e => ({
            src: e.currentSrc || e.src,
            w: e.naturalWidth || e.width,
            h: e.naturalHeight || e.height,
            alt: (e.alt||'').toLowerCase(),
        }))""",
    )
    scored = []
    for c in candidates:
        src = c.get("src") or ""
        if not src.startswith("http"):
            continue
        if is_blocked(src):
            continue
        w, h = int(c.get("w") or 0), int(c.get("h") or 0)
        if w < MIN_DIM or h < MIN_DIM:
            continue
        area = w * h
        # bottles are portrait; boost taller-than-wide + alt mentioning bottle/wine
        if h > w:
            area = int(area * 1.3)
        if any(k in c.get("alt", "") for k in ("bottle", "wine", "whisky", "liqueur", "prosecco")):
            area = int(area * 1.2)
        scored.append((area, src, w, h))
    scored.sort(reverse=True)
    if scored:
        _, src, w, h = scored[0]
        return src, w, h
    if og and not is_blocked(og):
        return og, 0, 0
    return None, 0, 0


def run(targets: Path, out: Path, limit: int | None, headed: bool,
        download_dir: Path | None) -> None:
    rows = [r for r in csv.reader(targets.open(), delimiter="\t") if r and not r[0].startswith("#")]
    if limit:
        rows = rows[:limit]
    if download_dir:
        download_dir.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not headed)
        ctx = browser.new_context(
            user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
            viewport={"width": 1280, "height": 1600},
        )
        page = ctx.new_page()
        for row in rows:
            sku = row[0].strip()
            brand = row[1].strip() if len(row) > 1 else ""
            name = row[2].strip() if len(row) > 2 else ""
            # 4th column (optional): a pre-resolved official page URL. Web search
            # via this script is unreliable (DDG blocks bots), so the caller
            # resolves official URLs with a real search tool and passes them in.
            preset = row[3].strip() if len(row) > 3 and row[3].strip() else ""
            query = f"{brand} {name}".strip()
            note, img, src, w, h = "", None, None, 0, 0
            try:
                src = preset or find_official_page(page, query)
                if not src:
                    note = "no official page found"
                else:
                    page.goto(src, wait_until="domcontentloaded", timeout=45000)
                    page.wait_for_timeout(2500)  # let lazy images settle
                    # nudge lazy-loaders that fire on scroll
                    try:
                        page.evaluate("window.scrollTo(0, document.body.scrollHeight/2)")
                        page.wait_for_timeout(1200)
                    except Exception:
                        pass
                    img, w, h = best_image_on(page)
                    if not img:
                        note = "page found, no usable image"
            except Exception as e:
                note = f"error: {type(e).__name__}: {str(e)[:80]}"
            # Download for human visual review (the only real wrong-image guard).
            if img and download_dir:
                try:
                    ext = ".png" if ".png" in img.lower() else ".jpg"
                    dest = download_dir / f"{sku}{ext}"
                    resp = ctx.request.get(img, timeout=30000)
                    if resp.ok:
                        dest.write_bytes(resp.body())
                except Exception as e:
                    note = (note + f"; dl-fail:{type(e).__name__}").strip("; ")
            print(f"[{sku}] {query[:45]:45} -> {img or note}", file=sys.stderr)
            results.append([sku, img or "", src or "", f"{w}x{h}" if img else "", note])
        browser.close()

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as f:
        w_ = csv.writer(f, delimiter="\t")
        w_.writerow(["sku", "candidate_image_url", "source_page", "rendered_size", "note"])
        w_.writerows(results)
    found = sum(1 for r in results if r[1])
    print(f"\nDONE: {found}/{len(results)} got a candidate image. Review: {out}", file=sys.stderr)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--download-dir", type=Path, default=None,
                    help="if set, save each found image here named <sku>.jpg/png for visual review")
    a = ap.parse_args()
    run(a.targets, a.out, a.limit, a.headed, a.download_dir)
