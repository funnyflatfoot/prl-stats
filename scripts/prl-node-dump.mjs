#!/usr/bin/env node
// Dump the chain from a local pearld into the NDJSON chunks that prl-chain.mjs analyses.
// One `getblock` (verbosity 2) per height returns the block and every transaction inline, so this
// replaces the explorer scrape entirely: local calls, no rate limit, no server action id to rotate.
// Env: PRL_RPC (default http://127.0.0.1:44107), PRL_RPC_USER, PRL_RPC_PASS,
//      PRL_CACHE_DIR (default .prl-cache), PRL_STOP_AT, PRL_DUMP_BUDGET_MS (default 60 min).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const CACHE = process.env.PRL_CACHE_DIR || '.prl-cache'
const RPC = process.env.PRL_RPC || 'http://127.0.0.1:44107'
const AUTH = 'Basic ' + Buffer.from(`${process.env.PRL_RPC_USER || 'prl'}:${process.env.PRL_RPC_PASS || 'prl'}`).toString('base64')
const CHUNK_BYTES = 8e6
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

let id = 0
export async function rpc(method, params = [], tries = 5) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { authorization: AUTH, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '1.0', id: ++id, method, params }) })
      const j = await r.json()
      if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`)
      return j.result
    } catch (e) { last = e }
    await sleep(300 * (i + 1))
  }
  throw new Error(`rpc ${method} failed: ${last}`)
}

// btcd's getblock verbosity 2 -> the two NDJSON shapes the analyser reads.
// The analyser resolves an input's value by looking the previous output up in the dump itself,
// so the missing prev-value here costs nothing and we can skip --txindex on the node.
export function blockLines(b) {
  const out = [JSON.stringify({ b: b.height, t: b.time, d: b.difficulty, bits: b.bits, sz: b.size ?? 0, n: (b.rawtx || b.tx || []).length })]
  for (const t of b.rawtx || b.tx || []) {
    const cb = (t.vin || []).some(v => v.coinbase !== undefined)
    out.push(JSON.stringify({
      x: t.txid,
      b: b.height,
      cb: cb ? 1 : 0,
      vin: cb ? [] : t.vin.map(v => [v.txid, v.vout, null]),
      vout: (t.vout || []).map(o => [o.scriptPubKey?.address || (o.scriptPubKey?.addresses || [])[0] || '', o.value])
    }))
  }
  return out
}

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const t0 = Date.now(), budget = Number(process.env.PRL_DUMP_BUDGET_MS || 60 * 60e3)
  const tip = Math.min(await rpc('getblockcount'), process.env.PRL_STOP_AT ? Number(process.env.PRL_STOP_AT) : Infinity)
  log(`node tip #${tip}`)

  // The dump is derived data: rebuild it from scratch each run so it can never drift from the node.
  let chunk = 0, buf = [], bytes = 0, done = 0
  const flush = () => { if (!buf.length) return; writeFileSync(path.join(CACHE, `chunk-${String(chunk).padStart(5, '0')}.ndjson.gz`), gzipSync(Buffer.from(buf.join('\n') + '\n'), { level: 6 })); chunk++; buf = []; bytes = 0 }
  for (let h = 1; h <= tip; h++) {
    if (Date.now() - t0 > budget) { log(`budget reached at #${h}`); break }
    const hash = await rpc('getblockhash', [h])
    const b = await rpc('getblock', [hash, 2])
    if (b.height === undefined) b.height = h
    for (const l of blockLines(b)) { buf.push(l); bytes += l.length }
    done = h
    if (bytes >= CHUNK_BYTES) flush()
    if (h % 10000 === 0) log(`#${h} (${(h / ((Date.now() - t0) / 1000)).toFixed(0)} blk/s)`)
  }
  flush()
  writeFileSync(path.join(CACHE, 'state.json'), JSON.stringify({ next: done + 1, nextChunk: chunk, maxHeight: tip, source: 'pearld' }))
  log(`dumped ${done} blocks into ${chunk} chunks in ${((Date.now() - t0) / 60e3).toFixed(1)} min`)
  if (done < tip) { log(`incomplete (${done}/${tip}); not safe to analyse`); process.exit(3) }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1) })
