'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Section, Stat, StatRow, Kpi, KpiRow, Eyebrow, SortableTable, Footnote } from '@/components/ui'
import { COLORS, HAIR, AXIS, TICK, CHART_HEIGHT, TipBox, Legend, yAxisProps } from '@/components/charts'
import { num, pct, prl, millions, usdExact, ts } from '@/lib/format'

/* Miner behaviour. Every number is the output of the fate walk in lib/prlIndexer.js (live, via
   /api/miner-behavior) or the same walk run over the full chain dump (data/miner_behavior.json).
   Labels are prlscan's; there are no thresholds and no time cutoffs. The size-bucket sections
   come from the full-chain pass only: they need the whole graph and are refreshed by re-running
   scripts/analyze-browser.js, not by the cron. */

const HELD = 'var(--s1)'
const SAFETRADE = 'var(--s2)'
const OTC = 'var(--s3)'
const BRIDGE = 'var(--s4)'
const OTHER = 'var(--s7)'
const MOVED = 'var(--s6)'
const PRICE = 'var(--ink)'

const FATE = [
  ['unspent', 'Held', HELD],
  ['safetrade', 'SafeTrade', SAFETRADE],
  ['otc', 'Pearl OTC', OTC],
  ['bridge', 'Bridged', BRIDGE],
  ['other', 'Other', OTHER]
]
const DOM = [
  ['unspent', 'Held', HELD],
  ['safetrade', 'SafeTrade', SAFETRADE],
  ['otc', 'Pearl OTC', OTC],
  ['bridge', 'Bridged', BRIDGE],
  ['other', 'Other', OTHER]
]

const chrome = 'border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-rail'
const wk = ts => new Date(ts * 1000).toISOString().slice(5, 10)
const m = v => millions(v, 2)
const share = v => pct(v * 100, 1)
const usd2 = v => (v == null ? '—' : `$${num(v, 2)}`)

function groupFate(f) {
  const g = { unspent: f.unspent || 0, safetrade: f.safetrade || 0, otc: (f.otc || 0) + (f.pearl_trade || 0), bridge: f.bridge || 0 }
  g.other = (f.pool || 0) + (f.system || 0) + (f.hub || 0) + (f.fee_dust || 0) + (f.other || 0)
  return g
}

function Seg({ options, value, onChange }) {
  return (
    <div className="flex border border-line">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-rail ${value === v ? 'bg-raise text-ink' : 'text-muted hover:text-ink2'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function PriceToggle({ on, set }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-rail text-muted">
      <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} className="m-0" style={{ accentColor: 'var(--ink)' }} />
      $PRL Price
    </label>
  )
}

const priceAxis = (
  <YAxis yAxisId="p" orientation="right" tick={TICK} tickLine={false} axisLine={false} width={56} domain={[0, 'auto']} tickFormatter={v => `$${num(v, 2)}`} />
)
const priceLine = <Line yAxisId="p" type="monotone" dataKey="price" stroke={PRICE} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2, fill: PRICE, stroke: "none" }} isAnimationActive={false} connectNulls />
const weekAxis = <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={{ stroke: AXIS }} minTickGap={28} tickMargin={10} />

