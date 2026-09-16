#!/usr/bin/env node
// Dependency-free checks on the parsing and maths that the dashboard depends on.
// Runs without npm install: node scripts/selftest.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseBlockHeader } from '../lib/explorer.mjs'
import { derive, rigDay, powerCostPerDay } from '../lib/derive.js'
import { subsidyAt, cumulativeAt } from '../lib/emission.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const constants = JSON.parse(readFileSync(path.join(here, '..', 'config', 'constants.json'), 'utf8'))
const em = constants.emission

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) process.stdout.write(`  ok   ${name}\n`)
  else {
    failures++
    process.stdout.write(`  FAIL ${name} ${detail}\n`)
  }
}

process.stdout.write('\nexplorer payload parsing\n')
const payload = `7:["$","$L19",null,{"maxHeight":111710,"block":{"hash":"9d59c8bd","height":111700,"version":536870912,"merkleroot":"62c74d5f","time":1789136301,"bits":"1800d446","difficulty":20232874.21441979,"size":119604,"tx_count":26,"previousblockhash":"38cdab3f","confirmations":11},"txids":["0c7d579dce5d5bae9024d938f4a06860b253a040ef3a27f4445b376c998d4e72","83fcaceb01431154e62da00f833b7ae20ee5f216af91ad5f0c0fbeb6f49d7212"]}]`.replace(
  /"/g,
  '\\"'
)
const h = parseBlockHeader(payload)
check('height', h?.height === 111700)
check('time', h?.time === 1789136301)
check('difficulty', h?.difficulty === 20232874.21441979)
check('size / tx_count', h?.size === 119604 && h?.txCount === 26)
check('coinbase txid is txids[0]', h?.coinbaseTxid === '0c7d579dce5d5bae9024d938f4a06860b253a040ef3a27f4445b376c998d4e72')
check('junk payload returns null', parseBlockHeader('nothing to see') === null)

process.stdout.write('\nemission\n')
const reward = subsidyAt(111716, em)
check('subsidy at #111,716 matches observed coinbase 2352.0165', Math.abs(reward - 2352.0165) < 0.001, `got ${reward}`)
check('cumulative at #111,716 near 307.9M', Math.abs(cumulativeAt(111716, em) / 1e6 - 307.9) < 0.1)
check('half of supply by block H', Math.abs(cumulativeAt(em.H, em) / em.S - 0.5) < 1e-9)

process.stdout.write('\nderive on synthetic chain (31 days at target block time, two pools)\n')
const start = Date.UTC(2026, 7, 11) / 1000
const blocks = []
let t = start
for (let i = 0; i < 31 * 445; i++) {
  const height = em.supplyBaselineHeight + i
  t += em.targetBlockSeconds
  blocks.push({
    height,
    time: t,
    difficulty: 20e6,
    size: 80000,
    txCount: 5,
    miner: i % 3 === 0 ? 'poolB' : i % 97 === 0 ? null : 'poolA',
    coinbaseTotal: subsidyAt(height, em) + 0.01
  })
}
const days = [...new Set(blocks.map(b => new Date(b.time * 1000).toISOString().slice(0, 10)))]
const market = { fetchedAt: '2026-09-11T15:30:00Z', price: 0.5, days: days.map(d => ({ date: d, price: 0.5, volume: 2e6 })) }
const entities = {
  poolA: { name: 'Pool A', flag: 'verified' },
  poolB: { name: 'Pool B', flag: 'inferred' }
}
const out = derive({ blocks, market, constants, entities })
const day = out.daily[out.daily.length - 2]
const expectedHashrate = (20e6 * Math.pow(2, 48)) / em.targetBlockSeconds / 1e18

check('block time equals target', Math.abs(day.blockTime - em.targetBlockSeconds) < 1e-9, `got ${day.blockTime}`)
check('implied hashrate matches D*2^48/T', Math.abs(day.hashrateEHs - expectedHashrate) < 1e-6)
// The subsidy decays block by block, so compare against the sum rather than blocks x last reward.
const expectedIssuance = Array.from({ length: day.blocks }, (_, i) => subsidyAt(day.lastHeight - i, em) + 0.01).reduce((s, v) => s + v, 0)
check('issuance = sum of per-block subsidies (+fees)', Math.abs(day.issuancePrl - expectedIssuance) < 0.05, `got ${day.issuancePrl}, expected ${expectedIssuance}`)
check('security budget = issuance * price', Math.abs(day.securityUsd - day.issuancePrl * 0.5) < 1e-6)
check('entity stack sums to 100%', Math.abs(Object.values(day.stack).reduce((s, v) => s + v, 0) - 100) < 1e-6)
check('unattributed blocks are their own entity', out.entities.some(e => e.name === 'unattributed' && e.flag === 'unknown'))
check('hashprice = issuance / hashrate(PH/s)', Math.abs(day.hashpricePrl - day.issuancePrl / (day.hashrateEHs * 1000)) < 1e-6)
check('fees are excluded from the supply line', Math.abs(out.daily[1].supplyActual - out.daily[0].supplyActual - out.daily[1].subsidyPrl) < 1e-6)
check('schedule curve is below actual when blocks beat target historically', out.current.supplyGap > 0)

