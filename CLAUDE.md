# PRL Stats — working notes for Claude Code

A Next.js dashboard over Pearl Network (PRL) chain data. Read this before changing anything.

## The rule that governs the whole repo

Every number rendered is one of three things:

1. chain data, scraped from the explorer into `data/`,
2. the CoinGecko price feed,
3. a constant in `config/` that carries a `source` string.

Nothing else. There are no tunable inputs, no modelled numbers, no defaults that stand in for a
measurement. A metric that needs an assumption to exist gets cut, not parameterised — a number the
reader can move is a number they cannot check. `scripts/selftest.mjs` enforces part of this: it fails
if certain removed identifiers reappear, and if any GPU, pool, electricity or protocol constant is
missing its source.

The single exception is `config/overhead.json`, the last publicly reported PoUW overhead. It is
hand-maintained weekly, so it renders in the header rail rather than the KPI strip, always shows its
`asOf` date, says "reported", and goes amber once stale. `percent: null` renders "not recorded"
rather than a placeholder.

## Where things live

```
app/page.jsx              server component: reads the store, packs blocks for the client
components/Dashboard.jsx  client: hero, KPI strip, range selector, theme toggle, wiring
components/ui.jsx         layout primitives: Section, Stat, Kpi, Eyebrow, Notes, table, flags
components/charts.jsx     palette, axis props, tooltip, event lines, partial-day split
components/panels/        one file per section
lib/derive.js             every derived series, pure, no I/O
lib/emission.js           E(t) and S·t/(t+H)
lib/explorer.mjs          scraper, including the stale action id error
lib/store.mjs             NDJSON store and checkpoint
config/                   constants, entities, events, gpus, electricity, overhead, explorer
scripts/                  ingest, market, selftest
```

`lib/derive.js` is the single place a metric is defined. If a figure looks wrong it is either there or
in the chain data feeding it. Adding a metric means adding it there.

## Commands

```
npm install
npm run ingest     # chain, from #99,000 to tip, resumable, 6 concurrent
npm run market     # CoinGecko price and daily close
npm run refresh    # both
npm run dev
npm run selftest   # dependency-free; run after touching lib/derive.js or config/
npm run build
```

A cold ingest from #99,000 takes roughly fifteen minutes and checkpoints as it goes, so it can be
interrupted and resumed.

## The scraper's one fragile part

The explorer has no public API. Transaction detail comes from a Next.js **server action**, identified
by `actionId` in `config/explorer.config.json`. That id changes on every explorer redeploy. When it
goes stale, ingestion exits with code 2 and prints rotation instructions; block headers already
fetched are persisted first. Rotating it means opening the explorer with devtools, clicking a block,
and copying the `next-action` request header. Never inline the id anywhere else.

## Design

The visual system was imported from a Claude Design canvas. Tokens are CSS custom properties in
`app/globals.css` (`--bg/--raise/--line/--hair`, the `--ink/--ink2/--muted` ramp, `--accent/--pos/--neg`,
`--s1`…`--s7` in oklch). `tailwind.config.js` maps colours to those variables, so the light theme is
one attribute on `<html>`.

Two consequences worth knowing before editing styles:

- Opacity modifiers (`text-ink/50`) do not work against `var()` colours. Separate states with the ink
  ramp and hairlines instead, which is what the design does.
- The layout is editorial, not boxed: sections separated by a rule and space, figures in hairline
  grids whose 1px gaps show `--line` through, 1180px measure, prose capped at 54–60ch. Footnotes run
  the full column.

Fonts: Degular is commercial and not shipped. Drop licensed woff2 files into `public/fonts/` and the
`@font-face` rules pick them up; without them the stack falls through to Hanken Grotesk. Do not copy
the woff2 files pearlresearch.ai serves.

## Conventions

- JavaScript, not TypeScript. JSX, App Router, no `src/` directory.
- Partial days (first and last of the ingested range) are flagged in `derive()` and drawn as unjoined
  dots on rate-per-day series, never pulled into the line.
- Prose on the page is dense and analytical. No marketing copy, no exclamation, no hedging filler.
- Sid deploys himself. Do not deploy, and do not run `vercel`.
