import MinersDashboard from '@/components/MinersDashboard'
import { loadMinerBehavior } from '@/lib/minerBehavior'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'PRL Miners' }

// Same JSON the API serves: the daily job's output from Turso, else the committed snapshot.
export default async function Page() {
  const { data, source, updated_at } = await loadMinerBehavior()
  return <MinersDashboard data={data} live={source === 'db' ? { updated_at } : null} />
}
