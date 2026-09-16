'use client'

import { useEffect, useMemo, useState } from 'react'
import { derive } from '@/lib/derive'
import { Kpi, KpiRow, Eyebrow } from '@/components/ui'
import SecurityBudget from '@/components/panels/SecurityBudget'
import MinerConcentration from '@/components/panels/MinerConcentration'
import SupplyVsSchedule from '@/components/panels/SupplyVsSchedule'
import Hashprice, { HASHRATE_FOOTNOTE } from '@/components/panels/Hashprice'
import { num, usdExact, hashrate, ts } from '@/lib/format'

const RANGES = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: 'all', days: null }
]

const chrome = 'border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-rail'

function MetaRow({ label, value, last, tone, title }) {
  return (
    <div className={`flex justify-between gap-4 ${last ? '' : 'border-b border-hair pb-[7px]'}`} title={title}>
      <span className="font-mono text-[10px] uppercase tracking-rail text-muted">{label}</span>
      <span className={`tnum font-mono text-chip ${tone === 'stale' ? 'text-s4' : tone === 'none' ? 'text-muted' : 'text-ink2'}`}>{value}</span>
    </div>
  )
}

/* The one hand-maintained figure on the page. It is not chain data and not a feed, so it renders
   with its as-of date, is labelled reported, and goes amber once it is older than the interval in
   config/overhead.json rather than sitting there quietly stale. Unset means unset: no placeholder
   number, in keeping with the rest of the page. */
function overheadSlot(overhead) {
  if (!overhead || overhead.percent == null) {
    return { value: 'not recorded', tone: 'none', title: 'Set percent and asOf in config/overhead.json' }
  }
  const asOf = overhead.asOf || null
  const ageDays = asOf ? Math.floor((Date.now() - Date.parse(`${asOf}T00:00:00Z`)) / 86400000) : null
  const stale = ageDays != null && ageDays > (overhead.staleAfterDays ?? 7)
  return {
    value: `${num(overhead.percent, 1)}% · ${asOf || 'undated'}`,
    tone: stale ? 'stale' : undefined,
    title: [overhead.definition, overhead.source && `Reported by ${overhead.source}`, stale && `${ageDays} days old`]
      .filter(Boolean)
      .join(' — ')
  }
}

