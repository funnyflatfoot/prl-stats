#!/usr/bin/env node
// Moves the chain page's store (data/blocks.ndjson, market.json, checkpoint.json) between the repo checkout and Turso.
//   node scripts/prl-sync-chain.mjs pull   # before ingest: replace data/ with the latest copy in Turso (if any)
//   node scripts/prl-sync-chain.mjs push   # after ingest + market: upload data/ to Turso
// The committed data/ files stay as the fallback the page uses when Turso is not configured.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { ensureFiles, putFile, getFile } from '../lib/db.js'

const FILES = ['blocks.ndjson', 'market.json', 'checkpoint.json']
const mode = process.argv[2]
await ensureFiles()
if (mode === 'pull') {
  for (const f of FILES) {
    const row = await getFile('data/' + f)
    if (!row) { console.log(`pull: no ${f} in db, keeping committed copy`); continue }
    const text = gunzipSync(row.gz).toString('utf8')
    if (f === 'blocks.ndjson' && existsSync('data/' + f)) {
      // keep whichever copy reaches further, so a newer commit is never rolled back by an older db copy
      const last = t => { const lines = t.trim().split('\n'); try { return JSON.parse(lines[lines.length - 1]).height } catch { return 0 } }
      if (last(readFileSync('data/' + f, 'utf8')) > last(text)) { console.log('pull: committed blocks.ndjson is newer, keeping it'); continue }
    }
    writeFileSync('data/' + f, text); console.log(`pull: ${f} ${text.length} bytes (db ${row.updated_at})`)
  }
} else if (mode === 'push') {
  for (const f of FILES) {
    if (!existsSync('data/' + f)) continue
    const text = readFileSync('data/' + f, 'utf8'); await putFile('data/' + f, gzipSync(Buffer.from(text)), text.length); console.log(`push: ${f} ${text.length} bytes`)
  }
} else { console.error('usage: prl-sync-chain.mjs pull|push'); process.exit(1) }
