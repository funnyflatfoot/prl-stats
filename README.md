# PRL Stats

Analyst-facing dashboard for Pearl Network (PRL), deployed at prlstats.vercel.app. Next.js App Router, Tailwind, Recharts.
Chain data is scraped from the Pearl explorer into a local store; price comes from CoinGecko.

**Integrity rule.** Every number on the page is either read off the chain, read off the price feed, or a
protocol constant listed in `config/constants.json` with its source. Nothing is modelled, estimated or
tunable. Four charts that are all checkable beats six where two are guesses, so metrics that needed an
assumption to exist were cut rather than parameterised — see *What is deliberately not here*.

## Quick start

```bash
npm install
npm run selftest     # parser and maths checks, no network, no install needed
npm run ingest       # chain, block 99,000 -> tip, resumable, ~15 blocks/s
npm run market       # price and volume history
npm run dev          # http://localhost:3000
```

A cold ingest of roughly 13,000 blocks takes about fifteen minutes and checkpoints as it goes.
Re-running only fetches the gap between the cache high-water mark and the current tip, so a cron
entry of `npm run refresh` every 30 minutes keeps it current.

## Why there is a scraper

`explorer.pearlresearch.ai` has no public API. Two calls carry everything:

**Block header** — `GET /block/<height>?network=mainnet`. The RSC payload embeds the block JSON with
escaped quotes: `height`, `time`, `bits`, `difficulty`, `size`, `tx_count`, `txids`. `txids[0]` is the
coinbase. `maxHeight` in the same payload is the chain tip, which is how ingestion finds the end.

**Coinbase outputs** — `POST /block/<any>?network=mainnet` with headers `Accept: text/x-component` and
`next-action: <ACTION_ID>`, body `[[txid, ...]]`, 40 txids per batch. The reply line beginning
`1:{"response":` holds `vout` addresses and amounts. The largest output is the payout address; a few
pools split ~1% to a second address, and both are stored.

### Rotating the action id

`ACTION_ID` is a build artifact of the explorer and changes on **every explorer redeploy**. It lives in
`config/explorer.config.json` as `actionId` and is never inlined anywhere else. When it goes stale,
ingestion stops with a loud message and exit code 2 rather than writing blocks with missing miners, and
the UI surfaces `ingest stale-action-id` in the header.

To rotate:

1. Open `https://explorer.pearlresearch.ai/blocks` with DevTools on the Network tab.
2. Click **View Details** on any block.
3. Find the `POST` to `/block/<hash>` and copy the `next-action` request header.
4. Put it in `config/explorer.config.json` (`actionId`), update `actionIdCapturedAt`.
5. `npm run ingest`

`npm run ingest -- --headers-only` keeps ingesting headers (difficulty, block time, sizes) while the id
is broken. Those blocks come back with `miner: null` and show up as `unattributed` in panel 2 until you
re-ingest that range with `--refetch`.

## Ingestion

| Flag | Effect |
| --- | --- |
| `--from <h>` | force a start height (default: cache high-water mark, else `startHeight`) |
| `--to <h>` | stop early |
| `--headers-only` | skip coinbase lookups |
| `--refetch` | re-ingest a range already in the cache |

Concurrency, batch size, checkpoint interval, retries and timeouts are in `config/explorer.config.json`.
Six concurrent requests is the tested ceiling; the explorer starts returning 503s above it, and the
retry ladder handles the occasional one.

Ingestion starts at **block 99,000**. The V3 salted noise-seed fork activated at #98,900 and everything
before it is a different consensus regime: difficulty, block times and miner software all changed, so
mixing the two produces charts that look like signal and are not.

## Store

```
data/blocks.ndjson    append-only, one block per line, last write wins on duplicate heights
data/checkpoint.json  last run, high-water mark, tip, status
data/market.json      CoinGecko spot + daily price/volume history
```

NDJSON is deliberate: appends are cheap, an interrupted run leaves valid data, and a diff shows exactly
which blocks arrived. The page reads the store at request time (`export const dynamic = 'force-dynamic'`).

## Deploying

Not deployed from here. On Vercel, the runtime has no way to reach your local store, so pick one:

- **Commit `data/`** (what `.gitignore` is set up for). Simple, and the dashboard is as fresh as the last
  commit. Roughly 2 MB per 13,000 blocks.
