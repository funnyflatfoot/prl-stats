'use client'

import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Section, Stat, StatRow, Footnote, Notes } from '@/components/ui'
import { ACCENT, NEG, HAIR, AXIS, CHART_HEIGHT, TipBox, EventLines, Legend, xAxisProps, yAxisProps } from '@/components/charts'
import { millions, num, pct } from '@/lib/format'

export default function SupplyVsSchedule({ data, events, meta, constants }) {
  const rows = data.daily
  const c = data.current
  const em = constants.emission

  return (
    <Section
      id="supply-vs-schedule"
      ordinal="03"
      title="Supply vs schedule"
      whatItIs="How much PRL actually exists, against how much the whitepaper emission curve says should exist by now."
      whatItImplies={`A persistent gap means blocks are landing faster than the ${em.targetBlockSeconds}-second target, so real inflation is running ahead of the published schedule and dilution arrives sooner than the tokenomics chart suggests.`}
      definition={
        <>
          actual = S·t/(t+H) at #{num(em.supplyBaselineHeight)} + observed coinbase subsidies since
          <br />
          schedule = S·t/(t+H), t = elapsed ÷ {em.targetBlockSeconds}
          <br />S = {num(em.S)} · H = {num(em.H)}
        </>
      }
      source="chain · whitepaper curve"
      blockRange={meta.blockRange}
      lastIngested={meta.lastIngested}
    >
      <div className="mt-[30px]">
        <StatRow>
          <Stat label="Actual supply" value={`${millions(c.supplyActual, 1)} PRL`} sub={`through #${num(c.height)}`} />
          <Stat label="Schedule says" value={`${millions(c.supplySchedule, 1)} PRL`} sub={`at ${num(em.targetBlockSeconds)}s blocks`} />
          <Stat
            label="Gap"
            value={`${c.supplyGap >= 0 ? '+' : ''}${millions(c.supplyGap, 1)} PRL`}
            tone={c.supplyGap > 0 ? 'neg' : undefined}
            sub="actual minus schedule"
          />
          <Stat
            label="Ahead of curve"
            value={`${c.supplyGapPct >= 0 ? '+' : ''}${pct(c.supplyGapPct)}`}
            tone={c.supplyGapPct > 0 ? 'neg' : undefined}
            sub="against the published curve"
          />
        </StatRow>
      </div>

      <Legend
        items={[
          ['Actual, from coinbase', ACCENT],
          ['Whitepaper schedule', NEG, true]
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={rows} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={HAIR} vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} domain={['dataMin - 5e6', 'dataMax + 5e6']} tickFormatter={v => millions(v, 0)} />
          <Tooltip
            cursor={{ stroke: AXIS }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <TipBox
                  title={`${label} · #${num(p.lastHeight)}`}
                  rows={[
                    ['actual', `${millions(p.supplyActual, 2)} PRL`, ACCENT],
                    ['schedule', `${millions(p.supplySchedule, 2)} PRL`, NEG],
                    ['gap', `${millions(p.supplyActual - p.supplySchedule, 2)} PRL`],
                    ['blocks that day', num(p.blocks)],
                    ['avg block time', p.blockTime ? `${num(p.blockTime)} s` : '—']
                  ]}
                />
              )
            }}
          />
          {EventLines({ events })}
          <Line type="monotone" dataKey="supplyActual" stroke={ACCENT} strokeWidth={1.75} dot={false} isAnimationActive={false} />
          <Line
            type="monotone"
            dataKey="supplySchedule"
            stroke={NEG}
            strokeWidth={1.4}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <Notes
        items={[
          [
            'What makes it accelerate',
            [
              `The emission curve is indexed to block height. The published schedule reads it as a calendar, assuming every block takes ${em.targetBlockSeconds} seconds.`,
              'Hashrate arrives faster than difficulty can follow, so blocks land early and a day fits more of them than the schedule budgets for.',
              'More blocks in a day means more subsidy paid in that day. The overshoot is mechanical, not discretionary.',
              `WTEMA retargets on a ${num(em.retargetFilterBlocks)}-block filter, so it corrects behind a trend rather than inside it.`,
              "A trend that outlasts the filter's memory stays under-difficultied for its whole length, so the shortfall accumulates instead of cancelling.",
              'Each early block also pulls the next, slightly smaller subsidy forward in wall-clock time, so the chain walks down the curve ahead of the calendar.'
            ]
          ],
          [
            'What would bring it under control',
            [
              `Block time back at ${em.targetBlockSeconds} seconds. Nothing else closes it.`,
              'That needs hashrate growth to flatten for long enough that difficulty catches up, or a shorter retarget filter that reacts inside a trend.',
              'Neither repays what has already been issued.',
              'The curve is indexed to height, not time, so closing the gap stops the divergence widening. It does not unwind it.',
              'The level converges only if blocks run slower than target for about as long as they ran faster.',
              'Read the gap as a floor under realised dilution, not an overshoot that mean-reverts.'
            ]
          ]
        ]}
      />

      <Footnote>
        Ingestion starts at #{num(em.supplyBaselineHeight)}, so the actual line is seeded with the whitepaper curve at that height rather
        than summed from genesis. Fees are excluded from it: across the ingested range they run four orders of magnitude below subsidy. The
        two notes above are mechanism, not forecast: they describe how the retarget rule and the height-indexed curve interact, and name no
        number that is not a protocol constant in config/constants.json.
      </Footnote>
    </Section>
  )
}
