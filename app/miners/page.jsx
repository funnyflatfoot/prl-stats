import { readFileSync } from 'node:fs'
import path from 'node:path'
import MinersDashboard from '@/components/MinersDashboard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'PRL Miners' }

// data/miner_behavior.json is rewritten every night by the prl-daily workflow, which commits it.
export default function Page() {
  const data = JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'miner_behavior.json'), 'utf8'))
  return <MinersDashboard data={data} />
}
