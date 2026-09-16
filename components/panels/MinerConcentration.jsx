'use client'

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Section, SortableTable, Flag, Stat, StatRow, Eyebrow, Footnote } from '@/components/ui'
import { COLORS, HAIR, AXIS, CHART_HEIGHT, TipBox, EventLines, Legend, xAxisProps, yAxisProps } from '@/components/charts'
import { num, pct, prl, shortAddr, ts } from '@/lib/format'

export default function MinerConcentration({ data, events, meta }) {
  const keys = data.entityKeys
  const rows = data.daily.map(d => ({ date: d.date, blocks: d.blocks, partial: d.partial, ...d.stack }))
  const attributedPct =
    (data.entities.filter(e => e.flag !== 'unknown').reduce((s, e) => s + e.blocks7d, 0) /
      Math.max(1, data.entities.reduce((s, e) => s + e.blocks7d, 0))) *
    100

  const columns = [
    {
      key: 'name',
      label: 'Entity',
      align: 'left',
      render: r => (
        <span className="inline-flex items-center gap-[9px]">
          <i className="block h-[9px] w-[9px]" style={{ background: colorFor(r.name, keys) }} />
          {r.name}
          <Flag flag={r.flag} />
        </span>
      )
    },
    {
      key: 'address',
      label: 'Coinbase address',
      align: 'left',
      render: r => (
        <span className="font-mono text-chip text-ink2" title={r.address || ''}>
          {shortAddr(r.address)}
        </span>
      )
    },
    { key: 'blocks7d', label: 'Blocks 7d', align: 'right', render: r => num(r.blocks7d) },
    { key: 'sharePct', label: 'Share', align: 'right', render: r => pct(r.sharePct) },
    { key: 'prl7d', label: 'PRL 7d', align: 'right', render: r => num(r.prl7d) },
    { key: 'lastHeight', label: 'Last block', align: 'right', render: r => <span className="text-ink2">#{num(r.lastHeight)}</span> },
    { key: 'lastTime', label: 'Last seen', align: 'right', render: r => <span className="text-ink2">{ts(r.lastTime)}</span> }
  ]

  return (
    <Section
      id="miner-concentration"
      ordinal="02"
      title="Miner concentration"
      whatItIs="The share of each day's blocks produced by each mining entity, attributed by the address that received the largest coinbase output."
      whatItImplies="In practice this is what the chain's safety rests on. When a handful of named pools produce most blocks, their behaviour is the binding constraint, not distributed capital. Expect it to tighten after any fork that retires older hardware."
      definition="daily block share per payout address; names from config/entities.json"
      source="chain · curated attribution"
      blockRange={meta.blockRange}
      lastIngested={meta.lastIngested}
    >
      <div className="mt-[30px]">
        <StatRow>
          <Stat label="Largest entity" value={pct(data.current.largestSharePct)} sub={data.current.largestName} />
          <Stat label="Top two combined" value={pct(data.current.topTwoPct)} sub="trailing 7 days" />
          <Stat label="Active entities" value={num(data.current.entityCount)} sub="produced a block in 7d" />
          <Stat label="Attributed" value={pct(attributedPct)} sub="verified or inferred" />
        </StatRow>
      </div>

      <Legend items={keys.map((k, i) => [k, COLORS[i % COLORS.length]])} />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT + 30}>
        <AreaChart data={rows} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={HAIR} vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} domain={[0, 100]} tickFormatter={v => `${v}%`} />
          <Tooltip
            cursor={{ stroke: AXIS }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <TipBox
                  title={`${label} · ${num(p.blocks)} blocks${p.partial ? ' · partial' : ''}`}
                  rows={keys.filter(k => p[k] > 0).map(k => [k, pct(p[k]), colorFor(k, keys)])}
                />
              )
            }}
          />
          {keys.map((k, i) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              stackId="share"
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.62}
              strokeWidth={0.6}
              isAnimationActive={false}
            />
          ))}
          {/* after the areas so the marker sits above the stacked fill rather than under it */}
          {EventLines({ events })}
        </AreaChart>
      </ResponsiveContainer>

      <Eyebrow className="mb-2.5 mt-[34px]">Entities · trailing 7 days of ingested blocks</Eyebrow>
      <SortableTable columns={columns} rows={data.entities.map(e => ({ ...e, key: e.name }))} initialSort="blocks7d" maxHeight={340} />

      <Footnote>
        Attribution is address-level: a pool&apos;s payout address counts as one entity, and the miners behind it are not visible on chain.{' '}
        <span className="text-pos">Verified</span> means the pool&apos;s own published block heights resolve to that coinbase address.{' '}
        <span className="text-s4">Inferred</span> means only its reported block counts matched. Unknown means no attribution.
      </Footnote>
    </Section>
  )
}

function colorFor(name, keys) {
  const i = keys.indexOf(name)
  return i >= 0 ? COLORS[i % COLORS.length] : COLORS[COLORS.length - 1]
}
