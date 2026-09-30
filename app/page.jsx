import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import Dashboard from '@/components/Dashboard'
import EmptyState from '@/components/EmptyState'
import { loadChainData } from '@/lib/chainData'

export const dynamic = 'force-dynamic'

function readJson(p, fallback = null) {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback
  } catch {
    return fallback
  }
}

export default async function Page() {
  const root = process.cwd()
  // blocks, market and checkpoint: the daily job's copy in Turso, else the committed data/ files
  const { blocks, market, checkpoint } = await loadChainData()
  const constants = readJson(path.join(root, 'config', 'constants.json'))
  const entities = readJson(path.join(root, 'config', 'entities.json'), { entities: {} }).entities
  const events = readJson(path.join(root, 'config', 'events.json'), { events: [] }).events
  const hardware = readJson(path.join(root, 'config', 'gpus.json'), { gpus: [], pools: [] })
  const electricity = readJson(path.join(root, 'config', 'electricity.json'), { prices: {} })
  const explorer = readJson(path.join(root, 'config', 'explorer.config.json'))
  const overhead = readJson(path.join(root, 'config', 'overhead.json'))

  if (!blocks.length) {
    return <EmptyState checkpoint={checkpoint} startHeight={explorer?.startHeight ?? 99000} />
  }

  // Compact wire format: [height, time, difficulty, size, txCount, minerIndex, coinbaseTotal]
  const minerList = [...new Set(blocks.map(b => b.miner).filter(Boolean))]
  const minerIndex = new Map(minerList.map((m, i) => [m, i]))
  const packed = blocks.map(b => [
    b.height,
    b.time,
    b.difficulty,
    b.size ?? 0,
    b.txCount ?? 1,
    b.miner ? minerIndex.get(b.miner) : -1,
    b.coinbaseTotal ?? null
  ])

  return (
    <Dashboard
      packed={packed}
      miners={minerList}
      market={market}
      checkpoint={checkpoint}
      constants={constants}
      entities={entities}
      events={events}
      hardware={hardware}
      electricity={electricity}
      overhead={overhead}
      explorer={{ baseUrl: explorer?.baseUrl, startHeight: explorer?.startHeight, actionIdCapturedAt: explorer?.actionIdCapturedAt }}
    />
  )
}
