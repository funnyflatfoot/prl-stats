'use client'

import { ReferenceLine } from 'recharts'

/* Every colour here is a CSS custom property from app/globals.css, so a chart repaints with the
   theme without React re-rendering it. The series ramp is the design's: one hue family per
   entity, equal lightness and chroma so no pool looks louder than another. */

export const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)']
export const ACCENT = 'var(--accent)'
export const NEG = 'var(--neg)'
export const POS = 'var(--pos)'

export const HAIR = 'var(--hair)'
export const AXIS = 'var(--line)'
export const TICK = { fill: 'var(--muted)', fontSize: 10 }

export const CHART_HEIGHT = 300

export const xAxisProps = {
  dataKey: 'date',
  tick: TICK,
  tickLine: false,
  axisLine: { stroke: AXIS },
  minTickGap: 32,
  tickMargin: 10,
  tickFormatter: d => d.slice(5)
}

export const yAxisProps = {
  tick: TICK,
  tickLine: false,
  axisLine: false,
  width: 64
}

export function TipBox({ title, rows }) {
  return (
    <div className="border border-line bg-raise px-[11px] py-[9px] font-mono text-rail leading-[1.6] text-ink shadow-[0_8px_28px_rgba(0,0,0,.35)]">
      <div className="mb-1.5 font-sans text-[9px] uppercase tracking-[0.1em] text-muted">{title}</div>
      {rows.map(([label, value, color]) => (
        <div key={label} className="flex items-center justify-between gap-[22px]">
          <span className="flex items-center gap-[7px] text-ink2">
            {color ? <i className="inline-block h-2 w-2" style={{ background: color }} /> : null}
            {label}
          </span>
          <span className="tnum">{value}</span>
        </div>
      ))}
    </div>
  )
}

// Consensus changes, drawn on every time-series panel from config/events.json.
// A panel that names its axes has to say which one the line belongs to: recharts looks for the
// default axis id 0 when none is given and throws rather than skipping the line. Hashprice runs
// two axes, the rest run one, where passing nothing keeps the default.
export function EventLines({ events, yAxisId }) {
  return events.map(e => (
    <ReferenceLine
      key={e.height}
      x={e.date}
      yAxisId={yAxisId}
      stroke={AXIS}
      strokeDasharray="3 4"
      label={{ value: `#${e.height}`, position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 10 }}
    />
  ))
}

// Partial days (the first and last day of an ingested range) hold only part of a day's blocks, so a
// rate per day computed on them is not comparable with a full day. Rate series therefore stop at the
// last full day and the partial days are drawn as unjoined dots.
export function splitPartial(rows, keys) {
  return rows.map(r => {
    const out = { ...r }
    for (const k of keys) {
      out[`${k}__full`] = r.partial ? null : r[k]
      out[`${k}__dot`] = r.partial ? r[k] : null
    }
    return out
  })
}

export function Legend({ items }) {
  return (
    <div className="mb-2.5 mt-[26px] flex flex-wrap gap-x-5 gap-y-1.5 text-legend text-ink2">
      {items.map(([label, color, kind]) => (
        <span key={label} className="flex items-center gap-2">
          {kind === true || kind === 'dashed' ? (
            <i className="block h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: color }} />
          ) : kind === 'dot' ? (
            <i className="block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          ) : (
            <i className="block h-2.5 w-2.5" style={{ background: color }} />
          )}
          {label}
        </span>
      ))}
    </div>
  )
}
