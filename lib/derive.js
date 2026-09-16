// Every series on the dashboard is computed here from (blocks, market, constants).
// Rule for this file: a number either comes off the chain, comes off the market feed, or is a
// protocol constant listed in config/constants.json with a source. Nothing is modelled, assumed
// or tuned. If a metric cannot be built that way it does not belong on the dashboard.

import { subsidyAt, cumulativeAt, scheduledSupplyAtTime } from './emission.js'

const DAY = 86400
const dayKey = unix => new Date(unix * 1000).toISOString().slice(0, 10)

export function entityFor(address, entities) {
  if (!address) return { name: 'unattributed', flag: 'unknown', address: null }
  const e = entities[address]
  if (e) return { name: e.name, flag: e.flag, address, evidence: e.evidence }
  return { name: `${address.slice(0, 10)}…${address.slice(-4)}`, flag: 'unknown', address }
}

// Synthetic miner: what a rig of known hashrate would have taken out of each day's issuance.
// Everything except the operator's own power price comes from the chain or a sourced benchmark.
export function rigDay(day, { rigPHs, poolFeePct = 0, powerUsdPerDay = 0 }) {
  if (!day.hashratePHs || !rigPHs) return { share: null, prl: null, gross: null, net: null }
  const share = rigPHs / day.hashratePHs
  const prl = share * day.issuancePrl * (1 - poolFeePct / 100)
  const gross = day.price != null ? prl * day.price : null
  return { share, prl, gross, net: gross == null ? null : gross - powerUsdPerDay }
}

export function powerCostPerDay({ watts, count, usdPerKwh }) {
  return ((watts * count) / 1000) * 24 * (usdPerKwh || 0)
}

