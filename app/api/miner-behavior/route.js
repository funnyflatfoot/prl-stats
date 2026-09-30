// Public data API: latest miner-behaviour JSON (Turso `aggregates`, key miner_behavior; snapshot fallback). Edge-cached 5 min.
import { loadMinerBehavior } from '@/lib/minerBehavior'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { data, source, updated_at } = await loadMinerBehavior()
  return new Response(JSON.stringify({ ...data, source, updated_at }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600', 'access-control-allow-origin': '*' }
  })
}
