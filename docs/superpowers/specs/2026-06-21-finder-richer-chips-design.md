# Finder — Richer, Iconed Choice Chips (design)

**Date:** 2026-06-21
**Status:** Draft (design), pending spec review → plan → build
**Builds on:** the shipped Finder + Sommelier upgrade
(`2026-06-20-wnlq9-finder-sommelier-upgrade-design.md`). This is an ADDITIVE content
change to the question chips — no new architecture.

**Goal:** Make the finder feel detailed, professional, and credible by replacing the
generic chips ("Spicy / Asian", an 8-item flavor list) with **richer, grouped, icon-led
choices** — every one backed by real data that returns products.

---

## 1. Why
The current chips undersell a deep catalog. "Spicy / Asian" is boring when the data has
**Thai (451), Sushi/Sashimi (338), Dim Sum (218), Vietnamese (57), Korean (14)** as
distinct, real food_matching cuisines, plus 78 master flavor notes across 12 families.
Richer + iconed choices read as "these people know wine/food."

## 2. Non-negotiable: every chip returns products (no credible dead ends)
All groups below were verified live against in-stock `food_matching` / `flavor_tags_canonical`.
Counts are in-stock products that match the group's keyword/note set. The min-results
guarantee (scoring §5) still covers thin sets honestly.

## 3. Food chips — "What are you eating?" (cuisines + dishes, grouped, iconed)
Replaces the current generic food chips. Each chip = `{key, label, icon, keywords[]}`.
Scoring stays the existing substring-overlap on `food_matching` (food-chips.ts). Verified counts:

| Icon | Label | key | keywords (ci substring) | in-stock |
|---|---|---|---|---|
| 🌶️ | Thai food | thai | thai | 451 |
| 🍣 | Sushi & sashimi | sushi | sushi, sashimi | 338 |
| 🥟 | Dim sum & Chinese | dimsum | dim sum, chinese | 218 |
| 🥩 | Korean BBQ | korean | korean | 14 |
| 🍜 | Vietnamese | vietnamese | vietnamese | 57 |
| 🔥 | Spicy dishes | spicy | spicy, curry | 398 |
| 🥩 | Grilled & BBQ meat | grilled | grilled, bbq, barbecue, steak | 3,150 |
| 🍗 | Roast & duck | roast | roast, duck | 1,585 |
| 🐑 | Lamb & game | lamb | lamb, game, venison | 1,467 |
| 🥓 | Pork dishes | pork | pork | 587 |
| 🦪 | Seafood & oysters | seafood | seafood, oyster, shellfish, prawn, crab, fish | 1,439 |
| 🧀 | Cheese & charcuterie | cheese | cheese, charcuterie | 2,013 |
| 🍝 | Pasta & pizza | pasta | pasta, pizza, risotto | 1,293 |
| 🥗 | Salads & light | salad | salad, vegetable, vegetarian | 594 |
| 🍫 | Chocolate & dessert | dessert | chocolate, dessert, cake, sweet | 698 |

(15 chips. Grouped visually: **Asian cuisines** · **Meat & roast** · **Seafood** ·
**Cheese/pasta/light** · **Sweet**. Icons disambiguate the duplicate 🥩 — Korean uses a
distinct one in build, e.g. 🍖 for Korean BBQ vs 🥩 grilled.)

## 4. Flavor chips — "Any flavors you love?" (grouped by family, iconed)
Replaces the current flat 8. ~12 family chips, each maps to a SET of canonical master
notes (the chip matches if the product carries any note in its set).