export default function MinersDashboard({ data, live }) {
  const [theme, setTheme] = useState('dark')
  const [units, setUnits] = useState('share')
  const [view, setView] = useState('reward')
  const [px, setPx] = useState({ e: true, b: true, w: true, r: true, s: true })
  const setP = k => v => setPx(p => ({ ...p, [k]: v }))

  useEffect(() => {
    document.documentElement.setAttribute('data-prl-theme', theme)
  }, [theme])

  const t = data.totals
  const gt = groupFate(t.fate)
  const recv = t.recv
  const sold = gt.safetrade + gt.otc

  const bucketRows = useMemo(
    () =>
      data.by_bucket.map(b => {
        const g = groupFate(b.fate)
        const tot = Object.values(g).reduce((a, v) => a + v, 0)
        const row = { name: b.bucket, miners: b.miners, recv: b.recv }
        for (const [k] of FATE) row[k] = units === 'share' ? (tot ? g[k] / tot : 0) : g[k]
        return row
      }),
    [data, units]
  )
  const domRows = data.by_bucket.map(b => ({ name: b.bucket, miners: b.miners, ...b.dominant }))

  const rewardRows = useMemo(
    () =>
      data.by_issue_week
        .filter(w => w.week > 0)
        .map(w => {
          const tot = w.held + w.safetrade + w.otc + w.bridge + w.other
          const f = v => (units === 'share' ? (tot ? v / tot : 0) : v)
          return { name: wk(w.week_start), emitted: w.emitted, paid: w.paid_to_miners, unspent: f(w.held), safetrade: f(w.safetrade), otc: f(w.otc), bridge: f(w.bridge), other: f(w.other), price: w.price_close_usd }
        }),
    [data, units]
  )
  const sellRows = data.selling_weekly.filter(w => w.week > 0).map(w => ({ name: wk(w.week_start), safetrade: w.safetrade, otc: w.otc, bridge: w.bridge, moved: w.moved_unsold, price: w.price_close_usd }))
  const balRows = data.miner_balance_weekly.map(r => ({ name: wk(r.week_start), balance: r.balance, wow: r.wow, sold: r.sold, ratio: r.sold_to_balance, price: r.price_close_usd }))
  const wprlRows = data.wprl_supply_daily.map(d => ({ name: d.date.slice(5), supply: d.supply, minted: d.minted, burned: d.burned, price: d.price_usd }))
  const bfIn = data.bridge_flow_prl_side.reduce((a, b) => a + b.in, 0)
  const bfOut = data.bridge_flow_prl_side.reduce((a, b) => a + b.out, 0)

  const meta = { blockRange: `#1 – #${num(data.tip_height)}`, lastIngested: ts(data.tip_time) }
  const vfmt = units === 'share' ? v => `${num(v * 100)}%` : v => millions(v, 0)
  const vtip = units === 'share' ? share : m
  const lw = data.launch_week

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
              <Link href="/" className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-rail text-muted hover:text-ink2">
                Chain
              </Link>
              <span className="bg-raise px-3 py-1.5 font-mono text-[10px] uppercase tracking-rail text-ink">Miners</span>
            </div>
            <button onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))} className={`${chrome} text-ink2 hover:border-ink2 hover:text-ink`}>
              {theme === 'dark' ? 'Light' : 'Dark'} mode
            </button>
          </div>
        </div>

        <div className="grid items-end" style={{ paddingTop: 'clamp(48px, 7vw, 84px)', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)', gap: 'clamp(24px, 5vw, 64px)' }}>
          <div>
            <Eyebrow className="mb-[22px] tracking-[0.18em]">Proof of Useful Work · Miner behaviour</Eyebrow>
            <h1 className="m-0 font-medium leading-[1.02] tracking-[-0.035em]" style={{ fontSize: 'clamp(38px, 5.4vw, 64px)' }}>
              PRL Miners
            </h1>
            <p className="mt-[22px] max-w-[54ch] leading-[1.55] text-ink2" style={{ fontSize: 'clamp(16px, 1.35vw, 18px)' }}>
              Where mined PRL is today: held, sold on SafeTrade or Pearl OTC, or bridged to WPRL. Every payout followed through the UTXO graph; chain data and
              prlscan labels only.
            </p>
          </div>
          <div className="grid gap-[7px] pb-1.5">
            <MetaRow label="Snapshot" value={`#${num(data.tip_height)} · ${ts(data.tip_time)}`} />
            <MetaRow label="Transactions" value={num(data.n_tx)} />
            <MetaRow label="Series" value={live ? `live · indexed to #${num(live.height)}` : 'snapshot'} />
            <MetaRow label="Price feed" value="prlscan daily · OTC VWAP → SafeTrade → CMC" last />
          </div>
        </div>

        <div style={{ marginTop: 'clamp(40px, 6vw, 72px)' }}>
          <KpiRow>
            <Kpi label="Miner addresses" value={num(t.miners)} sub="pool payouts + solo coinbase" />
            <Kpi label="Mined" value={`${millions(recv, 2)} PRL`} sub={`${share(recv / data.supply_at_tip)} of issuance`} />
            <Kpi label="Held" value={share(gt.unspent / recv)} sub={`${millions(gt.unspent, 2)} PRL unspent`} />
            <Kpi label="Sold or bridged" value={share((sold + gt.bridge) / recv)} sub={`SafeTrade ${share(gt.safetrade / recv)} · OTC ${share(gt.otc / recv)} · bridged ${share(gt.bridge / recv)}`} />
          </KpiRow>
        </div>

        {/* 01 */}
        <Section
          id="destination-by-size"
          ordinal="01"
          title="Where mined PRL went"
          whatItIs="Share of each size class's lifetime PRL by destination today, and each address counted once under its main destination."
          whatItImplies="Big miners hold. Selling is a small-miner behaviour by count and an OTC behaviour by value."
          definition="miner size = lifetime PRL received from pools or coinbase. Held = unspent anywhere on chain."
          source="chain · prlscan labels"
          blockRange={meta.blockRange}
          lastIngested={meta.lastIngested}
        >
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Seg options={[['share', '% of payouts'], ['prl', 'PRL']]} value={units} onChange={setUnits} />
          </div>
          <div className="grid gap-x-12 gap-y-9" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))' }}>
            <div>
              <Eyebrow className="mt-6">By value</Eyebrow>
              <Legend items={FATE.map(([, l, c]) => [l, c])} />
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={bucketRows} layout="vertical" margin={{ top: 4, right: 18, bottom: 0, left: 0 }} barCategoryGap={6}>
                  <CartesianGrid stroke={HAIR} horizontal={false} />
                  <XAxis type="number" tick={TICK} tickLine={false} axisLine={{ stroke: AXIS }} domain={units === 'share' ? [0, 1] : [0, 'auto']} tickFormatter={vfmt} />
                  <YAxis type="category" dataKey="name" tick={TICK} tickLine={false} axisLine={false} width={64} />
                  <Tooltip cursor={{ fill: 'var(--hair)' }} content={({ active, payload, label }) => (active && payload?.length ? <TipBox title={`${label} · ${num(payload[0].payload.miners)} miners · ${m(payload[0].payload.recv)} PRL`} rows={payload.map(p => [p.name, vtip(p.value), p.color])} /> : null)} />
                  {FATE.map(([k, l, c]) => (
                    <Bar key={k} dataKey={k} name={l} stackId="f" fill={c} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <Eyebrow className="mt-6">By address count, main destination</Eyebrow>
              <Legend items={DOM.map(([, l, c]) => [l, c])} />
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={domRows} margin={{ top: 4, right: 18, bottom: 0, left: 0 }} barCategoryGap={8}>
                  <CartesianGrid stroke={HAIR} vertical={false} />
                  <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={{ stroke: AXIS }} />
                  <YAxis {...yAxisProps} tickFormatter={v => num(v)} />
                  <Tooltip cursor={{ fill: 'var(--hair)' }} content={({ active, payload, label }) => (active && payload?.length ? <TipBox title={`${label} · ${num(payload[0].payload.miners)} miners`} rows={payload.map(p => [p.name, num(p.value), p.color])} /> : null)} />
                  {DOM.map(([k, l, c]) => (
                    <Bar key={k} dataKey={k} name={l} stackId="d" fill={c} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="mt-6">
            <SortableTable
              columns={[
                { key: 'bucket', label: 'Bucket', align: 'left' },
                { key: 'miners', label: 'Miners', align: 'right', render: r => num(r.miners) },
                { key: 'recv', label: 'PRL received', align: 'right', render: r => m(r.recv) },
                { key: 'held_all', label: 'Held all', align: 'right', render: r => num(r.status.held_all), sortValue: r => r.status.held_all },
                { key: 'partial', label: 'Partial', align: 'right', render: r => num(r.status.partial), sortValue: r => r.status.partial },
                { key: 'spent_all', label: 'Spent all', align: 'right', render: r => num(r.status.spent_all), sortValue: r => r.status.spent_all },
                ...DOM.map(([k, l]) => ({ key: 'dom_' + k, label: 'Main: ' + l, align: 'right', render: r => num(r.dominant[k]), sortValue: r => r.dominant[k] }))
              ]}
              rows={data.by_bucket.map(b => ({ ...b, key: b.bucket }))}
              initialSort="recv"
            />
          </div>
        </Section>

        {/* 02 */}
        <Section
          id="weekly"
          ordinal="02"
          title={view === 'reward' ? 'Weekly rewards: held, sold, bridged' : 'Miner selling by week'}
          whatItIs={
            view === 'reward'
              ? 'Where each week’s mining rewards are today. Sold = SafeTrade + Pearl OTC. Recent weeks are still ageing.'
              : 'PRL miners moved off their addresses each week, by where it ended up. Sold = SafeTrade + Pearl OTC.'
          }
          whatItImplies="Two selling windows: OTC-led in May, SafeTrade-led after the June listing, then a July to August lull at $0.26 to $0.40. Selling returned with the September move."
          definition="by reward week: fate today of PRL paid in week w. By week sold: PRL leaving miner addresses in week w, by eventual destination. Launch week excluded, see note."
          source="chain · prlscan labels · price"
          blockRange={meta.blockRange}
          lastIngested={meta.lastIngested}
        >
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Seg options={[['reward', 'By reward week'], ['sold', 'By week sold']]} value={view} onChange={setView} />
            <PriceToggle on={px.e} set={setP('e')} />
          </div>
          <Legend
            items={[
              ...(view === 'reward' ? FATE.map(([, l, c]) => [l, c]) : [['SafeTrade', SAFETRADE], ['Pearl OTC', OTC], ['Bridged', BRIDGE], ['Moved, not sold', MOVED]]),
              ...(px.e ? [['Price, USD', PRICE, 'dashed']] : [])
            ]}
          />
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart data={view === 'reward' ? rewardRows : sellRows} margin={{ top: 14, right: 18, bottom: 0, left: 0 }} barCategoryGap={3}>
              <CartesianGrid stroke={HAIR} vertical={false} />
              {weekAxis}
              <YAxis yAxisId="v" {...yAxisProps} domain={view === 'reward' && units === 'share' ? [0, 1] : [0, 'auto']} tickFormatter={view === 'reward' ? vfmt : v => millions(v, 0)} />
              {px.e ? priceAxis : null}
              <Tooltip
                cursor={{ fill: 'var(--hair)' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  const f = view === 'reward' ? vtip : m
                  return (
                    <TipBox
                      title={view === 'reward' ? `${label} · emitted ${m(p.emitted)} · paid ${m(p.paid)}` : label}
                      rows={[...payload.filter(x => x.dataKey !== 'price').map(x => [x.name, f(x.value), x.color]), ...(p.price != null ? [['close', usdExact(p.price, 3)]] : [])]}
                    />
                  )
                }}
              />
              {view === 'reward' ? (
                FATE.map(([k, l, c]) => <Bar key={k} yAxisId="v" dataKey={k} name={l} stackId="w" fill={c} isAnimationActive={false} />)
              ) : (
                <>
                  <Bar yAxisId="v" dataKey="safetrade" name="SafeTrade" stackId="w" fill={SAFETRADE} isAnimationActive={false} />
                  <Bar yAxisId="v" dataKey="otc" name="Pearl OTC" stackId="w" fill={OTC} isAnimationActive={false} />
                  <Bar yAxisId="v" dataKey="bridge" name="Bridged" stackId="w" fill={BRIDGE} isAnimationActive={false} />
                  <Bar yAxisId="v" dataKey="moved" name="Moved, not sold" stackId="w" fill={MOVED} fillOpacity={0.45} isAnimationActive={false} />
                </>
              )}
              {px.e ? priceLine : null}
            </ComposedChart>
          </ResponsiveContainer>
          {lw ? (
            <div className="mt-6 border border-line border-l-2 border-l-accent bg-raise px-[15px] py-3 text-note text-ink2">
              <span className="text-ink">Launch week (Apr 27 to May 3):</span> {num(lw.blocks)} blocks, {millions(lw.prl, 1)} PRL, {share(lw.share_of_issuance_at_tip)} of all PRL issued to date. {num(lw.blocks_day1)} blocks on day one at difficulty 1. All solo coinbase, {num(lw.addresses)} addresses, no pools. Widely spread: top address {share(lw.top1_share)}, top 10 {share(lw.top10_share)}, top 100 {share(lw.top100_share)}, {num(lw.addresses_for_50pct)} addresses hold half. {num(lw.addresses_one_block)} addresses won one block; {num(lw.addresses_100plus_blocks)} won 100+. {share(lw.unspent_share)} still unspent. Left off the bars; kept in the table.
            </div>
          ) : null}
          <div className="mt-6">
            <SortableTable
              columns={[
                { key: 'week', label: 'Week', align: 'left', render: r => wk(r.week_start), defaultDir: 'asc' },
                { key: 'emitted', label: 'Emitted', align: 'right', render: r => m(r.emitted) },
                { key: 'paid_to_miners', label: 'Paid to miners', align: 'right', render: r => m(r.paid_to_miners) },
                { key: 'heldPct', label: 'Held', align: 'right', render: r => share(r.heldPct), sortValue: r => r.heldPct },
                { key: 'stPct', label: 'SafeTrade', align: 'right', render: r => share(r.stPct), sortValue: r => r.stPct },
                { key: 'otcPct', label: 'Pearl OTC', align: 'right', render: r => share(r.otcPct), sortValue: r => r.otcPct },
                { key: 'brPct', label: 'Bridged', align: 'right', render: r => share(r.brPct), sortValue: r => r.brPct },
                { key: 'price_close_usd', label: 'Close', align: 'right', render: r => (r.price_close_usd != null ? usdExact(r.price_close_usd, 3) : '—') }
              ]}
              rows={data.by_issue_week.map(w => {
                const tot = w.held + w.safetrade + w.otc + w.bridge + w.other || 1
                return { ...w, key: w.week, heldPct: w.held / tot, stPct: w.safetrade / tot, otcPct: w.otc / tot, brPct: w.bridge / tot }
              })}
              initialSort="week"
              initialDir="asc"
              maxHeight={340}
            />
          </div>
        </Section>

        {/* 03 */}
        <Section
          id="balances"
          ordinal="03"
          title="Miner balances"
          whatItIs="Unspent PRL on all miner addresses at week end, and the week-over-week change."
          whatItImplies="Balances have sat in a 162 to 176M band since late May. Only three weeks show a net drawdown."
          definition={`balance = all unspent PRL on the ${num(t.miners)} miner addresses at week end (UTC Monday)`}
          source="chain"
          blockRange={meta.blockRange}
          lastIngested={meta.lastIngested}
        >
          <div className="grid gap-x-12 gap-y-9" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))' }}>
            <div>
              <div className="mt-7 flex items-center gap-3">
                <PriceToggle on={px.b} set={setP('b')} />
              </div>
              <Legend items={[['Miner balance', HELD], ...(px.b ? [['Price, USD', PRICE, 'dashed']] : [])]} />
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={balRows} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={HAIR} vertical={false} />
                  {weekAxis}
                  <YAxis yAxisId="b" {...yAxisProps} domain={['dataMin - 5000000', 'dataMax + 5000000']} tickFormatter={v => millions(v, 0)} />
                  {px.b ? priceAxis : null}
                  <Tooltip cursor={{ stroke: AXIS }} content={<BalTip />} />
                  <Line yAxisId="b" type="monotone" dataKey="balance" name="Miner balance" stroke={HELD} strokeWidth={1.75} dot={{ r: 2.5, fill: HELD, stroke: 'none' }} isAnimationActive={false} />
                  {px.b ? priceLine : null}
                </ComposedChart>
              </ResponsiveContainer>
              <Footnote>Axis starts near the lowest week-end balance so the moves are visible; the launch-week base is 125M.</Footnote>
            </div>
            <div>
              <div className="mt-7 flex items-center gap-3">
                <PriceToggle on={px.w} set={setP('w')} />
              </div>
              <Legend items={[['WoW change', HELD], ...(px.w ? [['Price, USD', PRICE, 'dashed']] : [])]} />
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={balRows} margin={{ top: 14, right: 18, bottom: 0, left: 0 }} barCategoryGap={3}>
                  <CartesianGrid stroke={HAIR} vertical={false} />
                  {weekAxis}
                  <YAxis yAxisId="w" {...yAxisProps} tickFormatter={v => `${v < 0 ? '-' : ''}${millions(Math.abs(v), 0)}`} />
                  {px.w ? priceAxis : null}
                  <Tooltip cursor={{ fill: 'var(--hair)' }} content={<BalTip />} />
                  <Bar yAxisId="w" dataKey="wow" name="WoW change" fill={HELD} isAnimationActive={false} />
                  {px.w ? priceLine : null}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Section>

        {/* 04 */}
        <Section
          id="sold-to-balance"
          ordinal="04"
          title="Sold ÷ miner balance"
          whatItIs="PRL sold in the week as a share of the miner balance at the start of the week. Sold = SafeTrade + Pearl OTC."
          whatItImplies="Under 5% of holdings a week even at the May peak; 0.1 to 0.4% through July and August; back to 2% in the September move."
          definition="sold(w) ÷ balance(w−1)"
          source="chain · prlscan labels · price"
          blockRange={meta.blockRange}
          lastIngested={meta.lastIngested}
        >
          <div className="mt-7 flex items-center gap-3">
            <PriceToggle on={px.r} set={setP('r')} />
          </div>
          <Legend items={[['Sold ÷ balance', SAFETRADE], ...(px.r ? [['Price, USD', PRICE, 'dashed']] : [])]} />
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart data={balRows} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={HAIR} vertical={false} />
              {weekAxis}
              <YAxis yAxisId="r" {...yAxisProps} tickFormatter={v => `${num(v * 100)}%`} />
              {px.r ? priceAxis : null}
              <Tooltip cursor={{ stroke: AXIS }} content={<BalTip />} />
              <Line yAxisId="r" type="monotone" dataKey="ratio" name="Sold ÷ balance" stroke={SAFETRADE} strokeWidth={1.75} dot={{ r: 2.5, fill: SAFETRADE, stroke: 'none' }} isAnimationActive={false} connectNulls />
              {px.r ? priceLine : null}
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-6">
            <SortableTable
              columns={[
                { key: 'week', label: 'Week', align: 'left', render: r => wk(r.week_start), defaultDir: 'asc' },
                { key: 'balance', label: 'Balance', align: 'right', render: r => m(r.balance) },
                { key: 'wow', label: 'WoW', align: 'right', render: r => (r.wow == null ? '—' : `${r.wow < 0 ? '-' : '+'}${m(Math.abs(r.wow))}`) },
                { key: 'sold', label: 'Sold', align: 'right', render: r => m(r.sold) },
                { key: 'sold_to_balance', label: 'Sold ÷ balance', align: 'right', render: r => (r.sold_to_balance == null ? '—' : share(r.sold_to_balance)) },
                { key: 'price_close_usd', label: 'Close', align: 'right', render: r => (r.price_close_usd != null ? usdExact(r.price_close_usd, 3) : '—') }
              ]}
              rows={data.miner_balance_weekly.map(r => ({ ...r, key: r.week }))}
              initialSort="week"
              initialDir="asc"
              maxHeight={340}
            />
          </div>
        </Section>

        {/* 05 */}
        <Section
          id="wprl"
          ordinal="05"
          title="WPRL supply"
          whatItIs="Circulating WPRL on Ethereum, daily: the bridge’s TVL."
          whatItImplies={`Flat at 0.8 to 1.0M from mid-June to end of August, then doubled to ${millions(data.wprl.total_supply_now, 2)} in September. PRL-side bridge deposits: ${millions(bfIn, 2)} in, ${millions(bfOut, 2)} out.`}
          definition={`cumulative mints minus burns of the WPRL ERC-20 (${data.wprl.contract.slice(0, 6)}…${data.wprl.contract.slice(-4)}), reconciled to totalSupply()`}
          source="Blockscout transfer log"
          blockRange={meta.blockRange}
          lastIngested={meta.lastIngested}
        >
          <div className="mt-7 flex items-center gap-3">
            <PriceToggle on={px.s} set={setP('s')} />
          </div>
          <Legend items={[['WPRL supply', HELD], ...(px.s ? [['Price, USD', PRICE, 'dashed']] : [])]} />
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart data={wprlRows} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={HAIR} vertical={false} />
              <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={{ stroke: AXIS }} minTickGap={32} tickMargin={10} />
              <YAxis yAxisId="s" {...yAxisProps} tickFormatter={v => millions(v, 1)} />
              {px.s ? priceAxis : null}
              <Tooltip
                cursor={{ stroke: AXIS }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return <TipBox title={label} rows={[['supply', num(p.supply), HELD], ['minted', num(p.minted)], ['burned', num(p.burned)], ...(p.price != null ? [['price', usdExact(p.price, 3)]] : [])]} />
                }}
              />
              <Area yAxisId="s" type="monotone" dataKey="supply" name="WPRL supply" stroke={HELD} fill={HELD} fillOpacity={0.12} strokeWidth={1.75} dot={false} isAnimationActive={false} />
              {px.s ? priceLine : null}
            </ComposedChart>
          </ResponsiveContainer>
        </Section>

        <footer className="grid gap-x-12 gap-y-6 border-t border-line pt-[26px]" style={{ marginTop: 'clamp(56px, 8vw, 96px)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <p className="m-0 text-note text-muted">
            <span className="text-ink2">Miner</span>: address paid by a prlscan-labelled pool, or a solo coinbase. Venue-labelled addresses excluded.{' '}
            <span className="text-ink2">Destination</span>: each payout output followed through its spends until it is unspent or reaches a labelled address (SafeTrade hot wallet, Pearl OTC escrow settlement, Pearl Trade, PearlBridge). Value splits pro rata at each hop. No thresholds, no time cutoff.
          </p>
          <p className="m-0 text-note text-muted">
            <span className="text-ink2">Held</span>: unspent anywhere on chain. Coins at unlabelled exchanges (CoinEx, BigONE, Bithumb) count as held.{' '}
            <span className="text-ink2">Price</span>: prlscan daily history, Pearl OTC VWAP to Jun 5, SafeTrade close Jun 6 to Sep 12, CoinMarketCap after.{' '}
            <span className="text-ink2">WPRL</span>: ERC-20 mint/burn log, reconciled to totalSupply().
          </p>
          <p className="m-0 font-mono text-rail leading-[1.7] text-muted">
            Snapshot
            <br />
            <span className="block text-ink2">#{num(data.tip_height)} · {ts(data.tip_time)}</span>
            <span className="block text-ink2">{num(data.n_tx)} transactions · {num(data.n_outputs)} outputs</span>
            {live ? <span className="block text-ink2">live series indexed to #{num(live.height)} · {ts(live.time)}</span> : null}
          </p>
        </footer>
      </div>
    </main>
  )
}

function MetaRow({ label, value, last }) {
  return (
    <div className={`flex justify-between gap-4 ${last ? '' : 'border-b border-hair pb-[7px]'}`}>
      <span className="font-mono text-[10px] uppercase tracking-rail text-muted">{label}</span>
      <span className="tnum font-mono text-chip text-ink2">{value}</span>
    </div>
  )
}

function BalTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <TipBox
      title={label}
      rows={[
        ['balance', millions(r.balance, 2), HELD],
        ['wow', r.wow == null ? '—' : `${r.wow < 0 ? '-' : '+'}${millions(Math.abs(r.wow), 2)}`],
        ['sold', millions(r.sold, 2), SAFETRADE],
        ['sold ÷ balance', r.ratio == null ? '—' : pct(r.ratio * 100, 2)],
        ...(r.price != null ? [['close', usdExact(r.price, 3)]] : [])
      ]}
    />
  )
}
