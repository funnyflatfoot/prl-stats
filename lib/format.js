const nf = (v, d = 0) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export const num = nf

export function usd(v, d = 0) {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${nf(v / 1e9, 2)}B`
  if (a >= 1e6) return `$${nf(v / 1e6, 2)}M`
  if (a >= 1e3) return `$${nf(v / 1e3, 1)}k`
  return `$${nf(v, d)}`
}

export function usdExact(v, d = 2) {
  return v == null || !Number.isFinite(v) ? '—' : `$${nf(v, d)}`
}

export function prl(v, d = 0) {
  return v == null || !Number.isFinite(v) ? '—' : `${nf(v, d)} PRL`
}

export function millions(v, d = 1) {
  return v == null || !Number.isFinite(v) ? '—' : `${nf(v / 1e6, d)}M`
}

export function pct(v, d = 1) {
  return v == null || !Number.isFinite(v) ? '—' : `${nf(v, d)}%`
}

export function hashrate(ehs, d = 2) {
  if (ehs == null || !Number.isFinite(ehs)) return '—'
  if (ehs < 0.001) return `${nf(ehs * 1e6, d)} TH/s`
  if (ehs < 1) return `${nf(ehs * 1000, d)} PH/s`
  return `${nf(ehs, d)} EH/s`
}

export function shortAddr(a) {
  return !a ? '—' : a.length > 22 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a
}

export function ts(unix) {
  if (!unix) return '—'
  return new Date(unix * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z'
}

export function day(d) {
  return d ? d.slice(5) : '—'
}
