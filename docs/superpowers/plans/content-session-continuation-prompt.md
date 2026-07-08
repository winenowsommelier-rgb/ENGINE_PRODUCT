# WNLQ9 Journal — Content Session Continuation Prompt

**Use this at the start of every new content session.**
**Paste the entire file, then append your specific request at the bottom.**

---

## CONTEXT: WHAT WE BUILT

We are building the WNLQ9 Journal — the editorial blog for WNLQ9 (wnlq9.shop), Bangkok's premium online wine & spirits shop. The blog lives at `wnlq9.shop/blog` and is built into the Next.js storefront at `apps/catalog/`.

Blog posts are written as Markdown files saved to:
```
apps/catalog/app/blog/posts/YYYY-MM-DD-slug.md
```

After writing and saving, commit and push to `main` — Vercel auto-deploys.

Post #1 is live: `wnlq9.shop/blog/what-wine-goes-with-thai-food-the-bangkok-guide`

---

## FRONTMATTER FORMAT (required on every post)

```
---
TITLE: [exact post title]
SLUG: [kebab-case-slug]
DATE: [YYYY-MM-DD]
TAGS: [pairing,thai-food,white-wine — category slug first]
COVER-IMAGE: [full Unsplash CDN URL — see Image Rules below]
COVER-CREDIT: Photo by [Name] on Unsplash
COVER-CREDIT-URL: [Unsplash photo page URL]
META-TITLE: [50–60 chars, includes Bangkok + price range]
META-DESC: [140–155 chars, includes Bangkok + THB price]
---
```

---

## DESIGN STANDARDS (applied and verified this session — follow exactly)

### Typography Hierarchy
H2 and H3 must be visually distinct — not just different sizes but different design languages:

- **H2** — large (1.75rem), bold, tight tracking (`-0.025em`), near-black `hsl(0 0% 7%)`, bottom border `2px solid hsl(0 0% 88%)`. Section titles. Magazine-style.
- **H3** — small (1.05rem), uppercase, wide tracking (`0.06em`), wine-red accent `hsl(350 35% 32%)`. Sub-labels. Editorial small-caps style.

This is already live in `apps/catalog/app/globals.css` — do not change it.

### Product Embed Cards (InlineProductCard)
Inline product cards inside blog posts use `<!-- product: SKU -->` syntax.

Current card design (already shipped):
- `bg-stone-50/60` translucent background, `border-stone-100` hairline, `rounded-2xl`
- Bottle image container: gradient `from-stone-100 to-stone-50`, `rounded-xl`
- `mix-blend-multiply` on bottle images — removes white label backgrounds

### Product Grid Cards (ProductCard — "You might also like")
- Explicit `bg-white` card, `border-stone-100`, `rounded-xl`
- `mix-blend-multiply` on bottle images via `StorefrontImage`
- Text block: `px-3 pb-3 pt-3` padding
- Hover: `-translate-y-0.5`, `border-stone-200`, `shadow-md`

### Section Images
Every major H2 section should have a thematically accurate image. Rules:

1. Subject must match the section topic exactly (white wine section = white wine glass, NOT red wine grapes)
2. Free-tier Unsplash only — CDN URL must start with `images.unsplash.com/photo-` (NOT `plus.unsplash.com/premium_photo-`)
3. CDN ID format: 13-digit numeric + 12-char hex (e.g. `1682071308366-1d098905b498`)
4. **How to verify a free-tier ID**: `curl -s "https://images.unsplash.com/photo-{ID}?w=100" -o /dev/null -w "%{http_code}"` → must return 200
5. Replace `Photo by [Name] on Unsplash` credits with a 1-sentence editorial description of what the image shows and why it matters

Image syntax in Markdown:
```markdown
![Alt text describing what is shown](https://images.unsplash.com/photo-{ID}?fm=jpg&q=80&w=1000&auto=format&fit=crop)
*One sentence editorial caption explaining relevance.*
```

### Verified Working Unsplash IDs (free tier, confirmed 200)
- White wine pour: `1682071308366-1d098905b498`
- Rosé wine pour: `1628876153244-d10fca15052c`
- Champagne pour with bubbles: `1623428454697-08da4a100602`
- Thai food spread: `1675150277436-9c7348972c11`

---

## WHO YOU ARE WRITING FOR

**Publication:** WNLQ9 Journal — editorial voice of WNLQ9, Bangkok's premium online wine & spirits shop.

**Audience:** English-speaking people living in Thailand:
- Expats in Bangkok, Chiang Mai, Phuket (mid-to-senior career, confident wine drinkers)
- Thai nationals educated abroad or in international business (curious, aspirational, English-comfortable)
- Hospitality professionals — F&B managers, sommeliers, hotel buyers

**Tone:** Knowledgeable but not snobbish. Like a trusted sommelier friend, not a textbook. Direct sentences. No filler. No "in conclusion." Think Monocle × Decanter, written for someone in Bangkok traffic.

**Language:** English only in the body. Thai is fine in product names, dish names, place names (*ส้มตำ*, *khao man gai*).

---

## THE CATALOG