export function derive({ blocks, market, constants, entities }) {
  const em = constants.emission
  const out = {
    ok: blocks.length > 0,
    meta: {
      blockCount: blocks.length,
      firstHeight: blocks.length ? blocks[0].height : null,
      lastHeight: blocks.length ? blocks[blocks.length - 1].height : null,
      lastTime: blocks.length ? blocks[blocks.length - 1].time : null,
      minersMissing: blocks.filter(b => !b.miner).length,
      marketFetchedAt: market?.fetchedAt || null
    },
    daily: [],
    entities: [],
    entityKeys: [],
    current: {}
  }
  if (!blocks.length) return out

  const priceByDay = new Map((market?.days || []).map(d => [d.date, d.price]))

  const buckets = new Map()
  let prevTime = null
  let cumulativeSubsidy = 0
  const baseline = cumulativeAt(em.supplyBaselineHeight, em)

  for (const b of blocks) {
    const k = dayKey(b.time)
    if (!buckets.has(k)) {
      buckets.set(k, {
        date: k,
        blocks: 0,
        intervalSeconds: 0,
        intervalBlocks: 0,
        difficultySum: 0,
        subsidy: 0,
        coinbaseTotal: 0,
        fees: 0,
        txCount: 0,
        sizeSum: 0,
        byEntity: new Map(),
        firstHeight: b.height,
        lastTime: b.time,
        lastHeight: b.height
      })
    }
    const d = buckets.get(k)
    const subsidy = subsidyAt(b.height, em)
    cumulativeSubsidy += subsidy
    d.blocks++
    d.difficultySum += b.difficulty
    d.subsidy += subsidy
    d.coinbaseTotal += b.coinbaseTotal ?? subsidy
    d.fees += (b.coinbaseTotal ?? subsidy) - subsidy
    d.txCount += Math.max(0, (b.txCount ?? 1) - 1)
    d.sizeSum += b.size || 0
    d.lastTime = b.time
    d.lastHeight = b.height
    d.supplyActual = baseline + cumulativeSubsidy
    // Block time comes from observed intervals, so partial days at the edges of the ingested
    // range are handled without inventing coverage.
    if (prevTime != null) {
      const dt = b.time - prevTime
      if (dt > 0 && dt < 6 * 3600) {
        d.intervalSeconds += dt
        d.intervalBlocks++
      }
    }
    prevTime = b.time
    const ent = entityFor(b.miner, entities)
    d.byEntity.set(ent.name, (d.byEntity.get(ent.name) || 0) + 1)
  }

  const days = [...buckets.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
  const expo = constants.hashrate.difficultyToWorkExponent

  days.forEach((d, i) => {
    const avgDifficulty = d.difficultySum / d.blocks
    const blockTime = d.intervalBlocks ? d.intervalSeconds / d.intervalBlocks : null
    const hashrateHs = blockTime ? (avgDifficulty * Math.pow(2, expo)) / blockTime : null
    const hashratePHs = hashrateHs != null ? hashrateHs / 1e15 : null
    const price = priceByDay.get(d.date) ?? null
    const issuancePrl = d.coinbaseTotal
    const hashpricePrl = hashratePHs ? issuancePrl / hashratePHs : null
    const partial = i === 0 || i === days.length - 1 || d.intervalSeconds < DAY * 0.8

    out.daily.push({
      date: d.date,
      blocks: d.blocks,
      firstHeight: d.firstHeight,
      lastHeight: d.lastHeight,
      lastTime: d.lastTime,
      partial,
      avgDifficulty,
      blockTime,
      hashrateEHs: hashrateHs != null ? hashrateHs / 1e18 : null,
      hashratePHs,
      issuancePrl,
      subsidyPrl: d.subsidy,
      feesPrl: d.fees,
      txCount: d.txCount,
      avgSizeKb: d.sizeSum / d.blocks / 1000,
      price,
      securityUsd: price != null ? issuancePrl * price : null,
      supplyActual: d.supplyActual,
      supplySchedule: scheduledSupplyAtTime(d.lastTime, em),
      hashpricePrl,
      hashpriceUsd: hashpricePrl != null && price != null ? hashpricePrl * price : null,
      entityShares: Object.fromEntries([...d.byEntity.entries()].map(([k, v]) => [k, (v / d.blocks) * 100])),
      entityBlocks: Object.fromEntries(d.byEntity.entries())
    })
  })

  // Entity table over a trailing 7 days of ingested blocks.
  const since = out.meta.lastTime - 7 * DAY
  const recent = blocks.filter(b => b.time >= since)
  const byEntity = new Map()
  for (const b of recent) {
    const ent = entityFor(b.miner, entities)
    if (!byEntity.has(ent.name)) {
      byEntity.set(ent.name, {
        name: ent.name,
        flag: ent.flag,
        address: ent.address,
        evidence: ent.evidence || null,
        blocks7d: 0,
        prl7d: 0,
        lastHeight: 0,
        lastTime: 0
      })
    }
    const e = byEntity.get(ent.name)
    e.blocks7d++
    e.prl7d += b.coinbaseTotal ?? subsidyAt(b.height, em)
    if (b.height > e.lastHeight) {
      e.lastHeight = b.height
      e.lastTime = b.time
    }
  }
  const total7d = recent.length || 1
  out.entities = [...byEntity.values()]
    .map(e => ({ ...e, sharePct: (e.blocks7d / total7d) * 100 }))
    .sort((a, b) => b.blocks7d - a.blocks7d)

  // Stack keys: top entities by 7d share, the rest folded into Other.
  const TOP = 6
  const ranked = out.entities.slice(0, TOP).map(e => e.name)
  const otherCount = Math.max(0, out.entities.length - ranked.length)
  out.entityKeys = otherCount ? [...ranked, `Other (${otherCount})`] : ranked
  const otherKey = otherCount ? `Other (${otherCount})` : null
  for (const row of out.daily) {
    const packed = {}
    let other = 0
    for (const [name, sharePct] of Object.entries(row.entityShares)) {
      if (ranked.includes(name)) packed[name] = sharePct
      else other += sharePct
    }
    for (const name of ranked) if (!(name in packed)) packed[name] = 0
    if (otherKey) packed[otherKey] = other
    row.stack = packed
  }

  const last = out.daily[out.daily.length - 1]
  const lastFull = [...out.daily].reverse().find(d => !d.partial) || last
  const lastBlock = blocks[blocks.length - 1]

  out.current = {
    height: lastBlock.height,
    time: lastBlock.time,
    difficulty: lastBlock.difficulty,
    poolDifficulty: lastBlock.difficulty * constants.hashrate.poolDifficultyMultiplier,
    blockTime: lastFull.blockTime,
    blockTimeDate: lastFull.date,
    targetBlockSeconds: em.targetBlockSeconds,
    hashrateEHs: lastFull.hashrateEHs,
    price: market?.price ?? lastFull.price ?? null,
    priceDate: market?.days?.length ? market.days[market.days.length - 1].date : null,
    issuancePrl: lastFull.issuancePrl,
    feesPrl: lastFull.feesPrl,
    securityUsd: lastFull.securityUsd,
    supplyActual: last.supplyActual,
    supplySchedule: last.supplySchedule,
    supplyGap: last.supplyActual - last.supplySchedule,
    supplyGapPct: last.supplySchedule ? ((last.supplyActual - last.supplySchedule) / last.supplySchedule) * 100 : null,
    hashpricePrl: lastFull.hashpricePrl,
    hashpriceUsd: lastFull.hashpriceUsd,
    largestSharePct: out.entities[0]?.sharePct ?? null,
    largestName: out.entities[0]?.name ?? null,
    topTwoPct: (out.entities[0]?.sharePct || 0) + (out.entities[1]?.sharePct || 0),
    entityCount: out.entities.length
  }

  return out
}