> **CRITICAL — field + matcher (fixes a SHIPPED bug):**
> 1. Flavor scoring MUST read **`flavor_tags_canonical`** (Title-Case canonical notes, e.g.
>    "Dark Plum", "Minerality") — NOT `flavor_tags`, which `scoring.ts:217` reads today and
>    which carries variant strings. All counts below are verified against `flavor_tags_canonical`.
> 2. The current matcher `tags.includes(norm(chip))` (scoring.ts:218) is **already broken**:
>    chip keys are hyphenated (`red-fruit`) and never equal the spaced tag (`red fruit`), so
>    `red-fruit` + `dark-fruit` score 0 in production right now. The build MUST replace it with
>    a `FLAVOR_FAMILY: Record<key, string[]>` map and test **set-intersection** of the chip's
>    canonical note set against the product's `flavor_tags_canonical` (normalized) — exactly the
>    `GRAPE_FAMILY`/`FOOD_CHIPS` pattern. Do NOT keep `tags.includes(chip)`.
> 3. Build MUST add a regression test asserting `dark-fruit` (and a previously-dead chip) now
>    scores > 0 (Rule 5 — don't leave an inert path green).

| Icon | Label | key | maps to notes (canonical, normalized) | in-stock |
|---|---|---|---|---|
| 🍒 | Red fruit | red-fruit | red fruit, cherry, strawberry, raspberry | 1,210 |
| 🫐 | Dark fruit | dark-fruit | dark plum, plum, blackcurrant, blackberry, black cherry | ~1,650 |
| 🍋 | Citrus | citrus | citrus, citrus zest, lemon, lime, grapefruit | 1,751 |
| 🍑 | Stone & orchard fruit | stone-fruit | stone fruit, peach, apricot, green apple, pear | 1,575 |
| 🍍 | Tropical | tropical | tropical, pineapple, mango, passion fruit | 337 |
| 🪵 | Oak & vanilla | oak | oak, vanilla, cedar, toast | 2,161 |
| 🌶️ | Spice | spice | spice, black pepper, baking spice, cinnamon, clove | 1,867 |
| 🍂 | Earthy & savory | earthy | earth, tobacco, leather, mushroom, graphite | ~1,730 |
| 🌸 | Floral | floral | floral, rose, violet, blossom | 1,116 |
| 🪨 | Mineral & saline | mineral | minerality, wet stone, sea salt, flint, chalk | 2,081 |
| 💨 | Smoky | smoky | smoke, smoky, peat | 356 |
| 🥜 | Nutty & creamy | nutty | hazelnut, almond, brioche, cocoa, caramel, honey | 1,626 |

Scoring: +2 if the product's `flavor_tags_canonical` (normalized) intersects the chosen
chip's note set — via a `FLAVOR_FAMILY` key→note-set map, replacing the broken
`tags.includes(chip)` line (see CRITICAL box above). Multi-select (pick a few), as today.

## 5. Character step
The wine "character" axis2 (fruity / earthy / balanced) stays as-is conceptually but gets
icons (🍓 Fruit-forward · 🍂 Earthy & savory · ⚖️ Balanced) for consistency. No data change.

## 6. Icons everywhere (the user's ask)
ALL finder choice chips get a leading emoji/icon — not just food/flavor: occasion
(🍽️ with food · 🎁 gift · ✨ special · 🥂 everyday · 🧭 exploring), budget (💸 tiers),
body (🪶 light · ⚖️ medium · 🍷 bold), acidity/tannin/age/adventure, and the Step-1
category cards (🍷 Red · 🥂 Sparkling · 🥃 Whisky · …). Implementation: add an optional
`icon?: string` to `StepOption` (question-config.ts) and render it before the label in
**`ChoiceCards` and `FoodChoice`** (these are the components that map over `options` and
render chips; `StepShell` only renders children/Back/Skip, so it needs no change). The
Step-1 category cards render in `app/finder/page.tsx`. Purely additive; a missing icon
just renders the label.

## 7. Implementation surface (additive, no architecture change)
- `lib/finder/food-chips.ts` — replace FOOD_CHIPS with the §3 map (key→{label, icon, keywords}).
- `lib/finder/question-config.ts` — `StepOption` gains `icon?`; food + flavor deep-dive
  steps use the new chip sets; add icons to all existing option sets (§6).
- `lib/finder/scoring.ts` — flavor scoring matches against the note SET per chip (§4); food
  scoring unchanged (already keyword-substring). Keep additive/degraded discipline intact.
- `components/finder/{ChoiceCards,FoodChoice}.tsx` — render `option.icon` before label
  (StepShell renders no chips — no change needed there).
- `app/finder/page.tsx` — category cards get icons.

## 8. Testing
- **Unit:** every food chip's keyword set and every flavor chip's note set returns ≥1
  in-stock product (data-invariant test against the real export — the dead-chip guard);
  flavor scoring matches the note set; icons present on all option sets; core scoring
  unchanged (additive).
- **Browser (Rule 7):** the food + flavor steps render the new iconed chips; picking Thai /
  Sushi / a flavor family yields a non-empty result; chips look clear with icons; all 7
  categories still complete.

## 9. Out of scope
- A full 78-note picker / two-step cuisine→dish flow (considered, deferred — grouped chips
  chosen for the 40+ audience). The icon for duplicate proteins resolved at build (Korean
  BBQ 🍖 vs grilled 🥩).
