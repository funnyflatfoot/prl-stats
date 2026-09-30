// Chain page store: the daily job's copy in Turso (files table), else the committed data/ files.
// The db copy is cached in the server process for five minutes so a page view does not refetch 6 MB.
import { readFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { getFile } from '@/lib/db'

const TTL = 300e3
let cache = { at: 0, value: null }

function parseBlocks(text) {
  const byHeight = new Map()
  for (const line of text.split('\n')) {
    if (!line) continue
    try { const b = JSON.parse(line); byHeight.set(b.height, b) } catch { /* skip malformed line */ }
  }
  return [...byHeight.values()].sort((a, b) => a.height - b.height)
}
const local = f => { const p = path.join(process.cwd(), 'data', f); return existsSync(p) ? readFileSync(p, 'utf8') : null }
const json = t => { try { return t ? JSON.parse(t) : null } catch { return null } }

export async function loadChainData() {
  if (process.env.TURSO_DATABASE_URL) {
    if (Date.now() - cache.at < TTL && cache.value) return cache.value
    try {
      const [b, m, c] = await Promise.all([getFile('data/blocks.ndjson'), getFile('data/market.json'), getFile('data/checkpoint.json')])
      if (b) {
        const text = f => (f ? gunzipSync(f.gz).toString('utf8') : null)
        cache = { at: Date.now(), value: { blocks: parseBlocks(text(b)), market: json(text(m)), checkpoint: json(text(c)), source: 'db', updated_at: b.updated_at } }
        return cache.value
      }
    } catch (e) {
      console.error('chain data: db read failed, using committed files', e.message)
    }
  }
  return { blocks: parseBlocks(local('blocks.ndjson') || ''), market: json(local('market.json')), checkpoint: json(local('checkpoint.json')), source: 'snapshot', updated_at: null }
}
