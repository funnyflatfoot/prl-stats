'use client'

import { useMemo, useState } from 'react'
import { ts } from '@/lib/format'

/* Layout primitives for PRL Stats, from the imported Claude Design canvas. The design is
   editorial rather than boxed: sections are separated by a rule and generous space instead of
   card chrome, figures sit in a hairline grid, and each section carries its definition in a
   mono rail to the right of the prose. */

export function Eyebrow({ children, className = '' }) {
  return <div className={`font-mono text-eyebrow uppercase tracking-eyebrow text-muted ${className}`}>{children}</div>
}

// auto-fit grid whose 1px gaps show the --line underneath, so the cells read as one ruled block.
function HairGrid({ min, children }) {
  return (
    <div
      className="grid gap-px border border-line bg-line"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}
    >
      {children}
    </div>
  )
}

export function KpiRow({ children }) {
  return <HairGrid min={178}>{children}</HairGrid>
}

export function Kpi({ label, value, sub, tone }) {
  return (
    <div className="min-w-0 bg-bg px-[18px] pb-[18px] pt-4">
      <Eyebrow className="truncate">{label}</Eyebrow>
      <div
        className="tnum mt-3 truncate font-mono leading-[1.1] tracking-[-0.03em]"
        style={{ fontSize: 'clamp(26px, 2.6vw, 34px)' }}
      >
        {value}
      </div>
      {sub ? <div className={`mt-1.5 truncate text-legend ${tone === 'neg' ? 'text-neg' : 'text-ink2'}`}>{sub}</div> : null}
    </div>
  )
}

export function StatRow({ children }) {
  return <HairGrid min={160}>{children}</HairGrid>
}

// `live` marks a cell whose value moves with the controls above it rather than with the chain
// alone. It gets the raised surface, so at a glance you can tell which figures you are driving
// and which ones the blocks decide.
export function Stat({ label, value, sub, tone, live }) {
  return (
    <div className={`min-w-0 px-4 py-[13px] ${live ? 'bg-raise' : 'bg-bg'}`}>
      <Eyebrow className="truncate">{label}</Eyebrow>
      <div className={`tnum mt-2 truncate font-mono text-[22px] tracking-[-0.02em] ${tone === 'neg' ? 'text-neg' : 'text-ink'}`}>{value}</div>
      {sub ? <div className="mt-[5px] truncate text-legend text-ink2">{sub}</div> : null}
    </div>
  )
}

export function Flag({ flag }) {
  const color = flag === 'verified' ? 'text-pos' : flag === 'inferred' ? 'text-s4' : 'text-muted'
  return <span className={`border border-line px-[5px] py-px font-mono text-[9px] uppercase tracking-[0.12em] ${color}`}>{flag}</span>
}

// Footnotes sit under a full-width chart, so they run the full column rather than stopping at a
// prose measure: a short paragraph ragged against a wide chart reads as a layout mistake.
export function Footnote({ children }) {
  return <p className="mt-3.5 text-note text-muted">{children}</p>
}

// Mechanism under a chart, for the cases where the number needs a cause rather than another
// statistic. One point per line, indexed in mono so the chain of reasoning is followable at a
// glance. Two columns on a wide screen, stacked below it.
export function Notes({ items }) {
  return (
    <div
      className="mt-9 grid gap-x-16 gap-y-8 border-t border-hair pt-7"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
    >
      {items.map(([heading, points]) => (
        <div key={heading}>
          <Eyebrow className="mb-3.5">{heading}</Eyebrow>
          <ol className="m-0 list-none space-y-2.5 p-0">
            {points.map((point, i) => (
              <li key={i} className="flex gap-3.5">
                <span className="tnum shrink-0 pt-0.5 font-mono text-rail text-muted">{String(i + 1).padStart(2, '0')}</span>
                <span className="max-w-[58ch] text-note text-ink2">{point}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

/* A section head: ordinal and title, the two-line interpretation block as prose, and the
   definition rail. The rail also carries provenance, so every figure on the page states where
   it came from without a separate strip. There is no assumptions drawer by design — nothing on
   this dashboard is tunable, because a number a reader can move is a number they cannot check. */
export function Section({ id, ordinal, title, whatItIs, whatItImplies, definition, source, blockRange, lastIngested, children }) {
  return (
    <section id={id} className="border-t border-line pt-[30px]" style={{ marginTop: 'clamp(56px, 8vw, 96px)' }}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr)', gap: 'clamp(24px, 5vw, 64px)' }}>
        <div>
          <div className="flex items-baseline gap-3.5">
            <span className="font-mono text-rail tracking-[0.1em] text-muted">{ordinal}</span>
            <h2 className="m-0 font-medium leading-[1.12] tracking-[-0.028em]" style={{ fontSize: 'clamp(23px, 2.4vw, 29px)' }}>
              {title}
            </h2>
          </div>
          <p className="mt-4 max-w-[56ch] text-lede text-ink">{whatItIs}</p>
          <p className="mt-3 max-w-[60ch] text-body text-ink2">{whatItImplies}</p>
        </div>
        <div className="self-start border-l border-line pl-[18px] font-mono text-rail leading-[1.75] text-muted">
          <Eyebrow className="mb-2 text-ink2">Definition</Eyebrow>
          {definition}
          <div className="mt-[19px]">
            <span className="text-ink2">source</span> {source}
          </div>
          <div>
            <span className="text-ink2">blocks</span> {blockRange}
          </div>
          <div>
            <span className="text-ink2">ingested</span> {lastIngested}
          </div>
        </div>
      </div>
      {children}
    </section>
  )
}

export function NoData({ what }) {
  return (
    <div className="flex h-[220px] items-center justify-center border border-dashed border-line text-note text-muted">
      no {what}. run `npm run market` (market series) or `npm run ingest` (chain series) and reload.
    </div>
  )
}

export function SortableTable({ columns, rows, initialSort, initialDir = 'desc', maxHeight }) {
  const [sort, setSort] = useState(initialSort ?? columns[0].key)
  const [dir, setDir] = useState(initialDir)

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sort) || columns[0]
    const val = r => (col.sortValue ? col.sortValue(r) : r[col.key])
    return [...rows].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      if (x == null) return 1
      if (y == null) return -1
      const cmp = typeof x === 'string' ? x.localeCompare(y) : x - y
      return dir === 'asc' ? cmp : -cmp
    })
  }, [rows, columns, sort, dir])

  return (
    <div className="overflow-auto border border-line" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-note" style={{ minWidth: 720 }}>
        <thead className="sticky top-0 bg-bg">
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                onClick={() => {
                  if (sort === c.key) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
                  else {
                    setSort(c.key)
                    setDir(c.defaultDir ?? 'desc')
                  }
                }}
                className={`cursor-pointer select-none whitespace-nowrap border-b border-line px-3.5 py-[9px] font-mono text-eyebrow font-normal uppercase tracking-rail text-muted hover:text-ink2 ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {c.label}
                <span className="ml-1">{sort === c.key ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.key ?? i}>
              {columns.map(c => (
                <td
                  key={c.key}
                  className={`whitespace-nowrap border-b border-hair px-3.5 py-[9px] ${c.align === 'right' ? 'tnum text-right font-mono' : ''}`}
                >
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LastIngested({ checkpoint, lastTime }) {
  return (
    <span className="tnum">
      {ts(lastTime)}
      {checkpoint?.status && checkpoint.status !== 'complete' && checkpoint.status !== 'current' ? ` (${checkpoint.status})` : ''}
    </span>
  )
}
