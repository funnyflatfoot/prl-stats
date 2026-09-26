import { readFileSync } from 'node:fs'
import path from 'node:path'
import MinersDashboard from '@/components/MinersDashboard'
import { blobReadJson } from '@/lib/blob'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'PRL Miners' }

// The committed snapshot is the full-chain fate walk (all sections). When the hourly cron has run,
// its aggregates replace the weekly series so the page moves with the chain; the size-bucket
// sections stay on the snapshot until scripts/analyze-browser.js is re-run.
async function liveAggregates() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null
  try {
    return await blobReadJson('prl/miner-behavior.json')
  } catch {
    return null
  }
}

export default async function Page() {
  const data = JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'miner_behavior.json'), 'utf8'))
  const live = await liveAggregates()
  let liveMeta = null
  if (live && live.height >= data.tip_height && Array.isArray(live.by_reward_week) && live.by_reward_week.length) {
    data.by_issue_week = live.by_reward_week
    data.selling_weekly = live.selling_weekly
    data.miner_balance_weekly = live.miner_balance_weekly
    if (Array.isArray(live.wprl_supply_daily) && live.wprl_supply_daily.length) {
      data.wprl_supply_daily = live.wprl_supply_daily
      data.wprl.total_supply_now = live.wprl_supply_daily[live.wprl_supply_daily.length - 1].supply
    }
    liveMeta = { height: live.height, time: live.time }
  }
  return <MinersDashboard data={data} live={liveMeta} />
}
