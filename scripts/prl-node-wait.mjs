#!/usr/bin/env node
// Wait for a local pearld to finish initial sync. Exits 0 when it is at the chain tip, 3 if the
// budget runs out first (the caller then leaves the published data alone and tries again next run).
// Env: PRL_RPC, PRL_RPC_USER, PRL_RPC_PASS, PRL_WAIT_BUDGET_MS (default 3 h).
import { rpc } from './prl-node-dump.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const budget = Number(process.env.PRL_WAIT_BUDGET_MS || 3 * 3600e3)
const t0 = Date.now()

// Wait for the RPC to answer at all (the node opens its port before it is useful).
let up = false
for (let i = 0; i < 60 && !up; i++) {
  try { await rpc('getblockcount', [], 1); up = true } catch { await sleep(5000) }
}
if (!up) { console.error('pearld RPC never came up'); process.exit(3) }

let last = -1, lastMove = Date.now(), target = 0
while (Date.now() - t0 < budget) {
  const h = await rpc('getblockcount')
  // Peers advertise their height, which gives a real target instead of guessing from a stall.
  try { for (const p of await rpc('getpeerinfo')) target = Math.max(target, p.startingheight || p.currentheight || 0) } catch {}
  if (h > last) { lastMove = Date.now(); const rate = (h - Math.max(last, 0)) / 20; log(`height ${h}${target ? ` / ${target}` : ''} (${rate.toFixed(0)} blk/s)`); last = h }
  if (target && h >= target) { log(`synced to #${h} in ${((Date.now() - t0) / 60e3).toFixed(1)} min`); process.exit(0) }
  // No peer target: treat six quiet minutes at a plausible height as done.
  if (!target && h > 1000 && Date.now() - lastMove > 6 * 60e3) { log(`height steady at #${h}, treating as synced`); process.exit(0) }
  await sleep(20000)
}
log(`budget reached at height ${last}${target ? ` of ${target}` : ''}; will resume next run`)
process.exit(3)