- **Ingest in CI** before `next build`, e.g. a GitHub Action that runs `npm run refresh` and commits, or a
  scheduled job that writes the store to a volume or object store and a small change to `app/page.jsx` to
  read from there.

The whole page is a server component reading files plus one client component doing the maths, so there is
no database and no API routes to stand up.

Payload note: the page ships the ingested blocks to the browser in a compact array form
(`[height, time, difficulty, size, txCount, minerIdx, coinbaseTotal]`) so the range selector recomputes every
series client-side without a round trip. That is about 700 KB uncompressed at 13,000 blocks. If the range
grows past a few months, either cap it server-side with a `?from=` parameter or move `derive()` behind an
API route.

## Panels

1. **Security budget** — daily coinbase total (subsidy + fees) × that day's CoinGecko close.
2. **Miner concentration** — stacked block share by entity, plus a sortable entity table. Attribution
   comes from `config/entities.json` and every row shows its `verified | inferred | unknown` flag.
3. **Supply vs schedule** — cumulative coinbase supply against `S·t/(t+H)` evaluated on wall-clock time,
   with two numbered note columns under the chart: what makes realised inflation outrun the published
   curve (a height-indexed curve read as a calendar, plus a WTEMA filter that corrects behind the trend)
   and what would bring it back. Both are mechanism, not forecast, and every number they cite is a
   constant in `config/constants.json`.
4. **Hashprice and a synthetic miner** — PRL per PH/s per day, with a selector for GPU type, GPU count,
   pool, country and power price. Picking a country fills the power field with that country's average
   business tariff, which you can type over; the second line becomes what that rig would have earned each
   day, after the pool's published fee and power. The four figures the controls drive sit on the raised
   surface, so it stays obvious which cells you are moving and which two the chain and the price feed
   decide on their own.

Each section states, in a mono rail beside the prose, a fixed `definition` line spelling out the
arithmetic behind the chart, its source, the block range used and the last ingested block timestamp.
The two-line interpretation block is the prose itself: the first line is what the measurement is, the
second what it implies.

## Design

The visual system comes from an imported Claude Design canvas rather than being reimplemented by eye.
The product is **PRL Stats** throughout; the canvas file it came from carries an older working name:

- Tokens live as CSS custom properties in `app/globals.css` — `--bg / --raise / --line / --hair` for
  surfaces, `--ink / --ink2 / --muted` for the text ramp, `--accent / --pos / --neg` for meaning, and
  `--s1`…`--s7` for the entity series, all in `oklch()` at matched lightness and chroma so no pool reads
  louder than another. `tailwind.config.js` maps every colour to those variables, so the light theme is
  one attribute on `<html>` and nothing re-renders. Opacity modifiers (`text-ink/50`) do not work against
  `var()` colours and the design does not use any: states separate through the ink ramp and hairlines.
- The layout is editorial, not boxed. Sections are separated by a rule and space rather than card chrome,
  figures sit in hairline grids whose 1px gaps show `--line` through, and the page runs on a 1180px
  measure with prose capped at 54–60 characters.
- A dark/light toggle sits in the top bar next to the range selector. Dark is the default in CSS, so a
  cold load never flashes light.

Three things the design predates and the app keeps: the range selector, the synthetic-miner controls in
section 4, and the partial-day dots. Their chrome follows the design's own language.

## The one hand-maintained figure

`config/overhead.json` holds the last publicly reported proof-of-useful-work overhead. It is the only
number on the page that is neither chain data nor a feed, so it is fenced off rather than mixed in:

- It renders in the header rail, not in the KPI strip, beside the other provenance lines.
- It always shows its `asOf` date next to the value, and the label says reported.
- It turns amber once it is older than `staleAfterDays` (7), so a missed weekly check is visible
  rather than silent.
- `percent: null` renders "not recorded". There is no placeholder number and no last-known value
  dressed up as current — the same rule the rest of the page follows.

Weekly update: set `percent`, `asOf` (UTC date), `source` and `url`. Nothing else needs touching.

## What is deliberately not here

- **Issuance as a percent of volume.** The numerator is exact chain data; the denominator is exchange
  reported volume, which on a book this thin carries wash and cross-venue double counting, and the ratio
  also silently assumes issuance equals miner selling, which pool payout behaviour does not support. A
  hard numerator over a soft denominator produces a soft number that looks hard.
