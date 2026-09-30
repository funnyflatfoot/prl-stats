// The miner-behaviour JSON the page and the API serve: the daily job's row in Turso, else the committed snapshot.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getAggregate } from '@/lib/db'

export async function loadMinerBehavior() {
  if (process.env.TURSO_DATABASE_URL) {
    try {
      const a = await getAggregate('miner_behavior')
      if (a) return { data: a.data, source: 'db', updated_at: a.updated_at }
    } catch (e) {
      console.error('miner-behavior: db read failed, using snapshot', e.message)
    }
  }
  const data = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'miner_behavior.json'), 'utf8'))
  return { data, source: 'snapshot', updated_at: data.generated_at }
}
