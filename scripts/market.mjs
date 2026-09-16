#!/usr/bin/env node
// Market data from CoinGecko: spot snapshot plus daily price and volume history.
// Free tier is rate limited; set COINGECKO_API_KEY for the pro/demo header if you have one.

import { CONFIG } from '../lib/explorer.mjs'
import { writeMarket, readMarket } from '../lib/store.mjs'

const { coingeckoId, vsCurrency, historyDays, apiBase } = CONFIG.market
const key = process.env.COINGECKO_API_KEY

function headers() {
  const h = { accept: 'application/json' }
  if (key) h['x-cg-demo-api-key'] = key
  return h
}

async function get(url) {
  const res = await fetch(url, { headers: headers() })
  if (res.status === 429) throw new Error('CoinGecko rate limited (429). Wait a minute or set COINGECKO_API_KEY.')
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status} for ${url}`)
  return res.json()
}

const dayKey = ms => new Date(ms).toISOString().slice(0, 10)

async function main() {
  const spot = await get(
    `${apiBase}/simple/price?ids=${coingeckoId}&vs_currencies=${vsCurrency}&include_24hr_vol=true&include_market_cap=true&include_24hr_change=true`
  )
  const s = spot[coingeckoId]
  if (!s) throw new Error(`CoinGecko returned no data for id "${coingeckoId}". Check config/explorer.config.json market.coingeckoId.`)

  const chart = await get(`${apiBase}/coins/${coingeckoId}/market_chart?vs_currency=${vsCurrency}&days=${historyDays}&interval=daily`)

  const prices = new Map()
  for (const [ms, v] of chart.prices || []) prices.set(dayKey(ms), v)
  const volumes = new Map()
  for (const [ms, v] of chart.total_volumes || []) volumes.set(dayKey(ms), v)

  const days = [...new Set([...prices.keys(), ...volumes.keys()])].sort().map(d => ({
    date: d,
    price: prices.get(d) ?? null,
    volume: volumes.get(d) ?? null
  }))

  const detail = await get(`${apiBase}/coins/${coingeckoId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`).catch(
    () => null
  )

  const market = {
    fetchedAt: new Date().toISOString(),
    source: 'coingecko',
    id: coingeckoId,
    price: s[vsCurrency] ?? null,
    volume24h: s[`${vsCurrency}_24h_vol`] ?? null,
    marketCap: s[`${vsCurrency}_market_cap`] ?? null,
    change24hPct: s[`${vsCurrency}_24h_change`] ?? null,
    circulatingSupply: detail?.market_data?.circulating_supply ?? null,
    totalSupply: detail?.market_data?.total_supply ?? null,
    days
  }
  writeMarket(market)
  const prev = readMarket()
  process.stdout.write(
    `[market] price ${market.price} ${vsCurrency}, 24h vol ${Math.round(market.volume24h || 0).toLocaleString()}, ${days.length} days of history` +
      (prev?.fetchedAt ? `, previous fetch ${prev.fetchedAt}` : '') +
      '\n'
  )
}

main().catch(err => {
  console.error(`\nmarket fetch failed: ${err.message}\n`)
  process.exit(1)
})
