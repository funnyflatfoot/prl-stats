'use client'

import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Section, Stat, StatRow, NoData, Footnote } from '@/components/ui'
import { ACCENT, HAIR, AXIS, CHART_HEIGHT, TipBox, EventLines, Legend, splitPartial, xAxisProps, yAxisProps } from '@/components/charts'
import { usd, usdExact, prl, num } from '@/lib/format'

export default function SecurityBudget({ data, events, meta }) {
  const rows = splitPartial(data.daily, ['securityUsd'])
  const hasSeries = rows.some(d => d.securityUsd != null)
  const hasPartial = rows.some(d => d.partial && d.securityUsd != null)
  const c = data.current

  return (
    <Section
      id="security-budget"
      ordinal="01"
      title="Security budget"
      whatItIs="The dollar value of every PRL paid to miners in a day: subsidy plus fees, valued at that day's close."
      whatItImplies="This is the entire economic security of the chain. It moves with token price rather than with how many GPUs are pointed at it, so additional hashrate does not by itself buy a safer network."
      definition="sum of coinbase outputs for the day (subsidy + fees) × CoinGecko daily close"
      source="chain · market"
      blockRange={meta.blockRange}
      lastIngested={meta.lastIngested}
    >
      <div className="mt-[30px]">
        <StatRow>
          <Stat label="Per day" value={usd(c.securityUsd)} sub={c.blockTimeDate} />
          <Stat label="Issuance" value={prl(c.issuancePrl, 0)} sub="coinbase incl. fees" />
          <Stat label="Fees within it" value={prl(c.feesPrl, 2)} sub="the rest is subsidy" />
          <Stat label="Price used" value={usdExact(c.price, 3)} sub={c.priceDate ? `CoinGecko close ${c.priceDate}` : 'no market data'} />
        </StatRow>
      </div>

      <Legend items={[['Security budget, USD per day', ACCENT], ...(hasPartial ? [['Partial day, not joined', ACCENT, 'dot']] : [])]} />

      {!hasSeries ? (
        <NoData what="market price series" />
      ) : (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={rows} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={HAIR} vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} tickFormatter={v => usd(v)} />
            <Tooltip
              cursor={{ stroke: AXIS }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload
                return (
                  <TipBox
                    title={`${label}${p.partial ? ' · partial day' : ''}`}
                    rows={[
                      ['budget', usd(p.securityUsd), ACCENT],
                      ['issuance', prl(p.issuancePrl)],
                      ['fees', prl(p.feesPrl, 2)],
                      ['price', usdExact(p.price, 3)],
                      ['blocks', num(p.blocks)]
                    ]}
                  />
                )
              }}
            />
            {EventLines({ events })}
            <Area
              type="monotone"
              dataKey="securityUsd__full"
              stroke={ACCENT}
              fill={ACCENT}
              fillOpacity={0.1}
              strokeWidth={1.75}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="securityUsd__dot"
              stroke="none"
              dot={{ r: 3, fill: ACCENT, stroke: 'none' }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <Footnote>
        The first and last day of the ingested range hold only part of a day&apos;s blocks, so they are drawn as unjoined dots rather than
        pulled into the line: a part-day total is not comparable with a full day.
      </Footnote>
    </Section>
  )
}
