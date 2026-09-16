'use client'

import { useMemo, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import { Section, Stat, StatRow, Eyebrow, Footnote } from '@/components/ui'
import { ACCENT, POS, NEG, HAIR, AXIS, CHART_HEIGHT, TipBox, EventLines, Legend, splitPartial, xAxisProps, yAxisProps } from '@/components/charts'
import { rigDay, powerCostPerDay } from '@/lib/derive'
import { num, usdExact, pct } from '@/lib/format'

export const HASHRATE_FOOTNOTE =
  'Implied hashrate is an upper bound on honest compute. A valid tile can be cheap to produce if its inputs have exploitable structure.'

const field = 'border border-line bg-bg px-2 py-1.5 font-mono text-chip text-ink outline-none focus:border-accent'

export default function Hashprice({ data, events, meta, constants, hardware, electricity }) {
  const gpus = hardware?.gpus || []
  const pools = hardware?.pools || []
  const [gpuId, setGpuId] = useState(gpus[0]?.id)
  const [count, setCount] = useState(1)
  const [poolId, setPoolId] = useState(pools[0]?.id)
  const [kwh, setKwh] = useState('')
  const [country, setCountry] = useState('')
  const countries = Object.keys(electricity?.prices || {})

  const gpu = gpus.find(g => g.id === gpuId) || gpus[0]
  const pool = pools.find(p => p.id === poolId) || pools[0]
  const n = Math.max(0, Number(count) || 0)
  const rigPHs = gpu ? gpu.hashratePHs * n : 0
  const usdPerKwh = kwh === '' ? null : Math.max(0, Number(kwh) || 0)
  const powerUsd = gpu && usdPerKwh != null ? powerCostPerDay({ watts: gpu.watts, count: n, usdPerKwh }) : 0

  const rows = useMemo(() => {
    const withRig = data.daily.map(d => {
      const r = rigDay(d, { rigPHs, poolFeePct: pool?.feePct ?? 0, powerUsdPerDay: powerUsd })
      return { ...d, rigPrl: r.prl, rigGross: r.gross, rigNet: r.net, rigShare: r.share }
    })
    return splitPartial(withRig, ['hashpricePrl', 'rigGross', 'rigNet'])
  }, [data.daily, rigPHs, pool?.feePct, powerUsd])

  const c = data.current
  const expo = constants.hashrate.difficultyToWorkExponent
  const lastFull = [...rows].reverse().find(d => !d.partial) || rows[rows.length - 1]
  const anyNegative = rows.some(d => d.rigNet != null && d.rigNet < 0)
  const netLabel = usdPerKwh != null ? 'net of pool fee and power' : 'net of pool fee, power excluded'

  return (
    <Section
      id="hashprice"
      ordinal="04"
      title="Hashprice and a synthetic miner"
      whatItIs="What one PH/s of mining capacity earns per day, and what a rig of a given size would have taken out of each day's issuance."
      whatItImplies="Earnings per unit of compute fall as compute joins and rise with price. Pick your hardware to see what that rig would have earned day by day; give it a power price and the line becomes what you would have kept."
      definition={
        <>
          hashprice = daily coinbase PRL ÷ (D·2^{expo}/T ÷ 1e15), T = observed average block time
          <br />
          rig share = rig PH/s ÷ that day&apos;s implied network PH/s
          <br />
          rig = share × coinbase PRL × (1 − fee) × close − watts × count × 24h × $/kWh
        </>
      }
      source="chain · market · hardware benchmarks"
      blockRange={meta.blockRange}
      lastIngested={meta.lastIngested}
    >
      <div className="mt-[30px] flex flex-wrap items-end gap-3 border border-line bg-raise px-3 py-2.5">
        <label className="flex flex-col gap-1.5">
          <Eyebrow>GPU</Eyebrow>
          <select value={gpuId} onChange={e => setGpuId(e.target.value)} className={`${field} w-[230px]`}>
            {gpus.map(g => (
              <option key={g.id} value={g.id}>
                {g.label} · {num(g.hashratePHs * 1000)} TH/s · {num(g.watts)}W
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>GPUs</Eyebrow>
          <input type="number" min="0" step="1" value={count} onChange={e => setCount(e.target.value)} className={`${field} tnum w-[90px]`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Pool</Eyebrow>
          <select value={poolId} onChange={e => setPoolId(e.target.value)} className={`${field} w-[230px]`}>
            {pools.map(p => (
              <option key={p.id} value={p.id}>
                {p.label} · {num(p.feePct)}%
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Country</Eyebrow>
          <select
            value={country}
            onChange={e => {
              setCountry(e.target.value)
              setKwh(e.target.value ? String(electricity.prices[e.target.value]) : '')
            }}
            className={`${field} w-[190px]`}
          >
            <option value="">No country</option>
            {countries.map(name => (
              <option key={name} value={name}>
                {name} · {usdExact(electricity.prices[name], 3)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Power price, $/kWh</Eyebrow>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="blank = excluded"
            value={kwh}
            onChange={e => {
              setKwh(e.target.value)
              setCountry('')
            }}
            className={`${field} tnum w-[140px] placeholder:text-muted`}
          />
        </label>
        <div className="max-w-[420px] text-legend leading-[1.45] text-muted">
          {gpu ? (
            <>
              <span className="text-ink2">{gpu.label}</span>: {gpu.source}
              {gpu.stale ? <span className="ml-2 text-s4">pre-fork benchmark, indicative only</span> : null}
              <div className="mt-0.5">
                <span className="text-ink2">{pool?.label}</span>: {pool?.source}
              </div>
              {country ? (
                <div className="mt-0.5">
                  <span className="text-ink2">{country}</span>: {electricity.segment}, {electricity.asOf}, {electricity.source}. National
                  average; a hosted rack or an industrial tariff can be well below it, so type over it if you know your own rate.
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-[26px]">
        <div className="mb-2 flex items-center gap-2 text-legend text-muted">
          <i className="block h-2.5 w-2.5 border border-line bg-raise" />
          lifted cells move with the controls above; the first two are chain and market only
        </div>
        <StatRow>
          <Stat label="Hashprice" value={`${num(c.hashpricePrl, 1)} PRL`} sub="per PH/s per day" />
          <Stat label="In dollars" value={usdExact(c.hashpriceUsd, 2)} sub="per PH/s per day" />
          <Stat
            live
            label="Rig hashrate"
            value={rigPHs >= 1 ? `${num(rigPHs, 2)} PH/s` : `${num(rigPHs * 1000)} TH/s`}
            sub={`${num(n)} × ${gpu?.label || '—'}`}
          />
          <Stat
            live
            label="Network share"
            value={lastFull?.rigShare != null ? pct(lastFull.rigShare * 100, 4) : '—'}
            sub={`of ${num(c.hashrateEHs, 2)} EH/s implied`}
          />
          <Stat live label="Rig earnings" value={`${num(lastFull?.rigPrl, 2)} PRL`} sub={`per day after ${num(pool?.feePct ?? 0)}% fee`} />
          <Stat
            live
            label={usdPerKwh != null ? 'Net USD / day' : 'Gross USD / day'}
            value={usdExact(usdPerKwh != null ? lastFull?.rigNet : lastFull?.rigGross, 2)}
            tone={usdPerKwh != null && lastFull?.rigNet < 0 ? 'neg' : undefined}
            sub={
              usdPerKwh != null
                ? `power ${usdExact(powerUsd, 2)}/day at ${usdExact(usdPerKwh, 3)}/kWh${country ? ` · ${country}` : ' · your rate'}`
                : 'enter a rate for net'
            }
          />
        </StatRow>
      </div>

      <Legend
        items={[
          ['PRL per PH/s per day', ACCENT],
          [`Synthetic miner, USD per day, ${netLabel} (right axis)`, POS],
          ['Partial day, not joined', ACCENT, 'dot'],
          ...(anyNegative ? [['Zero', NEG, 'dashed']] : [])
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={rows} margin={{ top: 14, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={HAIR} vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} yAxisId="prl" tickFormatter={v => num(v)} />
          <YAxis {...yAxisProps} yAxisId="usd" orientation="right" width={62} tickFormatter={v => usdExact(v, 0)} />
          <Tooltip
            cursor={{ stroke: AXIS }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <TipBox
                  title={`${label}${p.partial ? ' · partial day' : ''}`}
                  rows={[
                    ['PRL / PH/s / day', num(p.hashpricePrl, 1), ACCENT],
                    ['rig share', p.rigShare != null ? pct(p.rigShare * 100, 4) : '—'],
                    ['rig PRL / day', num(p.rigPrl, 2)],
                    [usdPerKwh != null ? 'rig net USD / day' : 'rig USD / day', usdExact(usdPerKwh != null ? p.rigNet : p.rigGross, 2), POS],
                    ['implied hashrate', `${num(p.hashrateEHs, 2)} EH/s`],
                    ['block time', p.blockTime ? `${num(p.blockTime)} s` : '—']
                  ]}
                />
              )
            }}
          />
          {EventLines({ events })}
          {usdPerKwh != null && anyNegative ? <ReferenceLine yAxisId="usd" y={0} stroke={NEG} strokeDasharray="4 4" /> : null}
          <Line
            yAxisId="prl"
            type="monotone"
            dataKey="hashpricePrl__full"
            stroke={ACCENT}
            strokeWidth={1.75}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="prl"
            type="monotone"
            dataKey="hashpricePrl__dot"
            stroke="none"
            dot={{ r: 3, fill: ACCENT, stroke: 'none' }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            yAxisId="usd"
            type="monotone"
            dataKey={`${usdPerKwh != null ? 'rigNet' : 'rigGross'}__full`}
            stroke={POS}
            strokeWidth={1.4}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="usd"
            type="monotone"
            dataKey={`${usdPerKwh != null ? 'rigNet' : 'rigGross'}__dot`}
            stroke="none"
            dot={{ r: 3, fill: POS, stroke: 'none' }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <Footnote>
        {HASHRATE_FOOTNOTE} GPU hashrates and pool fees come from config/gpus.json, each row carrying its source; the power price is either a
        national business average from config/electricity.json ({electricity?.asOf}, {electricity?.source}) or whatever you type over it.
        Downtime, cooling, hosting and hardware cost are not modelled, so this is revenue minus two named costs, not a full P&amp;L. The first
        and last day of the range are partial and are drawn as unjoined dots.
      </Footnote>
    </Section>
  )
}
