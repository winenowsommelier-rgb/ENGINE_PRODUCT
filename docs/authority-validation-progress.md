# Authority Validation Progress

Last updated: 2026-05-10

## Current Scope

Focus: geography foundation for wine products, starting with `region`, then `subregion`, then `appellation`.

Process rule:

```text
WineSensed signal
→ authority source review
→ validated taxonomy value
→ read-only product update preview
→ bulk patch only after final review
```

## Queue Snapshot

- Total authority candidates: 6,989
- Region-gap candidates: 135
- Subregion-gap candidates: 3,394
- Appellation-gap candidates: 6,989
- Approved for product update: 0
- Published: 26
- Needs authority source / blocked from fill: 1

## Sales Tier Region Queue

Current region-gap status by sales tier:

| Sales tier | New region gaps | Action |
| --- | ---: | --- |
| S1 | 0 | Cleared. One S1 row was reviewed and parked as `needs_authority_source`. |
| S2 | 0 | No current new region gaps. |
| S3 | 108 | Continue in smaller authority-reviewed batches. |

S1 reviewed row:

| SKU | Product | Decision | Reason |
| --- | --- | --- | --- |
| WWW5236FJ | Colina Chardonnay | `needs_authority_source` | Available online evidence only supports generic `Wine of Chile`, not a canonical region. |

## Batch 1 Approved Region Decisions

These decisions are saved in `data/db/authority-validation-decisions.json` and were applied through `/api/products/bulk-patch` with `X-Source: enrichment`.

| SKU | Product | Country | Validated region | Confidence | Authority source |
| --- | --- | --- | --- | --- | --- |
| WWW1122BU | Terrazas Reserva Chardonnay | Argentina | Mendoza | High | `https://www.terrazasdelosandes.com/en-us/our-wines/reserva-chardonnay-2024` |
| WRW0415AA | Antinori Tignanello IGT | Italy | Tuscany | High | `https://www.antinori.it/vino/tignanello-en/` |
| WWW0009AA | Antinori Villa Antinori Bianco Toscana IGT | Italy | Tuscany | High | `https://www.antinori.it/en/vino/villa-antinori-bianco-en/?wineyear=master` |
| WRW0429AA | Santa Cristina By Antinori Le Maestrelle Toscana IGT | Italy | Tuscany | Medium | `https://www.santacristina.wine/wp-content/uploads/2021/06/FATTORIA-LE-MAESTRELLE-2020-ENG-1.pdf` |
| WRW4901AA | La Braccesca By Antinori Bramasole Cortona Syrah DOC | Italy | Tuscany | High | `https://www.antinori.it/en/vino/bramasole-en/` |

Preview result:

- Ready product rows: 0
- Blocked product rows: 0
- Published rows: 7
- Fields applied: `region` (5), `country` (2)

Bulk patch result:

- Total updates: 7
- Succeeded: 7
- Failed: 0
- Changelog entries: 17
- Dropped fields: 0

## Sales Tier S3 Batch 1 Region Decisions

These rows were selected because the product name or authority sources gave a high-confidence region foundation. They were applied through `/api/products/bulk-patch` with `X-Source: enrichment`, then marked `published`.

| SKU | Product | Country | Validated region | Confidence | Authority source |
| --- | --- | --- | --- | --- | --- |
| WRW4210GX | Little Beauty Marlborough 'Black Edition' Sauvignon Blanc | New Zealand | Marlborough | High | `https://littlebeauty.co.nz/wp-content/uploads/2025/05/Little-Beauty-Black-Edition-Sauvignon-Blanc-2019-Technical-Note.pdf` |
| WRW6524BN | Chateau Mouton Rothschild 2019 (Premiers Crus) | France | Bordeaux | High | `https://www.chateau-mouton-rothschild.com/chateau-mouton-rothschild/chateau-mouton-rothschild-2019` |
| WRW5484BN | Chateau Duhart Milon Rothschild 2018 | France | Bordeaux | High | `https://www.wine.com/product/chateau-duhart-milon-2018/520446` |
| WRW4993BN | Chateau Siran 2019 | France | Bordeaux | High | `https://www.wine.com/product/chateau-siran-2019/583864` |
| WRW4902AA | "Tormaresca" By Antinori Trentangeli Castel Del Monte DOC | Italy | Puglia | High | `https://store.tormaresca.it/prodotto/trentangeli/?lang=en` |
| WRW0427AA | "Tormaresca" By Antinori Masserie Maime Salento IGT | Italy | Puglia | High | `https://tormaresca.it/en/wines/masseria-maime/` |

Bulk patch result:

