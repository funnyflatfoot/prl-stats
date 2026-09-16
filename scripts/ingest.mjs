#!/usr/bin/env node
// Resumable ingestion. Reads the cache first, fetches only the gap to the current tip.
//
//   npm run ingest                    ingest from the cache high-water mark to the tip
//   npm run ingest -- --from 99000    force a start height
//   npm run ingest -- --to 100000     stop early
//   npm run ingest -- --headers-only  skip coinbase lookups (works with a stale action id)
//   npm run ingest -- --refetch       re-ingest the range even if cached

import {
  CONFIG,
  StaleActionIdError,
  fetchBlockHeader,
  fetchTipHeight,
  fetchTransactions,
  coinbaseSummary,
  pool
} from '../lib/explorer.mjs'
import { readBlocks, appendBlocks, readCheckpoint, writeCheckpoint } from '../lib/store.mjs'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = name => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : null
}

const headersOnly = flag('--headers-only')
const refetch = flag('--refetch')

function log(...m) {
  process.stdout.write(`[ingest ${new Date().toISOString().slice(11, 19)}] ${m.join(' ')}\n`)
}

async function main() {
  const cached = readBlocks()
  const cachedHeights = new Set(cached.map(b => b.height))
  const highWater = cached.length ? cached[cached.length - 1].height : CONFIG.startHeight - 1
  const from = opt('--from') ?? Math.max(CONFIG.startHeight, highWater + 1)

  log(`cache: ${cached.length} blocks` + (cached.length ? `, #${cached[0].height} to #${highWater}` : ''))

  const tip = await fetchTipHeight(Math.max(CONFIG.startHeight, highWater))
  const to = Math.min(opt('--to') ?? tip, tip)
  log(`tip: #${tip}; target range #${from} to #${to}`)

  if (to < from) {
    log('nothing to do, cache is current')
    writeCheckpoint({ ...(readCheckpoint() || {}), lastRunAt: new Date().toISOString(), tip, status: 'current' })
    return
  }

  const heights = []
  for (let h = from; h <= to; h++) if (refetch || !cachedHeights.has(h)) heights.push(h)
  log(`${heights.length} blocks to fetch at concurrency ${CONFIG.concurrency}`)

  const headers = new Map()
  let done = 0
  let failed = 0
  const started = Date.now()

  const flush = async () => {
    const pending = [...headers.values()].filter(h => !h._written)
    if (!pending.length) return
    if (!headersOnly) {
      const txids = pending.map(h => h.coinbaseTxid)
      for (let i = 0; i < txids.length; i += CONFIG.coinbaseBatchSize) {
        const batch = txids.slice(i, i + CONFIG.coinbaseBatchSize)
        const txs = await fetchTransactions(batch)
        const byTxid = new Map(txs.map(t => [t.txid, t]))
        for (const h of pending) {
          const tx = byTxid.get(h.coinbaseTxid)
          if (!tx) continue
          const cb = coinbaseSummary(tx)
          h.miner = cb.miner
          h.coinbaseTotal = cb.total
          h.coinbaseOutputs = cb.outputs
        }
      }
    }
    const rows = pending
      .map(h => {
        h._written = true
        const { _written, ...row } = h
        return row
      })
      .sort((a, b) => a.height - b.height)
    appendBlocks(rows)
    writeCheckpoint({
      lastRunAt: new Date().toISOString(),
      lastIngestedHeight: rows[rows.length - 1].height,
      lastIngestedTime: rows[rows.length - 1].time,
      tip,
      headersOnly,
      status: 'partial'
    })
    const rate = done / ((Date.now() - started) / 1000)
    log(`wrote through #${rows[rows.length - 1].height} (${done}/${heights.length}, ${rate.toFixed(1)} blk/s)`)
  }

  try {
    const chunkSize = CONFIG.checkpointEvery
    for (let i = 0; i < heights.length; i += chunkSize) {
      const chunk = heights.slice(i, i + chunkSize)
      await pool(
        chunk,
        async h => {
          try {
            const header = await fetchBlockHeader(h)
            headers.set(h, { ...header, miner: null, coinbaseTotal: null, coinbaseOutputs: [] })
          } catch (err) {
            failed++
            log(`WARN height ${h}: ${err.message}`)
          } finally {
            done++
          }
        },
        CONFIG.concurrency
      )
      await flush()
    }
  } catch (err) {
    if (err instanceof StaleActionIdError) {
      await (async () => {
        // Headers already fetched are still useful; persist them without miners.
        const pending = [...headers.values()].filter(h => !h._written)
        if (pending.length) {
          appendBlocks(pending.map(({ _written, ...row }) => row))
          log(`persisted ${pending.length} blocks without coinbase data`)
        }
      })()
      writeCheckpoint({
        lastRunAt: new Date().toISOString(),
        tip,
        status: 'stale-action-id',
        error: 'coinbase lookups failed: action id stale'
      })
      console.error(err.message)
      process.exit(2)
    }
    throw err
  }

  writeCheckpoint({
    lastRunAt: new Date().toISOString(),
    lastIngestedHeight: to,
    tip,
    headersOnly,
    failed,
    status: failed ? 'complete-with-gaps' : 'complete'
  })
  log(`done. ${done - failed} blocks ingested, ${failed} failed.`)
  if (failed) log('re-run to fill gaps; failures are usually explorer rate limiting')
}

main().catch(err => {
  console.error(`\ningestion failed: ${err.message}\n`)
  process.exit(1)
})
