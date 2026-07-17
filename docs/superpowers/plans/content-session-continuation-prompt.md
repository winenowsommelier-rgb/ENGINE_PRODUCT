# WNLQ9 Journal — Content Session Continuation Prompt

**Use this at the start of every new content-writing session.**
**Paste the entire file, then append your specific request at the bottom.**

*(Superseded 2026-07-18 — the previous version of this file referenced an
early Unsplash-only, single-post state of the project. That's long out of
date; this version reflects the actual current pipeline.)*

---

## CONTEXT: WHAT WE BUILT

WNLQ9 Journal — the editorial blog for WNLQ9 (wnlq9.shop), Bangkok's premium
online wine & spirits shop. Lives at `wnlq9.shop/blog`, built into the
Next.js storefront at `apps/catalog/`.

Posts are Markdown files at `apps/catalog/app/blog/posts/YYYY-MM-DD-slug.md`.

**57 posts published** (as of 2026-07-18): all 50 posts from the original
`content-50-topic-plan.md` are done, plus 7 Tier-A posts from
`content-keyword-map.md`'s planned-topics table. Full list:
`ls apps/catalog/app/blog/posts/`.

---

## PROCESS — follow exactly for every new post

1. **Check it's not already written.** `content-keyword-map.md`'s "Published
   posts" table has been unreliable in the past (missed ~16 real posts at
   one point, causing an accidental duplicate). Always cross-check
   `ls apps/catalog/app/blog/posts/` directly, not just the map.

2. **Check real catalog depth** before committing to a topic:
   ```
   .venv/bin/python scripts/content_product_picker.py --name "X" --limit 20
   ```
   Flags available: `--prefix` `--country` `--region` `--variety` `--name`
   `--min-price` `--max-price` `--limit` `--anchor` (no `--category`).
   Ranking is premium-first: `reputation_tier` → critic score → 90d sales →
   price. See `content-product-selection-standard.md` for full detail.

3. **Apply the fit-filter** (same doc, §2) — reject wrong-category name
   collisions (e.g. a "whisky finished in cognac casks" showing up in a
   cognac search), 0-stock candidates, and gift-box/format variants that
   aren't a genuinely distinct wine. Expect to reject ~half of mechanical
   candidates — that's the process working, not a problem.

4. **Verify final SKUs directly** against `data/live_products_export.json`
   (is_in_stock, price, special_price) before writing prose around them.

5. **Source real section images** (2+ per post, live API calls, not
   placeholders):
   ```bash
   export PEXELS_API_KEY=$(grep '^PEXELS_API_KEY=' .env.local | cut -d'"' -f2)
   export PIXABAY_API_KEY=$(grep '^PIXABAY_API_KEY=' .env.local | cut -d'"' -f2)
   python3 -c "
   import sys; sys.path.insert(0,'scripts')
   from curate_blog_images import fetch_photo
   print(fetch_photo('your search query'))
   "
   ```
   `fetch_photo()` tries Pexels first, then Pixabay fallback, then a
   broadened 2-word retry on both. Both keys are live and confirmed working.

6. **Match current frontmatter/structure** — read 1-2 of the most recently
   published posts before writing (`ls -t apps/catalog/app/blog/posts/ | head`)
   rather than trusting any hardcoded example, since the format has evolved.
   Frontmatter fields currently in use: `TITLE`, `SLUG`, `DATE`, `TAGS`,
   `COVER-IMAGE`, `COVER-CREDIT`, `COVER-CREDIT-URL`, `META-TITLE`, `META-DESC`.

7. **Add real internal links — this is a hard gate, not polish:**
   - One hub link: `/blog/category/[hub]` — hub slugs are `wine` `whisky`
     `spirits` `sake` (drink hubs) and `guides` `pairings` `deep-dives`
     `curated` `comparisons` `gifting` (purpose hubs). Table shorthand in
     `content-keyword-map.md` maps sub-tags (red-wine, sparkling, etc.) to
     these.
   - 2-3 sibling links: `/blog/[real-published-slug]` — must point at posts
     that actually exist, not planned/reserved ones.

8. **Run both gates — must pass clean before moving to the next post:**
   ```
   .venv/bin/python scripts/validate_blog_embeds.py
   .venv/bin/python scripts/audit_blog_content.py | grep -A5 "<your-slug>"
   ```
   `validate_blog_embeds.py` checks every SKU across every post is real,
   in-stock, priced, imaged. `audit_blog_content.py` checks price drift,
   section images present, hub link present, sibling links present, no
   banned phrases.

9. **Update `content-keyword-map.md`** — add the new post to "Published
   posts," remove it from "Planned Tier A." Keep it in sync every time.

10. **Pick the next publish date** = last scheduled post's date + 2 days
    (the established drip cadence — check `ls apps/catalog/app/blog/posts/
    | sort | tail -1` for the current latest date).

11. Content categories/word counts/SEO title formulas/AEO rules are in
    `content-creation-master-prompt.md` — still accurate, use as-is.

---

## SESSION STATE — as of 2026-07-18

**5 new posts written and gate-passed this session, NOT yet committed:**
- `2026-08-31-austrian-wine-gruner-veltliner-guide-bangkok.md`
- `2026-09-02-best-cognac-bangkok.md`
- `2026-09-04-best-premium-sake-bangkok.md`
- `2026-09-06-dessert-wine-mango-sticky-rice-bangkok.md`
- `2026-09-08-dom-perignon-vs-veuve-clicquot-bangkok.md`