- Total updates: 6
- Succeeded: 6
- Failed: 0
- Changelog entries: 15
- Dropped fields: 0
- Product update preview after publishing: 0 ready, 0 blocked

## Sales Tier S3 Batch 2 Region Decisions

These rows were selected from the next S3 region queue because producer/estate authority pages support the region and the product fields were blank. They were applied through `/api/products/bulk-patch` with `X-Source: enrichment`, then marked `published`.

| SKU | Product | Country | Validated region | Confidence | Authority source |
| --- | --- | --- | --- | --- | --- |
| WWW0216AA | Castello Della Sala By Antinori Cervaro Della Sala, Umbria IGT | Italy | Umbria | High | `https://www.antinori.it/it/vino/cervaro-della-sala/` |
| WWW0214AA | Santa Cristina by Antinori Orvieto Classico "Campogrande" DOC | Italy | Umbria | High | `https://www.antinori.it/en/tenuta/estates-antinori/castello-della-sala-estate/` |
| WRW6119AA | Antinori Solaia IGT 2018 | Italy | Tuscany | High | `https://www.antinori.it/en/vino/solaia-en/?wineyear=2018` |
| WRW6561AA | Antinori Solaia IGT 2020 | Italy | Tuscany | High | `https://www.antinori.it/en/vino/solaia-en/` |
| WRW0423AA | Castello Della Sala By Antinori Pinot Nero Umbria IGT | Italy | Umbria | High | `https://www.antinori.it/en/vino/pinot-nero-en/il-castello-della-sala/` |
| WWW0215AA | Castello Della Sala By Antinori Chardonnay "Bramito del Cervo", Umbria IGT | Italy | Umbria | High | `https://www.antinori.it/en/vino/bramito-en/` |
| WRW0421AA | La Braccesca By Antinori Vino Nobile di Montepulciano DOCG | Italy | Tuscany | High | `https://www.antinori.it/en/vino/la-braccesca-nobile-di-montepulciano-en/` |
| WRW5337AA | "Tormaresca" By Antinori Neprica Primitivo IGT | Italy | Puglia | High | `https://tormaresca.it/en/wines/neprica-primitivo/` |
| WRW5338AA | "Tormaresca" By Antinori Neprica Negroamaro IGT | Italy | Puglia | High | `https://tormaresca.it/en/wines/neprica-negroamaro/` |
| WWW0218AA | "Tormaresca" By Antinori Chardonnay IGT | Italy | Puglia | High | `https://tormaresca.it/en/wines/chardonnay/` |
| WRW0425AA | "Tormaresca" By Antinori Torcicoda Salento IGT | Italy | Puglia | High | `https://tormaresca.it/en/wines/torcicoda/` |
| WRW4898AA | Le Mortelle By Antinori Botrosecco Cabernet DOC | Italy | Tuscany | High | `https://www.antinori.it/it/vino/botrosecco/` |
| WRW4899AA | Fattoria Aldobrandesca By Antinori Vie Cave, Malbec IGT | Italy | Tuscany | High | `https://www.antinori.it/it/vino/vie-cave/fattoria-aldobrandesca/` |

Bulk patch result:

- Total updates: 13
- Succeeded: 13
- Failed: 0
- Changelog entries: 27
- Dropped fields: 0
- Product update preview after publishing: 0 ready, 0 blocked

## Batch 1 Country Corrections

These rows were originally blocked because the current product country was `Italy`. The user confirmed they are from Chile, and official Haras de Pirque sources support the correction. They were applied as `country` updates first; region should be validated after the product country is synced locally.

| SKU | Product | Current country | Validated country | Confidence | Authority source |
| --- | --- | --- | --- | --- | --- |
| WWW0434AA | Haras de Pirque By Antinori Chardonnay Reserva | Italy | Chile | High | `https://haraswines.com/en/wines/chardonnay-en/` |
| WRW1144AA | Haras de Pirque By Antinori Cabernet Sauvignon Hussonet | Italy | Chile | High | `https://haraswines.com/en/wines/hussonet-en/` |

Follow-up region notes:

- `WRW1144AA` Hussonet: official source states Maipo Valley.
- `WWW0434AA` Chardonnay: official source places Haras de Pirque in Maipo and describes the Chardonnay as expressing Casablanca; validate exact region after country correction is applied.

## Next Recommended Batch

Continue S3 region validation in this order:

1. Products with explicit region/designation in the product name, such as `Toscana IGT`, `Castel del Monte DOC`, `Marlborough`, `Pauillac`, or `Bordeaux`.
2. Products with official producer pages available.
3. Products whose country is uncertain should be marked `needs_authority_source`, not filled.

Do not use WineSensed alone to fill product fields. It remains a research signal only.
