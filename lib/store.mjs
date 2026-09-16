// Local store. Blocks are append-only NDJSON so ingestion is resumable and diffable;
// the checkpoint records how far a run got so an interrupted run resumes without refetching.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(here, '..', 'data')
export const BLOCKS_FILE = path.join(DATA_DIR, 'blocks.ndjson')
export const CHECKPOINT_FILE = path.join(DATA_DIR, 'checkpoint.json')
export const MARKET_FILE = path.join(DATA_DIR, 'market.json')

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

export function readBlocks() {
  if (!existsSync(BLOCKS_FILE)) return []
  const rows = readFileSync(BLOCKS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
  // Last write wins on duplicates (a re-ingested height supersedes the earlier row).
  const byHeight = new Map()
  for (const r of rows) byHeight.set(r.height, r)
  return [...byHeight.values()].sort((a, b) => a.height - b.height)
}

export function appendBlocks(blocks) {
  if (!blocks.length) return
  ensureDir()
  appendFileSync(BLOCKS_FILE, blocks.map(b => JSON.stringify(b)).join('\n') + '\n')
}

export function readCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return null
  try {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'))
  } catch {
    return null
  }
}

export function writeCheckpoint(cp) {
  ensureDir()
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2))
}

export function readMarket() {
  if (!existsSync(MARKET_FILE)) return null
  try {
    return JSON.parse(readFileSync(MARKET_FILE, 'utf8'))
  } catch {
    return null
  }
}

export function writeMarket(m) {
  ensureDir()
  writeFileSync(MARKET_FILE, JSON.stringify(m, null, 2))
}
