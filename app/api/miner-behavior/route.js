// Public data API: the miner-behaviour result the daily job committed. Edge-cached 5 minutes.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const dynamic = 'force-dynamic'

export async function GET() {
  const text = await readFile(path.join(process.cwd(), 'data', 'miner_behavior.json'), 'utf8')
  return new Response(text, {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600', 'access-control-allow-origin': '*' }
  })
}