process.stdout.write('\ndata integrity: no unsourced numbers\n')
const banned = ['pressurePct', 'nakamoto', 'attackCostUsd', 'breakEvenUsdPerPhsDay', 'phsPerGpu', 'volAvg']
const leaked = banned.filter(k => k in out.daily[0] || k in out.current)
check('no modelled metrics survive in the output', leaked.length === 0, leaked.join(', '))
check('every constants group carries a source', ['emission', 'hashrate', 'market'].every(g => typeof constants[g].source === 'string' && constants[g].source.length > 20))
check('emission constants match the whitepaper', em.S === 2.1e9 && em.H === 650226 && em.targetBlockSeconds === 194)
check('hashrate convention matches pool dashboards', constants.hashrate.difficultyToWorkExponent === 48 && constants.hashrate.poolDifficultyMultiplier === 65536)

process.stdout.write('\nsynthetic miner\n')
const hardware = JSON.parse(readFileSync(path.join(here, '..', 'config', 'gpus.json'), 'utf8'))
const h100 = hardware.gpus.find(g => g.id === 'h100')
const rig = rigDay(day, { rigPHs: h100.hashratePHs * 10, poolFeePct: 1, powerUsdPerDay: 0 })
check('rig share = rig PH/s / network PH/s', Math.abs(rig.share - (h100.hashratePHs * 10) / (day.hashrateEHs * 1000)) < 1e-12)
check('rig PRL = share x issuance x (1 - fee)', Math.abs(rig.prl - rig.share * day.issuancePrl * 0.99) < 1e-9)
check('rig USD = rig PRL x price', Math.abs(rig.gross - rig.prl * 0.5) < 1e-9)
const withPower = rigDay(day, { rigPHs: h100.hashratePHs * 10, poolFeePct: 1, powerUsdPerDay: 100 })
check('net subtracts power', Math.abs(withPower.net - (rig.gross - 100)) < 1e-9)
check('power cost = kW x 24h x rate', Math.abs(powerCostPerDay({ watts: 700, count: 10, usdPerKwh: 0.1 }) - 16.8) < 1e-9)
check('zero rig returns nulls rather than zeros', rigDay(day, { rigPHs: 0 }).prl === null)
check('every GPU row carries a source', hardware.gpus.every(g => typeof g.source === 'string' && g.source.length > 20))
check('every pool row carries a source and a fee', hardware.pools.every(p => typeof p.source === 'string' && Number.isFinite(p.feePct)))
const power = JSON.parse(readFileSync(path.join(here, '..', 'config', 'electricity.json'), 'utf8'))
const countries = Object.entries(power.prices)
check('electricity table carries source, date and segment', [power.source, power.asOf, power.segment].every(v => typeof v === 'string' && v.length > 3))
check('electricity table covers a useful set of countries', countries.length > 100, `${countries.length} rows`)
check('every country price is a plausible USD/kWh figure', countries.every(([, v]) => v > 0 && v < 2))
check('country price drives power cost', Math.abs(powerCostPerDay({ watts: 700, count: 1, usdPerKwh: power.prices['United States'] }) - 16.8 * power.prices['United States'] / 0.1 / 10) < 1e-9)

process.stdout.write('\nderive with no market data\n')
const noMarket = derive({ blocks, market: null, constants, entities })
check('chain series still computed', noMarket.daily.length === out.daily.length)
check('USD series are null rather than zero', noMarket.daily.every(d => d.securityUsd == null && d.hashpriceUsd == null))

process.stdout.write('\nderive with an empty store\n')
const empty = derive({ blocks: [], market, constants, entities })
check('returns ok:false instead of throwing', empty.ok === false && empty.daily.length === 0)

process.stdout.write(`\n${failures ? `${failures} check(s) failed\n\n` : 'all checks passed\n\n'}`)
process.exit(failures ? 1 : 0)