export default function Dashboard({ packed, miners, market, checkpoint, constants, entities, events, explorer, hardware, electricity, overhead }) {
  const [range, setRange] = useState(null)
  const [theme, setTheme] = useState('dark')

  // Dark is the default in CSS, so a cold load never flashes light and this only ever writes
  // the attribute the light token block keys off.
  useEffect(() => {
    document.documentElement.setAttribute('data-prl-theme', theme)
  }, [theme])

  const allBlocks = useMemo(
    () =>
      packed.map(([height, time, difficulty, size, txCount, minerIdx, coinbaseTotal]) => ({
        height,
        time,
        difficulty,
        size,
        txCount,
        miner: minerIdx >= 0 ? miners[minerIdx] : null,
        coinbaseTotal
      })),
    [packed, miners]
  )

  const blocks = useMemo(() => {
    if (!range) return allBlocks
    const last = allBlocks[allBlocks.length - 1].time
    return allBlocks.filter(b => b.time >= last - range * 86400)
  }, [allBlocks, range])

  const data = useMemo(() => derive({ blocks, market, constants, entities }), [blocks, market, constants, entities])

  const meta = {
    blockRange: `#${num(data.meta.firstHeight)} – #${num(data.meta.lastHeight)}`,
    lastIngested: ts(data.meta.lastTime)
  }

  // Configured consensus heights mapped onto the day they landed in, so lines sit on the shared axis.
  const eventLines = useMemo(
    () =>
      events
        .map(e => {
          const day = data.daily.find(d => d.lastHeight >= e.height)
          return day ? { ...e, date: day.date } : null
        })
        .filter(Boolean),
    [events, data.daily]
  )

  const c = data.current
  const btDelta = c.blockTime != null ? c.blockTime - c.targetBlockSeconds : null

  return (
    <main className="min-h-screen bg-bg pb-[90px]" style={{ paddingInline: 'clamp(20px, 4vw, 56px)' }}>
      <div className="mx-auto max-w-[1180px]">
        <div className="flex items-center justify-between gap-6 pt-[22px]">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-legend uppercase tracking-mark">Pearl</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Research Labs</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex border border-line">
              {RANGES.map(r => (
                <button
                  key={r.label}
                  onClick={() => setRange(r.days)}
                  className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-rail ${
                    range === r.days ? 'bg-raise text-ink' : 'text-muted hover:text-ink2'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
              className={`${chrome} text-ink2 hover:border-ink2 hover:text-ink`}
            >
              {theme === 'dark' ? 'Light' : 'Dark'} mode
            </button>
          </div>
        </div>

        <div
          className="grid items-end"
          style={{
            paddingTop: 'clamp(56px, 9vw, 110px)',
            gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)',
            gap: 'clamp(24px, 5vw, 64px)'
          }}
        >
          <div>
            <Eyebrow className="mb-[22px] tracking-[0.18em]">Proof of Useful Work · Chain Metrics</Eyebrow>
            <h1 className="m-0 font-medium leading-[1.02] tracking-[-0.035em]" style={{ fontSize: 'clamp(38px, 5.4vw, 64px)' }}>
              PRL Stats
            </h1>
            <p className="mt-[22px] max-w-[54ch] leading-[1.55] text-ink2" style={{ fontSize: 'clamp(16px, 1.35vw, 18px)' }}>
              Four measurements of the Pearl chain, read out of the blocks themselves. Every figure here is chain data, the CoinGecko close,
              or a protocol constant with a source. None of it is tunable.
            </p>
          </div>
          <div className="grid gap-[7px] pb-1.5">
            <MetaRow label="Blocks ingested" value={num(data.meta.blockCount)} />
            <MetaRow label="Range" value={meta.blockRange} />
            <MetaRow label="Tip" value={meta.lastIngested} />
            <MetaRow
              label="Price feed"
              value={data.meta.marketFetchedAt ? `${data.meta.marketFetchedAt.slice(0, 16)}Z` : 'missing'}
            />
            <MetaRow label={overhead?.label || 'PoUW overhead'} {...overheadSlot(overhead)} last />
          </div>
        </div>

        <div style={{ marginTop: 'clamp(40px, 6vw, 72px)' }}>
          <KpiRow>
            <Kpi label="Last block" value={`#${num(c.height)}`} sub={ts(c.time)} />
            <Kpi
              label="Block time"
              value={c.blockTime ? `${num(c.blockTime)}s` : '—'}
              tone={btDelta != null && Math.abs(btDelta) > 30 ? 'neg' : undefined}
              sub={
                btDelta == null
                  ? `target ${num(c.targetBlockSeconds)}s`
                  : `${btDelta >= 0 ? '+' : ''}${num(btDelta)}s against a ${num(c.targetBlockSeconds)}s target`
              }
            />
            <Kpi
              label="Difficulty"
              value={`${num(c.difficulty / 1e6, 2)}M`}
              sub={`node-scale · pools ×${num(constants.hashrate.poolDifficultyMultiplier)}`}
            />
            <Kpi label="Implied hashrate" value={hashrate(c.hashrateEHs)} sub={`Upper bound, D·2^${constants.hashrate.difficultyToWorkExponent}/T`} />
            <Kpi label="PRL price" value={usdExact(c.price, 3)} sub={c.priceDate ? `CoinGecko close, ${c.priceDate}` : 'CoinGecko'} />
          </KpiRow>
        </div>
        <p className="mt-3 text-note text-muted">{HASHRATE_FOOTNOTE}</p>

        {!data.ok ? (
          <div className="mt-10 border border-dashed border-line p-6 text-center text-note text-muted">
            No blocks in the selected range. Widen the range, or ingest more history.
          </div>
        ) : (
          <>
            <SecurityBudget data={data} events={eventLines} meta={meta} />
            <MinerConcentration data={data} events={eventLines} meta={meta} />
            <SupplyVsSchedule data={data} events={eventLines} meta={meta} constants={constants} />
            <Hashprice data={data} events={eventLines} meta={meta} constants={constants} hardware={hardware} electricity={electricity} />
          </>
        )}

        <footer
          className="grid gap-x-12 gap-y-6 border-t border-line pt-[26px]"
          style={{ marginTop: 'clamp(56px, 8vw, 96px)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
        >
          <p className="m-0 text-note text-muted">
            Chain data scraped from {explorer?.baseUrl} from block #{num(explorer?.startHeight)} forward. Everything before that height
            belongs to a different consensus regime and is deliberately not ingested. Explorer action id captured{' '}
            {explorer?.actionIdCapturedAt}.
          </p>
          <p className="m-0 text-note text-muted">
            Price from CoinGecko daily close. Protocol constants live in config/constants.json, each with its source. Nothing on this page is
            tunable.
            {data.meta.minersMissing ? ` ${num(data.meta.minersMissing)} blocks carry no coinbase attribution.` : ''}
            {checkpoint?.status ? ` Ingest ${checkpoint.status}.` : ''}
          </p>
          <p className="m-0 font-mono text-rail leading-[1.7] text-muted">
            Consensus reference line
            {events.length === 1 ? '' : 's'}
            <br />
            {events.length ? (
              events.map(e => (
                <span key={e.height} className="block text-ink2">
                  #{num(e.height)} {e.label}
                </span>
              ))
            ) : (
              <span className="block text-ink2">none configured</span>
            )}
          </p>
        </footer>
      </div>
    </main>
  )
}
