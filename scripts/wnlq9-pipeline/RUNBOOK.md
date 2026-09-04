# WNLQ9 — what to say, per data source

_Tested 1 September 2026. Every "I tried it" note below is something I actually
ran in this session, not something I expect to work._

There are six sources behind the three pages. Three I can refresh myself from a
chat session, one needs a five-minute setup from you, and two are blocked on
work only the developer can do. Knowing which is which is the whole point of
this page — it stops you asking me for something that is not mine to give.

---

## The one-line version

| Source | Who refreshes it | Cadence it deserves |
|---|---|---|
| Supabase catalog | me, now | weekly |
| Product URLs + images | me, now | monthly |
| Story lines + gauges | me, now | monthly |
| Stock_Checks sheet | me, now — I found it in your Drive | weekly |
| Popularity / best sellers | **nobody yet** — the job does not exist | weekly |
| Explorer editor picks | you | whenever you have something to say |

---

## 1. Supabase catalog — I can do this

**What it feeds:** prices, discounts, stock flags, reputation tier, critic
scores, vintages. Everything on a row that is not the ranking itself.

**Prompt:**

> Refresh the WNLQ9 catalog data from Supabase and rebuild all three pages.

**I tried it.** Works. I have the Supabase connector and project
`dsyplzckfezcxiuikkfm` is reachable. I re-checked it today and nothing had
changed since 28 August — `updated_at` still maxes at 22 August. So this one is
live, it just has nothing new in it most weeks.

**Worth knowing:** re-pulling is cheap for me but not free. If nothing upstream
changed, the rebuilt files are byte-identical and I will tell you so rather than
pretend the run did something.

---

## 2. Product URLs and images — I can do this

**What it feeds:** every link and bottle shot on all three pages.

**Prompt:**

> Refresh links_cache.tsv from Supabase and rebuild.

**I tried it.** Works — this is how the pages got off the hand-uploaded CSV
export. Coverage is 6,352 URLs and 6,387 images of 6,388 active products.

**Cadence:** monthly is plenty. Slugs change when a product is renamed, which is
rare. The nine SKUs in `links_supplement.csv` are the exception, and they are
waiting on the products sync, not on a refresh.

---

## 3. Story lines and gauges — I can do this

**What it feeds:** the provenance line under each row (region · designation ·
variety, plus the rarity clause) and the body/tannin/acidity/sweetness/peat bars.

**Prompt:**

> Refresh bs_story.tsv and bs_gauge.tsv from the PIM and rebuild.

**I tried it.** Works. Both come from catalog attributes that move slowly, so
monthly is right; weekly would be churn.

**Worth knowing:** the Thai glossaries these depend on — pairing terms, gauge
labels, reason chips — are hand-written constants in `bsdata.py` and
`explorer.py`, not translations generated at build time. They only change when
you edit them, which is the point. They are still waiting on your review.

---

## 4. Stock_Checks sheet — I can do this, and I did not know that until today

**What it feeds:** the entire trending view on all three pages, the demand tier
chips, the stock gauge, the internal unmet-demand report, and the `low` reason
on the Explorer shelf. It is the single highest-value feed you have.

**Prompt:**

> Pull the latest Stock_Checks from Drive and rebuild the trending lists.

**I tried it, and this is the finding of the session.** I searched your Drive
and found *WNLQ9 Internal Team Ticket Stock Check*
(`1S3FOBBgC3kS_pGksVs1PBt9hyn3k0rKmmNzWz86Iu50`). I can read it directly. It was
last modified **1 September at 09:02** and carries tickets through TCK-1537,
while the slice the pages are built on stops at 26 August.

So the "weekly manual export" step I have been describing as necessary was never
necessary for a chat session. It is only necessary for the unattended cron job,
which has no Drive connector — that still wants the published-CSV link.

Two things I noticed while looking at it, both of which matter:

- **The sheet's own column names are not the pipeline's.** It has `Ticket ID`,
  `Timestamp`, `Requester Name`, `Priority`, `SKU`, `Item Name`, `QTY`,
  `Item Notes`, `Stock Status`, `Supplier Feedback`, `Ticket Status`,
  `Client Name`, `Client Note`. Something normalised those down to
  `ticket,date,sku,name,qty,stock,client` by hand. I have put that mapping into
  `refresh.py` so it stops being a step somebody remembers.
