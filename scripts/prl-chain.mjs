#!/usr/bin/env node
// Daily miner-behaviour pipeline. Runs in GitHub Actions (see .github/workflows/prl-daily.yml).
//   1. load the chain dump (NDJSON chunks) from the local cache, filling gaps from Turso
//   2. scrape new blocks from the explorer batch action (prlscan API as fallback), append chunks, upload
//   3. refresh prlscan labels, PRL price, WPRL mint/burn log
//   4. full-graph fate walk with the SafeTrade change-chain cluster rule
//   5. write the page's JSON to Turso `aggregates` (key miner_behavior)
// Env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN. Optional: PRL_CACHE_DIR (default .prl-cache), PRL_STOP_AT (height, for tests),
//      PRL_SCRAPE_BUDGET_MS (default 4.5 h), PRL_ANALYZE_ONLY=1 (skip scraping).
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import path from 'node:path'
import { batch, query, ensureSchema, getMeta, setMeta, putAggregate } from '../lib/db.js'

const CACHE = process.env.PRL_CACHE_DIR || '.prl-cache'
const EXPLORER = 'https://explorer.pearlresearch.ai'
const ACTION = '40dcb07d2a02b501b109109b0a6869d2cf455eef61' // explorer batch tx server action; rotates on explorer redeploys
const API = 'https://api.prlscan.com/v1'
const CHUNK_BYTES = 2e6 // uncompressed; ~0.6 MB gzipped per Turso row
const W0 = 1777248000
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
mkdirSync(CACHE, { recursive: true })

// ---------- chunk store ----------
const cachePath = id => path.join(CACHE, `chunk-${String(id).padStart(5, '0')}.ndjson.gz`)
async function loadChunk(id) {
  const p = cachePath(id)
  if (existsSync(p)) return gunzipSync(readFileSync(p)).toString('utf8')
  const r = await query('SELECT gz FROM chunks WHERE id = ?', [id])
  if (!r.rows.length) throw new Error(`chunk ${id} missing in db`)
  writeFileSync(p, r.rows[0].gz)
  return gunzipSync(r.rows[0].gz).toString('utf8')
}
async function saveChunk(id, blocksTo, text) {
  const gz = gzipSync(Buffer.from(text, 'utf8'), { level: 6 })
  writeFileSync(cachePath(id), gz)
  await query('INSERT INTO chunks (id, blocks_to, bytes, gz) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET blocks_to = excluded.blocks_to, bytes = excluded.bytes, gz = excluded.gz', [id, blocksTo, text.length, gz])
}

// ---------- fetch helpers ----------
async function fetchRetry(url, opts = {}, tries = 8) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts)
      if (r.status === 200) return r
      if (r.status === 404) return null
      last = `status ${r.status}`
    } catch (e) { last = String(e) }
    await sleep(Math.min(20000, 500 * 2 ** i))
  }
  throw new Error(`fetch failed ${url}: ${last}`)
}
const gj = async (url, tries) => { const r = await fetchRetry(url, {}, tries); return r ? r.json() : null }