6,201 in-stock SKUs. Top categories:
| Category | SKUs |
|---|---|
| Red Wine | 2,438 |
| White Wine | 853 |
| Sparkling & Champagne | 442 |
| Whisky | 431 |
| Sake / Shochu | 353 |

**Price landscape (THB):**
- Under ฿500 — entry level
- ฿500–1,500 — volume sweet spot (2,627 SKUs)
- ฿1,500–3,000 — premium gifting
- ฿3,000+ — collector / occasion

**Product embed syntax** (resolves to a buyable card on the live site):
```
<!-- product: SKU_HERE -->
```
If SKU is unknown: `<!-- product: PLACEHOLDER — [describe: e.g. Marlborough Sauvignon Blanc under ฿1,000] -->`

---

## SEO & AEO RULES

Structure every post:
1. Introduction — 2–3 sentences, hook
2. H2 sections — 2–5 sections
3. Product embeds — at least 2–3 per section
4. Section images — one per H2 (thematically accurate, free Unsplash)
5. FAQ — 3–5 H3 questions + short answers (REQUIRED for AEO)

SEO title formulas:
- Pairing: `"[Dish] Wine Pairing: Best Bottles to Buy in Bangkok (฿[range])"`
- Compare: `"[A] vs [B]: Which Wine to Buy in Thailand"`
- Guide: `"[Topic] Guide: Everything You Need to Know (Bangkok)"`
- Curated: `"Best [Category] Under ฿[X]: [Month] [Year] Picks"`

AEO requirements: FAQ H3s written as someone would ask ChatGPT or Google. Mention Bangkok, THB prices, specific regions/grapes. Include local context (Thai heat, Thai dishes, Bangkok availability).

---

## WORD COUNT TARGETS

| Category | Target |
|---|---|
| Curated (list) | 800–1,200 words |
| Compare | 1,000–1,500 words |
| Pairing | 900–1,300 words |
| Guide | 1,200–1,800 words |
| Deep Dive | 1,500–2,500 words |

---

## PRIORITY CONTENT CALENDAR — POSTS 2–10

Post #1 is LIVE. Build these next, in order:

| # | Category | Title | Notes |
|---|---|---|---|
| 2 | Curated | 10 Best Red Wines Under ฿1,500 in Bangkok — July 2026 | Cab Sauv, Bordeaux, Merlot focus |
| 3 | Compare | Bordeaux vs Burgundy: Which French Red Should You Buy? | 2,438 red wines available |
| 4 | Guide | A Complete Guide to Sake in Thailand: What to Buy and Why | 353 Sake/Shochu SKUs |
| 5 | Pairing | The Best Wine to Drink with Seafood in Bangkok | grilled fish + shellfish tags |
| 6 | Curated | Best Champagne & Sparkling Wine Under ฿3,000 | 442 Sparkling SKUs |
| 7 | Deep Dive | Burgundy Explained: Côte de Nuits vs Côte de Beaune | 293 Burgundy SKUs |
| 8 | Guide | How to Store Wine in Bangkok Heat: The Complete Guide | local problem, high intent |
| 9 | Pairing | Best Whisky Pairings for Japanese Food in Bangkok | 431 Whisky + 527 Japan SKUs |
| 10 | Curated | Best Japanese Whisky in Bangkok: What's in Stock Now | Single Malt, 242 SKUs |

---

## PUBLISHING WORKFLOW

1. Write Markdown draft with frontmatter
2. Save to `apps/catalog/app/blog/posts/YYYY-MM-DD-slug.md`
3. Commit: `git add [file] && git commit -m "feat(blog): [description]"`
4. Push: `git push origin main`
5. Vercel auto-deploys — live at `wnlq9.shop/blog/[slug]` in ~2 min

---

## WHAT NOT TO DO

- Do not write "In conclusion" or "In this article we will..."
- Do not pad with generic wine history
- Do not recommend bottles without a real SKU or a flagged PLACEHOLDER
- Do not skip the FAQ section — it is required every time
- Do not use Unsplash Plus / premium photos (`plus.unsplash.com`) — free tier only
- Do not use a section image that shows the wrong subject (red wine for white wine section)
- Do not write photo credits — use editorial image descriptions instead
- Do not vary H2/H3 styling — the CSS is already set; Markdown headings render correctly

---

## HOW TO MAKE A REQUEST

After pasting this prompt, add one of:

> "Write post #2 — 10 Best Red Wines Under ฿1,500. Use real SKUs where possible, flag placeholders."

> "Write post #4 — sake guide. Target ฿1,000–2,500. Cover image from sake bottle SKU."

> "Write post #6 — Best Champagne Under ฿3,000. Embed 6+ sparkling SKUs."

You will get back:
- Frontmatter block (TITLE / SLUG / DATE / TAGS / COVER-IMAGE / META)
- Full Markdown ready to save and push
- List of any placeholder SKUs needing manual lookup

---

*Session context: post #1 live at wnlq9.shop/blog/what-wine-goes-with-thai-food-the-bangkok-guide*
*Design system shipped: July 2026. Catalog: live_products_export.json.*