- **Cost to attack.** The "half the daily security budget" convention is a rule of thumb with no
  measurement behind it, and for a chain whose hashrate is rentable commodity GPU capacity, the real
  bound is rental market depth, not miner revenue. Security budget is reported as what it is: what the
  chain pays for security per day.
- **Nakamoto coefficient.** The stacked share chart and the entity table show concentration directly. The
  coefficient compresses that into one integer that depends on a threshold choice and on how many pool
  addresses happen to be attributed, so it moves for reasons that are not about the chain.
- **Break-even / hashprice cost line.** It needed GPU rental rate, overhead percentage and a calibration
  between tile throughput and the hashrate scale. Three unobservable inputs deciding where a line sits is
  a forecast wearing a chart's clothes. The synthetic miner replaces it honestly: hardware hashrate and
  pool fee are published figures in `config/gpus.json`, each with a source, and the one number the chain
  cannot know, your power price, is a blank input. Leave it blank and the panel reports revenue only.
  Downtime, cooling, hosting and hardware amortisation are not modelled, so it is revenue minus two named
  costs, not a P&L.

## Typography

`pearlresearch.ai` sets text in **Degular** (OH no Type Co., weights 400/500/600) and figures in
**Source Code Pro**. Source Code Pro is open licensed and loads from Google Fonts in `app/layout.jsx`,
so every number here is already in the site's face. Degular is commercial and is not shipped: buy a
webfont licence and drop `degular-regular.woff2`, `degular-medium.woff2` and `degular-semibold.woff2`
into `public/fonts/`, where the `@font-face` rules in `app/globals.css` already point. Without those
files the stack falls through to Hanken Grotesk, the closest free match on x-height and proportion.
Do not copy the woff2 files the site serves; those are licensed to Pearl, not to you.

### Configuration

| File | What it holds |
| --- | --- |
| `config/explorer.config.json` | base URL, action id, start height, concurrency, CoinGecko id |
| `config/entities.json` | address → entity name, attribution flag, and the evidence for it |
| `config/events.json` | consensus changes drawn as vertical reference lines |
| `config/constants.json` | protocol constants (S, H, 194s, genesis, hashrate convention) with sources |
| `config/gpus.json` | GPU hashrate and TDP benchmarks, and pool fees, each row with its source |
| `config/electricity.json` | average business electricity price by country, one dataset, one date, one segment |

`constants.json` is not a settings file. Each entry is a published protocol fact or a stated definition,
and each group carries a `source` string; `npm run selftest` fails if a group loses its source or if a
constant drifts from the whitepaper values. Nothing in the UI edits any of it.

## Numbers that need care

- **Implied hashrate** is `D · 2^48 / T` with `T` the observed average block time for the day. It matches
  what HeroMiners and AlphaPool quote to within a few percent. It is an upper bound on honest compute: a
  valid tile can be cheap if the inputs have exploitable structure, which is the footnote carried on every
  hashrate-derived chart.
- **Difficulty** is node-scale everywhere in this app. Pool dashboards multiply by 65,536.
- **Hashprice** is issuance divided by implied hashrate, so it inherits the hashrate caveat above. No cost
  line is drawn, because marginal cost is a property of the operator, not of the chain.
- **Supply baseline**: actual supply is seeded with the formula value at block 99,000 because ingestion
  starts there, then accumulates observed coinbase subsidies. Fees are excluded from that line; across a
  month they came to roughly 120 PRL against 30 million issued.
- **Partial days** at both edges of the ingested range are flagged in `derive()` and excluded from the
  "latest full day" cards.

## Layout

```
app/page.jsx             server component: reads the store, packs blocks for the client
components/Dashboard.jsx client: hero, KPI strip, range selector, theme toggle, wiring
components/ui.jsx        layout primitives: Section, Stat, Kpi, Eyebrow, table, flags
components/panels/       one file per panel
lib/derive.js            every derived series, pure, no I/O
lib/emission.js          E(t) and S·t/(t+H)
lib/explorer.mjs         scraper, including the stale action id error
lib/store.mjs            NDJSON store and checkpoint
scripts/                 ingest, market, selftest
```

`lib/derive.js` is the single place where a metric is defined. If a number on the page looks wrong, it is
either there or in the chain data feeding it. Adding a metric means adding it there, and the bar is the
integrity rule at the top: chain, price feed, or a sourced constant.