// ---------- scraping ----------
async function explorerBlock(h) {
  const r = await fetchRetry(`${EXPLORER}/block/${h}?network=mainnet`, { headers: { RSC: '1', Accept: 'text/x-component' } })
  if (!r) return null
  const t = await r.text()
  const mx = t.match(/"maxHeight":(\d+)/)
  const m = t.match(/"txids":\[(.*?)\]/); if (!m) throw new Error('no txids at ' + h)
  const g = k => { const x = t.match(new RegExp('"' + k + '":("?)([^,"}]*)')); return x ? x[2] : null }
  return { h, time: +g('time'), bits: g('bits'), difficulty: +g('difficulty'), size: +g('size'), txids: m[1].split(',').map(s => s.replace(/"/g, '')), maxHeight: mx ? +mx[1] : null }
}
async function explorerTxs(ids) {
  const r = await fetchRetry(`${EXPLORER}/block/1?network=mainnet`, { method: 'POST', headers: { Accept: 'text/x-component', 'next-action': ACTION, 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify([ids]) })
  const t = await r.text()
  const line = t.split('\n').find(l => l.startsWith('1:')); if (!line) throw new Error('explorer action: no payload (action id rotated?)')
  const resp = JSON.parse(line.slice(2)).response
  if (!Array.isArray(resp) || resp.length !== ids.length) throw new Error(`explorer action: bad batch ${resp && resp.length}/${ids.length}`)
  return resp.map(tx => ({ txid: tx.txid, cb: !!(tx.vin.length && tx.vin[0].coinbase === 'coinbase'), vin: tx.vin[0]?.coinbase === 'coinbase' ? [] : tx.vin.map(v => [v.txid, v.vout, v.amount]), vout: tx.vout.map(o => [(o.addresses && o.addresses[0]) || '', o.amount]) }))
}
// prlscan fallback: one request per tx, ~8/s
async function prlscanTx(txid) {
  const d = await gj(`${API}/txs/${txid}`)
  const cb = !!(d.transaction?.is_coinbase) || !(d.inputs || []).length
  return { txid, cb, vin: cb ? [] : d.inputs.map(i => [i.prev_txid ?? i.txid, i.prev_vout ?? i.vout, i.prev_value_grains / 1e8]), vout: d.outputs.map(o => [o.address || '', o.value_grains / 1e8]) }
}
async function pool(items, conc, fn) { let i = 0; const out = new Array(items.length); await Promise.all(Array.from({ length: conc }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } })); return out }

async function scrape(state) {
  const t0 = Date.now(); const budget = Number(process.env.PRL_SCRAPE_BUDGET_MS || 4.5 * 3600e3)
  const stopAt = process.env.PRL_STOP_AT ? Number(process.env.PRL_STOP_AT) : Infinity
  let useExplorerTxs = true; let buf = []; let bufBytes = 0; let blocks = 0
  const flush = async () => { if (!buf.length) return; await saveChunk(state.nextChunk, state.next - 1, buf.join('\n') + '\n'); state.nextChunk++; await setMeta('next_block', state.next); await setMeta('next_chunk', state.nextChunk); log(`chunk ${state.nextChunk - 1} saved, blocks <= ${state.next - 1}`); buf = []; bufBytes = 0 }
  while (state.next <= stopAt && Date.now() - t0 < budget) {
    const hs = []; for (let h = state.next; h < state.next + 60 && h <= stopAt; h++) hs.push(h)
    let bl = await pool(hs, 6, explorerBlock)
    const end = bl.findIndex(b => b === null); if (end >= 0) bl = bl.slice(0, end)
    if (!bl.length) break
    const ids = bl.flatMap(b => b.txids)
    let txs
    if (useExplorerTxs) {
      try { const groups = []; for (let i = 0; i < ids.length; i += 100) groups.push(ids.slice(i, i + 100)); txs = (await pool(groups, 4, explorerTxs)).flat() }
      catch (e) { log('explorer tx action failed, falling back to prlscan:', e.message); useExplorerTxs = false }
    }
    if (!useExplorerTxs) { txs = []; for (const id of ids) { txs.push(await prlscanTx(id)); await sleep(120) } }
    const byId = new Map(txs.map(t => [t.txid, t]))
    for (const b of bl) {
      const line = JSON.stringify({ b: b.h, t: b.time, d: b.difficulty, bits: b.bits, sz: b.size, n: b.txids.length }); buf.push(line); bufBytes += line.length
      for (const id of b.txids) { const t = byId.get(id); if (!t) throw new Error('missing tx ' + id); const l = JSON.stringify({ x: id, b: b.h, cb: t.cb ? 1 : 0, vin: t.vin, vout: t.vout }); buf.push(l); bufBytes += l.length }
      blocks++
    }
    state.next = bl[bl.length - 1].h + 1
    if (bufBytes >= CHUNK_BYTES) await flush()
    if (end >= 0) break // reached the tip
  }
  await flush()
  log(`scraped ${blocks} blocks in ${((Date.now() - t0) / 60e3).toFixed(1)} min, next block ${state.next}`)
  return blocks
}

// ---------- reference data ----------
async function refreshLabels() {
  const holders = []; let cur = null
  for (let p = 0; p < 3000; p++) {
    const d = await gj(`${API}/holders?limit=100${cur ? '&cursor=' + encodeURIComponent(cur) : ''}`)
    if (!d || !d.items.length) break
    holders.push(...d.items); if (!d.next_cursor) break; cur = d.next_cursor; await sleep(120)
  }
  const miners = await gj(`${API}/miners`); const pools = await gj(`${API}/pools`)
  const labels = new Map()
  for (const it of holders) if (it.label_kind) labels.set(it.address, [it.label_kind, it.label])
  for (const it of miners?.items || []) if (it.label_kind) labels.set(it.address, [it.label_kind, it.label])
  for (const it of pools?.items || []) if (it.address && !labels.has(it.address)) labels.set(it.address, ['pool', it.name])
  log(`labels: ${holders.length} holders walked, ${labels.size} labelled`)
  return labels
}
async function refreshPrice() {
  const h = await gj(`${API}/market/prl/history?days=400&bucket=day`)
  const daily = {}
  for (const b of h.buckets) { const p = b.safetrade_price_usd || b.coinmarketcap_price_usd || b.pearl_otc_vwap_usd || null; if (p) daily[b.time.slice(0, 10)] = [p, b.safetrade_price_usd ? 'safetrade' : b.coinmarketcap_price_usd ? 'coinmarketcap' : 'pearl_otc_vwap'] }
  return daily
}
async function refreshWprl() {
  const C = '0x07696DcaB55E62cfef953666b29Fe1970518cB00', Z = '0x0000000000000000000000000000000000000000'
  const days = {}; let np = null
  for (let p = 0; p < 400; p++) {
    let u = `https://eth.blockscout.com/api/v2/addresses/${Z}/token-transfers?token=${C}`
    if (np) u += '&' + Object.entries(np).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&')
    const j = await gj(u); if (!j) break
    for (const t of j.items) { const d = t.timestamp.slice(0, 10); const v = Number(t.total.value) / 1e8; const g = (days[d] = days[d] || { minted: 0, burned: 0 }); if (t.from.hash.toLowerCase() === Z) g.minted += v; else g.burned += v }
    np = j.next_page_params; if (!np) break; await sleep(250)
  }
  const tok = await gj(`https://eth.blockscout.com/api/v2/tokens/${C}`)
  return { days, contract: C, total_supply_now: Number(tok.total_supply) / 1e8, holders: tok.holders ? +tok.holders : null }
}

// ---------- fate walk ----------
const SINKS = ['unspent', 'safetrade', 'otc', 'pearl_trade', 'bridge', 'pool', 'system', 'hub', 'fee_dust']
const SI = Object.fromEntries(SINKS.map((s, i) => [s, i])); const NS = SINKS.length
const sinkFor = (k, l) => {
  if (k === 'pool') return 'pool'; if (k === 'pearl_trade') return 'pearl_trade'
  if (k === 'bridge' || k === 'bridge_treasury' || k === 'bridge_fee') return 'bridge'
  if (k === 'system') { const s = (l || '').toLowerCase(); if (s.includes('safetrade')) return 'safetrade'; if (s.includes('otc')) return 'otc'; return 'system' }
  if (k === 'pearl_otc') return null; return 'system'
}
const CLUSTER_FROM = 1789430400 // 2026-09-15: SafeTrade hot wallet drained into a rolling change chain

async function analyze(state, labels) {
  let CAP = 1 << 22
  let outAddr = new Int32Array(CAP), outAmt = new Float64Array(CAP), outTx = new Int32Array(CAP)
  const grow = need => { while (need > CAP) { CAP *= 2; const a = new Int32Array(CAP); a.set(outAddr); outAddr = a; const b = new Float64Array(CAP); b.set(outAmt); outAmt = b; const c = new Int32Array(CAP); c.set(outTx); outTx = c } }
  const addrId = new Map(), addrs = [], addrFirstTx = []
  const aid = (a, o) => { let i = addrId.get(a); if (i === undefined) { i = addrs.length; addrId.set(a, i); addrs.push(a); addrFirstTx.push(o) } return i }
  const txFirstOut = new Map(); const txHeight = [], txCb = [], txIn = [], txOutStart = [], txOutN = []
  const blocks = new Map(); let nOut = 0; const pending = []
  for (let c = 0; c < state.nextChunk; c++) {
    const text = await loadChunk(c)
    let p = 0
    while (p < text.length) {
      let e = text.indexOf('\n', p); if (e < 0) e = text.length
      if (e > p) {
        const r = JSON.parse(text.slice(p, e))
        if (r.x === undefined) blocks.set(r.b, r.t)
        else {
          const o = txHeight.length; txHeight.push(r.b); txCb.push(r.cb)
          const start = nOut; txFirstOut.set(r.x, start); txOutStart.push(start); txOutN.push(r.vout.length); grow(nOut + r.vout.length)
          for (const [a, amt] of r.vout) { outAddr[nOut] = a ? aid(a, o) : -1; outAmt[nOut] = +amt; outTx[nOut] = o; nOut++ }
          const ins = []
          for (const [ptx, pv] of r.vin) { const s = txFirstOut.get(ptx); if (s === undefined) { pending.push([o, ins.length, ptx, pv]); ins.push(-1) } else ins.push(s + pv) }
          txIn.push(ins)
        }
      }
      p = e + 1
    }
    if (c % 100 === 0) log(`parsed chunk ${c}/${state.nextChunk}, txs ${txHeight.length}`)
  }
  for (const [o, i, ptx, pv] of pending) { const s = txFirstOut.get(ptx); if (s === undefined) throw new Error('unresolved input ' + ptx); txIn[o][i] = s + pv }
  const nTx = txHeight.length, nAddr = addrs.length
  log(`graph: ${nTx} txs, ${nOut} outputs, ${nAddr} addresses`)
  const spentBy = new Int32Array(nOut).fill(-1)
  for (let o = 0; o < nTx; o++) for (const i of txIn[o]) spentBy[i] = o
  const addrSink = new Int8Array(nAddr).fill(-1); const addrLabel = new Map()
  for (const [a, [k, l]] of labels) { const i = addrId.get(a); if (i === undefined) continue; addrLabel.set(i, [k, l]); const s = sinkFor(k, l); if (s) addrSink[i] = SI[s] }
  // SafeTrade change-chain cluster
  const cluster = new Set(); for (const [i, [k, l]] of addrLabel) if (k === 'system' && (l || '').toLowerCase().includes('safetrade')) cluster.add(i)
  const cl = { txs: 0, added: 0, withdrawn: 0, withdrawals: 0, large_not_fresh: 0 }
  for (let o = 0; o < nTx; o++) {
    if (txCb[o] || (blocks.get(txHeight[o]) || 0) < CLUSTER_FROM) continue
    let hit = false; for (const i of txIn[o]) if (cluster.has(outAddr[i])) { hit = true; break }
    if (!hit) continue; cl.txs++
    const s = txOutStart[o], n = txOutN[o]; let tot = 0; for (let j = s; j < s + n; j++) tot += outAmt[j]
    for (let j = s; j < s + n; j++) { const a = outAddr[j]; if (a >= 0 && cluster.has(a)) continue; if (outAmt[j] >= 0.25 * tot && a >= 0 && addrFirstTx[a] === o && addrSink[a] < 0) { cluster.add(a); cl.added++ } else { cl.withdrawn += outAmt[j]; cl.withdrawals++; if (outAmt[j] >= 0.25 * tot) cl.large_not_fresh++ } }
  }
  for (const a of cluster) if (addrSink[a] < 0) addrSink[a] = SI.safetrade
  cl.withdrawn = Math.round(cl.withdrawn)
  const otcFeeIds = new Set(); for (const [i, [k, l]] of addrLabel) if (k === 'system' && (l || '').toLowerCase().includes('otc')) otcFeeIds.add(i)
  const poolIds = new Set(); for (const [i, [k]] of addrLabel) if (k === 'pool') poolIds.add(i)
  const otcSettle = new Uint8Array(nTx)
  for (let o = 0; o < nTx; o++) { const s = txOutStart[o], n = txOutN[o]; for (let j = s; j < s + n; j++) if (outAddr[j] >= 0 && otcFeeIds.has(outAddr[j])) { otcSettle[o] = 1; break } }
  const txFate = new Float32Array(nTx * NS); const tmp = new Float64Array(NS)
  const outFate = (j, dst) => { const a = outAddr[j]; dst.fill(0); if (a >= 0 && addrSink[a] >= 0) dst[addrSink[a]] = 1; else if (spentBy[j] < 0) dst[SI.unspent] = 1; else { const b = spentBy[j] * NS; for (let k = 0; k < NS; k++) dst[k] = txFate[b + k] } }
  for (let o = nTx - 1; o >= 0; o--) {
    const s = txOutStart[o], n = txOutN[o], b = o * NS
    if (otcSettle[o]) { txFate[b + SI.otc] = 1; continue }
    let tot = 0; for (let j = s; j < s + n; j++) tot += outAmt[j]
    if (tot <= 0) { txFate[b + SI.fee_dust] = 1; continue }
    for (let j = s; j < s + n; j++) { const w = outAmt[j] / tot; if (!w) continue; outFate(j, tmp); for (let k = 0; k < NS; k++) txFate[b + k] += w * tmp[k] }
  }
  log('fate walk done')
  // miners = payout recipients
  const recv = []
  for (let o = 0; o < nTx; o++) {
    const s = txOutStart[o], n = txOutN[o]
    if (txCb[o]) { for (let j = s; j < s + n; j++) { const a = outAddr[j]; if (a >= 0 && outAmt[j] > 0 && !poolIds.has(a)) recv.push([j, a]) } continue }
    let src = -1; for (const i of txIn[o]) { const a = outAddr[i]; if (poolIds.has(a)) { src = a; break } }
    if (src < 0) continue
    let pure = true; for (const i of txIn[o]) if (outAddr[i] !== src) { pure = false; break }
    if (!pure) continue
    for (let j = s; j < s + n; j++) { const a = outAddr[j]; if (a >= 0 && a !== src && outAmt[j] > 0) recv.push([j, a]) }
  }
  const miners = new Map()
  for (const [j, a] of recv) {
    let m = miners.get(a); if (!m) { m = { recv: 0, du: 0, fate: new Float64Array(NS) }; miners.set(a, m) }
    const amt = outAmt[j]; m.recv += amt
    if (spentBy[j] < 0 && (outAddr[j] < 0 || addrSink[outAddr[j]] < 0)) m.du += amt
    outFate(j, tmp); for (let k = 0; k < NS; k++) m.fate[k] += amt * tmp[k]
  }
  const BUCKETS = ['<10', '10-100', '100-1k', '1k-10k', '10k-100k', '>100k']
  const bucket = v => v >= 1e5 ? '>100k' : v >= 1e4 ? '10k-100k' : v >= 1e3 ? '1k-10k' : v >= 100 ? '100-1k' : v >= 10 ? '10-100' : '<10'
  const weekOf = h => { const t = blocks.get(h); return t === undefined ? null : Math.floor((t - W0) / 604800) }
  const g5 = f => ({ unspent: f[SI.unspent], safetrade: f[SI.safetrade], otc: f[SI.otc] + f[SI.pearl_trade], bridge: f[SI.bridge], other: f[SI.pool] + f[SI.system] + f[SI.hub] + f[SI.fee_dust] })
  const fateObj = f => ({ unspent: f[SI.unspent], safetrade: f[SI.safetrade], otc: f[SI.otc], pearl_trade: f[SI.pearl_trade], bridge: f[SI.bridge], pool: f[SI.pool], system: f[SI.system], hub: 0, fee_dust: f[SI.fee_dust] })
  const mk = () => ({ miners: 0, recv: 0, fate: new Float64Array(NS), status: { held_all: 0, partial: 0, spent_all: 0 }, dominant: { unspent: 0, safetrade: 0, otc: 0, bridge: 0, other: 0 } })
  const byBucket = Object.fromEntries(BUCKETS.map(b => [b, mk()])); const tot = mk()
  const add = (g, m, st) => { g.miners++; g.recv += m.recv; for (let k = 0; k < NS; k++) g.fate[k] += m.fate[k]; g.status[st]++; const dv = g5(m.fate); let bk = 'unspent', bv = -1; for (const k in dv) if (dv[k] > bv) { bv = dv[k]; bk = k } g.dominant[bk]++ }
  const minerSet = new Uint8Array(nAddr)
  for (const [a, m] of miners) { if (addrSink[a] >= 0) continue; minerSet[a] = 1; const st = m.du >= m.recv * 0.999 ? 'held_all' : m.du <= m.recv * 0.001 ? 'spent_all' : 'partial'; add(byBucket[bucket(m.recv)], m, st); add(tot, m, st) }
  const emitted = new Map()
  for (let o = 0; o < nTx; o++) if (txCb[o]) { const w = weekOf(txHeight[o]); const s = txOutStart[o], n = txOutN[o]; let v = 0; for (let j = s; j < s + n; j++) v += outAmt[j]; emitted.set(w, (emitted.get(w) || 0) + v) }
  const issued = new Map(), weekly = new Map()
  for (const [j, a] of recv) {
    if (addrSink[a] >= 0) continue
    const w = weekOf(txHeight[outTx[j]]); if (!issued.has(w)) issued.set(w, { paid: 0, f: new Float64Array(NS), uao: 0 })
    const g = issued.get(w); g.paid += outAmt[j]; outFate(j, tmp); for (let k = 0; k < NS; k++) g.f[k] += outAmt[j] * tmp[k]
    if (spentBy[j] < 0) g.uao += outAmt[j]
    else { const ws = weekOf(txHeight[spentBy[j]]); if (!weekly.has(ws)) weekly.set(ws, new Float64Array(NS)); const fs = weekly.get(ws); for (let k = 0; k < NS; k++) fs[k] += outAmt[j] * tmp[k] }
  }
  const bridgeIds = new Set(); for (const [i, [k]] of addrLabel) if (k === 'bridge' || k === 'bridge_treasury' || k === 'bridge_fee') bridgeIds.add(i)
  const bridgeFlow = new Map()
  for (let o = 0; o < nTx; o++) {
    if (txCb[o]) continue
    let inB = 0; for (const i of txIn[o]) if (bridgeIds.has(outAddr[i])) inB += outAmt[i]
    const s = txOutStart[o], n = txOutN[o]; let outB = 0; for (let j = s; j < s + n; j++) if (bridgeIds.has(outAddr[j])) outB += outAmt[j]
    if (!inB && !outB) continue
    const w = weekOf(txHeight[o]); if (!bridgeFlow.has(w)) bridgeFlow.set(w, { in: 0, out: 0 }); const g = bridgeFlow.get(w)
    if (inB === 0) g.in += outB; else if (outB < inB) g.out += inB - outB
  }
  const inflow = new Map(), outflow = new Map()
  for (let j = 0; j < nOut; j++) { const a = outAddr[j]; if (a < 0 || !minerSet[a]) continue; const w = weekOf(txHeight[outTx[j]]); inflow.set(w, (inflow.get(w) || 0) + outAmt[j]); if (spentBy[j] >= 0) { const ws = weekOf(txHeight[spentBy[j]]); outflow.set(ws, (outflow.get(ws) || 0) + outAmt[j]) } }
  // launch week (week 0) detail
  let lwBlocks = 0, lwDay1 = 0, lwPrl = 0; const lwAddr = new Map(), lwBlocksPer = new Map(); const daily = Array.from({ length: 7 }, (_, d) => ({ day: d, prl: 0, blocks: 0, addrs: new Set() }))
  for (let o = 0; o < nTx; o++) {
    if (!txCb[o]) continue; const t = blocks.get(txHeight[o]); if (t === undefined || t >= W0 + 604800) continue
    const d = Math.floor((t - W0) / 86400); lwBlocks++; if (d === 0) lwDay1++; daily[d].blocks++
    const s = txOutStart[o], n = txOutN[o]
    for (let j = s; j < s + n; j++) { const a = outAddr[j]; if (a < 0) continue; lwPrl += outAmt[j]; daily[d].prl += outAmt[j]; daily[d].addrs.add(a); lwAddr.set(a, (lwAddr.get(a) || 0) + outAmt[j]); lwBlocksPer.set(a, (lwBlocksPer.get(a) || 0) + 1) }
  }
  const lwSorted = [...lwAddr.values()].sort((x, y) => y - x); let cum = 0, n50 = 0, n90 = 0
  for (let i = 0; i < lwSorted.length; i++) { cum += lwSorted[i]; if (!n50 && cum >= lwPrl * 0.5) n50 = i + 1; if (!n90 && cum >= lwPrl * 0.9) n90 = i + 1 }
  const share = k => lwSorted.slice(0, k).reduce((a, b) => a + b, 0) / lwPrl
  const lwIssued = issued.get(0)
  let tip = 0; for (const h of blocks.keys()) if (h > tip) tip = h
  const fmtG = g => ({ miners: g.miners, recv: g.recv, fate: fateObj(g.fate), status: g.status, dominant: g.dominant })
  return {
    tip_height: tip, tip_time: blocks.get(tip), n_tx: nTx, n_outputs: nOut, n_addresses: nAddr,
    cluster: cl,
    totals: fmtG(tot), by_bucket: BUCKETS.map(b => ({ bucket: b, ...fmtG(byBucket[b]) })),
    issued: [...issued].sort((x, y) => x[0] - y[0]).map(([w, g]) => ({ week: w, emitted: emitted.get(w) || 0, paid: g.paid, uao: g.uao, ...g5(g.f) })),
    weekly: [...weekly].sort((x, y) => x[0] - y[0]).map(([w, fs]) => ({ week: w, ...g5(fs) })),
    bridge_flow: [...bridgeFlow].sort((x, y) => x[0] - y[0]).map(([w, g]) => ({ week: w, in: g.in, out: g.out })),
    balances: Array.from({ length: weekOf(tip) + 1 }, (_, w) => ({ week: w, inflow: inflow.get(w) || 0, outflow: outflow.get(w) || 0 })),
    launch_week: { week_start: W0, blocks: lwBlocks, blocks_day1: lwDay1, prl: lwPrl, addresses: lwAddr.size, all_solo_coinbase: true, top1_share: +share(1).toFixed(4), top10_share: +share(10).toFixed(4), top100_share: +share(100).toFixed(4), addresses_for_50pct: n50, addresses_for_90pct: n90, addresses_one_block: [...lwBlocksPer.values()].filter(v => v === 1).length, addresses_100plus_blocks: [...lwBlocksPer.values()].filter(v => v >= 100).length, unspent_share: lwIssued ? +(lwIssued.f[SI.unspent] / lwIssued.paid).toFixed(4) : null, daily: daily.map(d => ({ day: d.day, prl: Math.round(d.prl), blocks: d.blocks, addresses: d.addrs.size })) }
  }
}

// ---------- assemble page JSON ----------
function assemble(A, price, wprl) {
  const rd = v => Math.round(v)
  const weekOfDate = d => Math.floor((Date.parse(d + 'T00:00:00Z') / 1000 - W0) / 604800)
  const wc = {}; for (const d of Object.keys(price).sort()) wc[weekOfDate(d)] = [+price[d][0].toFixed(3), price[d][1], d]
  const pc = w => (wc[w] ? wc[w][0] : null), ps = w => (wc[w] ? wc[w][1] : null)
  const supply = 2.1e9 * A.tip_height / (A.tip_height + 650226)
  const by_issue_week = A.issued.map(w => ({ week: w.week, week_start: W0 + w.week * 604800, emitted: rd(w.emitted), paid_to_miners: rd(w.paid), unspent_at_origin: rd(w.uao), held: rd(w.unspent), safetrade: rd(w.safetrade), otc: rd(w.otc), bridge: rd(w.bridge), other: rd(w.other), price_close_usd: pc(w.week), price_source: ps(w.week) }))
  const paidBy = Object.fromEntries(by_issue_week.map(r => [r.week, r.paid_to_miners]))
  const sell = {}; for (const w of A.weekly) sell[w.week] = { week: w.week, week_start: W0 + w.week * 604800, paid_to_miners: paidBy[w.week] || 0, moved_unsold: rd(w.unspent), safetrade: rd(w.safetrade), otc: rd(w.otc), bridge: rd(w.bridge), other: rd(w.other), price_close_usd: pc(w.week) }
  const selling_weekly = Object.keys(sell).map(Number).sort((a, b) => a - b).map(w => sell[w])
  let prev = null, cum = 0; const miner_balance_weekly = A.balances.map(b => { cum += b.inflow - b.outflow; const s = sell[b.week] || {}; const sold = (s.safetrade || 0) + (s.otc || 0); const row = { week: b.week, week_start: W0 + b.week * 604800, balance: rd(cum), inflow: rd(b.inflow), outflow: rd(b.outflow), wow: prev == null ? null : rd(cum - prev), sold, sold_to_balance: prev ? sold / prev : null, price_close_usd: pc(b.week) }; prev = cum; return row })
  let wcum = 0; const wprl_supply_daily = Object.keys(wprl.days).sort().map(d => { wcum += wprl.days[d].minted - wprl.days[d].burned; return { date: d, minted: rd(wprl.days[d].minted), burned: rd(wprl.days[d].burned), supply: rd(wcum), price_usd: price[d] ? price[d][0] : null } })
  const lw = A.launch_week
  const pct = (v, dp = 1) => (v * 100).toFixed(dp) + '%'
  lw.share_of_issuance_at_tip = lw.prl / supply
  lw.note = `Launch week (Apr 27 to May 3): ${lw.blocks.toLocaleString('en-US')} blocks, ${(lw.prl / 1e6).toFixed(1)}M PRL, ${pct(lw.share_of_issuance_at_tip, 0)} of all PRL issued to date. ${lw.blocks_day1.toLocaleString('en-US')} blocks on day one at difficulty 1. All solo coinbase, ${lw.addresses.toLocaleString('en-US')} addresses, no pools. Widely spread: top address ${pct(lw.top1_share)}, top 10 ${pct(lw.top10_share)}, top 100 ${pct(lw.top100_share)}, ${lw.addresses_for_50pct} addresses hold half. ${lw.addresses_one_block.toLocaleString('en-US')} addresses won one block; ${lw.addresses_100plus_blocks} won 100+. ${pct(lw.unspent_share)} still unspent. Left off the bars; kept in the table.`
  return {
    tip_height: A.tip_height, tip_time: A.tip_time, n_tx: A.n_tx, n_outputs: A.n_outputs, n_addresses: A.n_addresses, generated_at: new Date().toISOString(),
    sinks: SINKS,
    safetrade_cluster: { ...A.cluster, since: '2026-09-15', rule: 'From 2026-09-15 the prlscan-labelled SafeTrade hot wallet was drained into a rolling chain of fresh change addresses. Cluster = labelled wallet + every fresh output address taking >= 25% of a transaction that spends a cluster address; smaller outputs are withdrawals. Cluster addresses are SafeTrade sinks.' },
    totals: A.totals, by_bucket: A.by_bucket,
    supply_at_tip: supply, supply_source: 'S*t/(t+H), S=2.1e9, H=650226 (whitepaper emission schedule)',
    price: { source: 'api.prlscan.com/v1/market/prl/history (Pearl OTC VWAP → SafeTrade close → CoinMarketCap)', weekly_close: Object.fromEntries(Object.entries(wc).sort((a, b) => +a[0] - +b[0])) },
    by_issue_week, bridge_flow_prl_side: A.bridge_flow.map(w => ({ week: w.week, week_start: W0 + w.week * 604800, in: rd(w.in), out: rd(w.out) })),
    selling_weekly, miner_balance_weekly,
    miner_balance_note: `Balance = all unspent PRL on the ${A.totals.miners.toLocaleString('en-US')} miner addresses at week end (UTC Monday). sold_to_balance = PRL sold that week (SafeTrade + Pearl OTC, by miner spend time) / balance at end of prior week.`,
    wprl_supply_daily,
    wprl: { contract: wprl.contract, decimals: 8, total_supply_now: wprl.total_supply_now, holders: wprl.holders, source: 'Blockscout ERC-20 Transfer events from/to 0x0 (mints/burns), reconciled to totalSupply()', first_mint: wprl_supply_daily[0]?.date, reconciliation: { cumulative_from_log: rd(wcum), total_supply_now: wprl.total_supply_now, diff: rd(wprl.total_supply_now - wcum) } },
    launch_week: lw
  }
}

// ---------- main ----------
const main = async () => {
  await ensureSchema()
  const state = { next: Number((await getMeta('next_block')) || 1), nextChunk: Number((await getMeta('next_chunk')) || 0) }
  log(`state: next block ${state.next}, chunks ${state.nextChunk}, cache files ${readdirSync(CACHE).length}`)
  if (!process.env.PRL_ANALYZE_ONLY) await scrape(state)
  if (state.nextChunk === 0) { log('no chain data yet'); return }
  let labels, price, wprl
  if (process.env.PRL_FIXTURES) { // offline test: labels.json {address:[kind,label]}, price.json {date:[usd,source]}, wprl.json {days:{date:{minted,burned}},contract,total_supply_now}
    const fx = f => JSON.parse(readFileSync(path.join(process.env.PRL_FIXTURES, f), 'utf8'))
    labels = new Map(Object.entries(fx('labels.json'))); price = fx('price.json'); wprl = fx('wprl.json')
  } else { labels = await refreshLabels(); price = await refreshPrice(); wprl = await refreshWprl() }
  const A = await analyze(state, labels)
  const out = assemble(A, price, wprl)
  await putAggregate('miner_behavior', out)
  await setMeta('last_run', new Date().toISOString())
  writeFileSync(path.join(CACHE, 'miner_behavior.json'), JSON.stringify(out))
  log(`published: tip #${out.tip_height} ${new Date(out.tip_time * 1000).toISOString()}, miners ${out.totals.miners}, mined ${(out.totals.recv / 1e6).toFixed(2)}M, safetrade ${(out.totals.fate.safetrade / 1e6).toFixed(2)}M, otc ${((out.totals.fate.otc + out.totals.fate.pearl_trade) / 1e6).toFixed(2)}M, cluster ${JSON.stringify(out.safetrade_cluster.txs)} txs`)
}
main().catch(e => { console.error(e); process.exit(1) })