`content-keyword-map.md` updated to reflect all 5 as published, uncommitted.
`data/live_products_export.json` was also regenerated this session (see
Known Issues #2) — also uncommitted.

**Next publish date: 2026-09-10.**

**First thing to do in the next session: ask the user whether to commit this
batch (5 posts + keyword-map + regenerated export) before writing anything
new**, unless they've already said so.

---

## REMAINING TIER-A TOPICS — verified real catalog depth, 2026-07-18

| # | Topic | Real depth | Notes |
|---|---|---|---|
| 59 | XO vs VSOP Cognac | 8 in-stock SKUs name-matching "VSOP", 21 matching "XO" | The just-shipped Cognac post (`best-cognac-bangkok`) already surfaced a good bottle pool — reuse those candidates rather than re-querying from scratch, but re-verify stock/price since prices drift |
| 60/61 | Natural wine / Organic wine | 55 in-stock SKUs (name search "natural wine"/"organic") | Consider merging into ONE post — near-duplicate angles on a thin catalog. `orange-wine-what-is-it-bangkok` and the Austrian post's Judith Beck Pet Nat already touch this territory — read both before drafting to avoid overlap/contradiction |
| 70 | Wine investment Thailand | N/A — editorial, not a buying guide | Different post shape: investment mechanics, storage, resale/legal context in Thailand — not primarily a catalog query. Likely wants 2-3 illustrative collector-tier embeds (Bordeaux/Burgundy), but the core content needs research beyond the product picker |

**Already correctly skipped this session — do not redo without new
justification:**
- #53 sake under ฿1,500 — overlaps the existing sake buying guide's price range
- #55 sake grades explained (Daiginjo/Junmai) — overlaps the existing sake
  guide's "The Grade System: What the Labels Mean" section

Once #59/60-61/70 are done, the Tier-A list (35-70) is exhausted. At that
point, either extend the keyword map with new topics or shift to a different
content mode (archive refresh, seasonal/monthly recurring posts per
`content-50-topic-plan.md`'s "Curated" monthly-refresh category).

---

## KNOWN ISSUES FOUND THIS SESSION — unrelated to content writing, still open

1. **`.env.local`'s `GOOGLE_SERVICE_ACCOUNT_JSON` is malformed** — wrapped in
   stray quotes, breaks `/api/gsc` and `/api/ga4` with a 500 (JSON parse
   error at position 1). Two fix attempts failed and were reverted rather
   than risk further damage to a live private key mid-edit. **User chose to
   skip fixing this** ("Skip GSC/GA4 entirely for this session") — it is
   still broken. If GSC/GA4-driven topic picking becomes wanted, this needs
   careful re-fixing (ideally the user re-pastes the credential fresh, or a
   dedicated script does the dotenv-escaping correctly, verified without
   ever printing key content to a terminal/transcript).

2. **`data/live_products_export.json` had an unresolved git merge conflict**
   (`UU` status, literal `<<<<<<<` markers) at the start of this session.
   Fixed by regenerating from `products.db` via
   `.venv/bin/python scripts/refresh_live_export.py` — the canonical fix per
   Rule 9 (never hand-edit the export). Now clean (`M` status, valid JSON,
   11,934 products). Not yet committed — bundle with the content commit, or
   ask the user how they want it handled.

3. **`content-keyword-map.md`'s "Published posts" table was significantly
   stale** at the start of this session — missing at least 16 already-shipped
   posts, which caused one accidental duplicate draft (Spanish wine beyond
   Rioja — caught by the audit gate before it went further, deleted). The
   table is more accurate now after this session's updates, but a full
   one-time audit against `ls apps/catalog/app/blog/posts/` would be worth
   doing to fully re-sync it and prevent future collisions.

---

## KEY FILE LOCATIONS

- Posts: `apps/catalog/app/blog/posts/YYYY-MM-DD-slug.md`
- Keyword/interlink map: `docs/superpowers/plans/content-keyword-map.md`
- Voice/format/SEO rules: `docs/superpowers/plans/content-creation-master-prompt.md`
- Product selection process: `docs/superpowers/plans/content-product-selection-standard.md`
- Original 50-topic plan (all shipped): `docs/superpowers/plans/content-50-topic-plan.md`
- Product picker: `scripts/content_product_picker.py`
- Gates: `scripts/validate_blog_embeds.py`, `scripts/audit_blog_content.py`
- Image sourcing: `scripts/curate_blog_images.py` (`fetch_photo()` — Pexels
  primary + Pixabay fallback, both live-verified working as of this session)
- Catalog data: `data/live_products_export.json` — regenerate via
  `.venv/bin/python scripts/refresh_live_export.py` if stale or conflicted;
  never hand-edit it directly (Rule 9)

---

## HOW TO MAKE A REQUEST

After pasting this prompt, add one of:

> "Continue — write #59, XO vs VSOP Cognac."

> "Write the natural/organic wine post — decide whether to merge #60/61 into one."

> "Do #70, wine investment — research Thai import/resale context first."

> "Commit the pending batch, then continue."

You'll get back the same process every time: real catalog check → fit-filter
→ real images → draft → both gates pass → keyword map updated → confirm what's
next.
