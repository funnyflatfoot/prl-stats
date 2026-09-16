// Scraper for explorer.pearlresearch.ai. The explorer is a Next.js app with no public API:
// block headers come out of the RSC payload of the block page, and coinbase outputs come from
// a server action whose id rotates on every explorer redeploy.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
export const CONFIG = JSON.parse(readFileSync(path.join(here, '..', 'config', 'explorer.config.json'), 'utf8'))

export class StaleActionIdError extends Error {
  constructor(detail) {
    super(
      [
        '',
        '  The explorer server action id is stale or wrong.',
        '',
        `  Configured actionId: ${CONFIG.actionId} (captured ${CONFIG.actionIdCapturedAt})`,
        `  Detail: ${detail}`,
        '',
        '  Coinbase outputs cannot be read without it, so ingestion stopped instead of writing',
        '  blocks with missing miners. Rotate it:',
        '',
        '    1. Open https://explorer.pearlresearch.ai/blocks in a browser with DevTools > Network.',
        '    2. Click "View Details" on any block.',
        '    3. Find the POST to /block/<hash>, copy the "next-action" request header value.',
        '    4. Put it in config/explorer.config.json as actionId, update actionIdCapturedAt.',
        '    5. Re-run: npm run ingest',
        '',
        '  Block headers (height, time, difficulty, size, tx_count) do not need the action id;',
        '  run with --headers-only to keep ingesting those while the id is broken.',
        ''
      ].join('\n')
    )
    this.name = 'StaleActionIdError'
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function req(url, init = {}, attempt = 0) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return await res.text()
  } catch (err) {
    if (attempt >= CONFIG.maxRetries) throw err
    await sleep(CONFIG.retryBaseMs * (attempt + 1))
    return req(url, init, attempt + 1)
  } finally {
    clearTimeout(timer)
  }
}

const blockUrl = height => `${CONFIG.baseUrl}/block/${height}?network=${CONFIG.network}`

// The RSC payload embeds the block JSON with escaped quotes: \"height\":111700,...
function readNumber(text, key) {
  const k = `\\"${key}\\":`
  const i = text.indexOf(k)
  if (i < 0) return null
  let j = i + k.length
  let end = j
  while (end < text.length && /[0-9.eE+-]/.test(text[end])) end++
  const v = Number(text.slice(j, end))
  return Number.isFinite(v) ? v : null
}

export function parseBlockHeader(text) {
  const hi = text.indexOf('\\"height\\":')
  if (hi < 0) return null
  const slice = text.slice(Math.max(0, hi - 400), hi + 8000)
  const tx = slice.indexOf('\\"txids\\":[\\"')
  if (tx < 0) return null
  const coinbaseTxid = slice.slice(tx + 13, tx + 77)
  if (!/^[0-9a-f]{64}$/.test(coinbaseTxid)) return null
  const bits = slice.match(/\\"bits\\":\\"([0-9a-fx]+)\\"/)
  const header = {
    height: readNumber(slice, 'height'),
    time: readNumber(slice, 'time'),
    difficulty: readNumber(slice, 'difficulty'),
    size: readNumber(slice, 'size'),
    txCount: readNumber(slice, 'tx_count'),
    bits: bits ? bits[1] : null,
    coinbaseTxid
  }
  if (header.height == null || header.time == null || header.difficulty == null) return null
  return header
}

export async function fetchBlockHeader(height) {
  const text = await req(blockUrl(height))
  const header = parseBlockHeader(text)
  if (!header) throw new Error(`Could not parse block header for height ${height}. The explorer's page shape may have changed.`)
  return header
}

// The tip is published as maxHeight inside any block page's RSC payload.
export async function fetchTipHeight(knownHeight) {
  const text = await req(blockUrl(knownHeight))
  const m = text.match(/\\"maxHeight\\":(\d+)/) || text.match(/"maxHeight":(\d+)/)
  if (!m) throw new Error('Could not read maxHeight from the explorer. Page shape may have changed.')
  return Number(m[1])
}

// Server action: body is [[txid, ...]]; the response carries a line starting 1:{"response":...}
export async function fetchTransactions(txids) {
  const text = await req(blockUrl(CONFIG.startHeight), {
    method: 'POST',
    headers: {
      accept: 'text/x-component',
      'content-type': 'text/plain;charset=UTF-8',
      'next-action': CONFIG.actionId
    },
    body: JSON.stringify([txids])
  })
  if (/Failed to find Server Action/i.test(text)) throw new StaleActionIdError('explorer replied "Failed to find Server Action"')
  const line = text.split('\n').find(l => l.startsWith('1:{"response"'))
  if (!line) throw new StaleActionIdError('no 1:{"response"...} line in the action reply')
  let payload
  try {
    payload = JSON.parse(line.slice(2))
  } catch {
    throw new StaleActionIdError('action reply was not valid JSON')
  }
  if (payload.error) throw new StaleActionIdError(`action returned error: ${JSON.stringify(payload.error)}`)
  if (!Array.isArray(payload.response)) throw new StaleActionIdError('action reply had no response array')
  return payload.response
}

// Coinbase outputs -> { miner, outputs, total }. The largest output is the payout address;
// some pools split a small fee to a second address, which is kept in outputs.
export function coinbaseSummary(tx) {
  const outputs = (tx.vout || [])
    .filter(o => o.amount > 0)
    .map(o => ({ address: (o.addresses || [])[0] || null, amount: o.amount }))
    .sort((a, b) => b.amount - a.amount)
  return {
    miner: outputs.length ? outputs[0].address : null,
    outputs,
    total: tx.total_output ?? outputs.reduce((s, o) => s + o.amount, 0)
  }
}

export async function pool(items, worker, concurrency) {
  let i = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      const item = items[i++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}
