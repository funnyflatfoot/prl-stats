// Public data API: latest miner-behaviour aggregates written by the hourly cron (Vercel Blob).
// Falls back to the committed full-chain snapshot in data/ until the cron has run once.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { blobReadText } from '@/lib/blob'

export const dynamic = 'force-dynamic'

const headers = {
  'content-type': 'application/json',
  'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
  'access-control-allow-origin': '*'
}

export async function GET() {
  let text = null
  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) text = await blobReadText('prl/miner-behavior.json')
  } catch {
    text = null
  }
  if (!text) {
    const snap = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'miner_behavior.json'), 'utf8'))
    text = JSON.stringify({
      height: snap.tip_height,
      time: snap.tip_time,
      generated_at: snap.generated_at,
      source: 'snapshot',
      totals: { miners: snap.totals.miners, paid_to_miners: snap.totals.recv },
      by_reward_week: snap.by_issue_week,
      selling_weekly: snap.selling_weekly,
      miner_balance_weekly: snap.miner_balance_weekly,
      wprl_supply_daily: snap.wprl_supply_daily,
      price_weekly_close: snap.price.weekly_close
    })
  }
  return new Response(text, { headers })
}