- **Item names contain commas** — "Chateau Grand Corbin, Saint-Émilion Grand Cru
  Classé". A proper CSV export quotes them; a hand-saved one may not, and that
  is precisely how the product-URL export ended up with 14 rows whose columns
  were shifted by one. Always take the machine export, never a saved copy.

**Cadence:** weekly, before the Monday briefing. This is the feed where a
refresh actually changes what customers see.

---

## 5. Best sellers — SOLVED, pending one setup step

**Updated 1 September, after Pawin pointed at the right sheet.**

Best sellers no longer need the Supabase popularity columns at all. The
*MReport Item Performance* tab of **DATA: WNLQ9 Performance** carries real
monthly Orders and Qty Ordered per SKU back to January 2023, refreshed weekly,
and it is the same data the BI API serves.

`mreport.py` parses it, aggregates a trailing three complete months, and ranks
from that. `SYNC-SPEC.md` §3.2 — the popularity sync job — is no longer needed.

**Setup, one step:** publish that tab as CSV (File > Share > Publish to web >
MReport Item Performance > CSV) and set `MREPORT_CSV`. Until it is set, the
build falls back to the frozen July columns and says so in the log.

**Prompt once it is set:**

> Rebuild — best sellers should now rank on the MReport window.

**Two consequences worth knowing.** The window becomes a decision instead of a
mystery: the `_90d` columns said 90 while `popularity_window_days` said 365 and
nobody could settle it. It is now `mreport.WINDOW_MONTHS`, three complete
months, current month excluded — so the pages can finally state the period out
loud. And the rankings will move, possibly a lot, because they have been
standing still since July.

---

## 5b. The old popularity columns — leave them alone

**What it feeds:** every best-seller ranking. 1,220 rows across the three pages.

**Prompt:** there isn't one, and that is the point.

`popularity_qty_90d` is frozen at 21 July and stamped on 122 of 6,388 rows.
There is no job writing to it. If you ask me to refresh best sellers I will pull,
get the same July numbers, and hand you identical files. Asking more often does
not help.

This is `SYNC-SPEC.md` §3.2 and it is the developer's. Until it exists:

- every rebuild trips the staleness gate and needs a deliberate override
- `refresh.py` exits 1 every Monday, on purpose
- the movement arrows stay empty, because there is nothing to compare against

**When it is done, the prompt becomes:** *"Rebuild — the popularity job is live
now."* And the tell that it genuinely is: the build runs without
`WNLQ9_ALLOW_STALE`.

---

## 6. Explorer editor picks — this one is yours

**What it feeds:** the top of the Explorer shelf, above the automatic reasons.

**Prompt:**

> Add these to the Explorer picks: [SKU] — [your line in Thai] / [in English].
> Run it until [date].

I will write `explorer.json` and rebuild. Or edit the file directly:

```json
[{"sku": "WRW2359BN",
  "th": "ไร่เก่าแก่ในบารอสซา ผลิตปีละไม่มาก",
  "en": "Old Barossa vines, tiny production",
  "until": "2026-10-31"}]
```

This is also where any producer backstory belongs. There is no PR feed and no
social signal for wine and spirits in this catalog, so "what people are talking
about" is your voice or it is nothing — and a sommelier's line under a bottle is
worth more than anything I could assemble from search results anyway.

---

## The prompt for all of it at once

> Refresh everything: pull Stock_Checks from Drive, re-pull the catalog, links,
> story and gauge data from Supabase, rebuild all three pages, and run
> verification. Tell me what actually changed and what didn't.

That is one session. Expect me to report that best sellers did not move.

---

## What makes all of this unnecessary

Everything above is a person asking a chat session to run a script. The script
already exists — `refresh.py` — and it does all six sources in one command. It
needs a host with network access, `DATABASE_URL`, and one cron line.

Once that is running, this page shrinks to two entries: your Explorer picks, and
whatever you want to look at on a given week.
