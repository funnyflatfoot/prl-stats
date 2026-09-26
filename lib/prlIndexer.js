// Incremental PRL miner-behaviour indexer.
// State is address-level, not UTXO-level: for every address that holds miner-origin PRL we keep
//   b   total unspent PRL at the address
//   m   miner-origin unspent PRL at the address
//   rw  m split by reward week   { week: prl }
//   lw  m split by the week it last left a miner address { week: prl }  (departure timing, "first spend")
// A transaction moves m from its inputs to its outputs pro rata (or books it to a sink). Only the frontier is
// stored, so state is a few tens of MB regardless of chain length. Aggregates are appended per week.
// No thresholds, no tunables. Labels come from api.prlscan.com; sink mapping is the same as the batch analysis.

export const W0 = 1777248000; // Mon 2026-04-27 00:00 UTC
export const weekOf = (t) => Math.floor((t - W0) / 604800);
const SINK_KINDS = { pool: 'pool', pearl_trade: 'otc', bridge: 'bridge', bridge_treasury: 'bridge', bridge_fee: 'bridge' };
export function sinkFor(kind, label) {
  if (SINK_KINDS[kind]) return SINK_KINDS[kind];
  if (kind === 'system') { const l = (label || '').toLowerCase(); if (l.includes('safetrade')) return 'safetrade'; if (l.includes('otc')) return 'otcfee'; return 'system'; }
  return null; // pearl_otc seller profiles and unlabelled addresses are ordinary addresses
}

export function emptyState() {
  return { version: 1, height: 0, time: 0, labels: {}, addr: {}, rewardWeek: {}, sellWeek: {}, balanceWeek: {}, wprl: [], price: [] };
}

const PRUNE = 1e-9;
function addMix(dst, src, scale) { for (const k in src) { const v = src[k] * scale; if (v > PRUNE) dst[k] = (dst[k] || 0) + v; } }
function takeMix(src, frac) { const out = {}; for (const k in src) { const v = src[k] * frac; if (v > PRUNE) out[k] = v; src[k] -= v; if (src[k] <= PRUNE) delete src[k]; } return out; }
const wk = (o, w) => (o[w] = o[w] || { emitted: 0, paid: 0, safetrade: 0, otc: 0, bridge: 0, other: 0, moved: 0 });

function ensure(state, a) { return state.addr[a] || (state.addr[a] = { b: 0, m: 0, rw: {}, lw: {}, miner: 0, recv: 0 }); }

/** Apply one confirmed transaction (api.prlscan.com /txs/{txid} shape) at block time t. */
export function applyTx(state, tx, t) {
  const week = weekOf(t);
  const lab = state.labels;
  const sinkOf = (a) => { const L = lab[a]; return L ? sinkFor(L.kind, L.label) : null; };
  const ins = (tx.inputs || []).map((i) => ({ a: i.prev_address, v: i.prev_value_grains / 1e8 }));
  const outs = (tx.outputs || []).filter((o) => o.address && o.value_grains > 0).map((o) => ({ a: o.address, v: o.value_grains / 1e8 }));
  const coinbase = tx.transaction?.is_coinbase || ins.length === 0;
  const RW = wk(state.rewardWeek, week), SW = wk(state.sellWeek, week);

  if (coinbase) {
    for (const o of outs) {
      RW.emitted += o.v;
      const sk = sinkOf(o.a);
      if (sk) continue; // pool coinbase: miner-origin value is created at payout time, not here
      const s = ensure(state, o.a); s.miner = 1; s.recv += o.v; s.b += o.v; s.m += o.v; addMix(s.rw, { [week]: o.v }, 1);
      RW.paid += o.v;
    }
    return;
  }

  // pool payout? (all inputs from one labelled pool address)
  const inSinks = ins.map((i) => sinkOf(i.a));
  const pure = inSinks.every((s) => s === 'pool') && new Set(ins.map((i) => i.a)).size === 1;
  if (pure) {
    const pool = ins[0].a;
    for (const o of outs) {
      if (o.a === pool || sinkOf(o.a)) continue;
      const s = ensure(state, o.a); s.miner = 1; s.recv += o.v; s.b += o.v; s.m += o.v; addMix(s.rw, { [week]: o.v }, 1);
      RW.paid += o.v;
    }
    return;
  }

  // gather miner-origin value entering this tx
  let tot = 0, mv = 0; const rw = {}, lw = {}; const inBySink = {};
  for (const i of ins) {
    tot += i.v;
    const sk = sinkOf(i.a); if (sk) { inBySink[sk] = (inBySink[sk] || 0) + i.v; continue; }
    const s = state.addr[i.a]; if (!s || s.b <= 0) continue;
    const frac = Math.min(1, i.v / s.b);
    const take = s.m * frac; mv += take; s.m -= take; s.b -= i.v; if (s.b < PRUNE) s.b = 0;
    addMix(rw, takeMix(s.rw, frac), 1);
    if (s.miner) { addMix(lw, { [week]: take }, 1); SW.moved += take; } else addMix(lw, takeMix(s.lw, frac), 1); // leaving a miner address stamps the departure week
    if (s.m < PRUNE && s.b < PRUNE && !s.miner) delete state.addr[i.a];
  }
  if (mv <= PRUNE || tot <= 0) return;
  const f = mv / tot;

  // OTC escrow settlement: any output to the Pearl-OTC fee address → whole input is sold OTC
  if (outs.some((o) => sinkOf(o.a) === 'otcfee')) { book(state, 'otc', mv, rw, lw); return; }

  for (const o of outs) {
    const sk = sinkOf(o.a);
    if (sk === 'otcfee') continue;
    if (sk) {
      if (inBySink[sk]) continue; // change back to the same venue, not an arrival
      const share = o.v / tot; const amt = mv * share;
      book(state, sk === 'pool' || sk === 'system' ? 'other' : sk, amt, scaleMix(rw, share), scaleMix(lw, share));
      continue;
    }
    const s = ensure(state, o.a); s.b += o.v; const amt = o.v * f; s.m += amt; addMix(s.rw, rw, o.v / tot); addMix(s.lw, lw, o.v / tot);
  }
  // value that left miner addresses this week and did not hit a sink counts as "moved, not sold" for that departure week
  // value leaving a miner address this week is 'moved'; every later booking to a sink subtracts from it (see book)
}
function scaleMix(m, s) { const o = {}; for (const k in m) o[k] = m[k] * s; return o; }
function book(state, sink, amt, rw, lw) {
  for (const w in rw) wk(state.rewardWeek, w)[sink] += rw[w];
  for (const w in lw) { const r = wk(state.sellWeek, w); r[sink] += lw[w]; r.moved = Math.max(0, r.moved - lw[w]); }
}

/** Call at every block boundary crossing into a new week: snapshot miner balances. */
export function rolloverWeek(state, endedWeek) {
  let bal = 0, balM = 0; for (const a in state.addr) { const s = state.addr[a]; if (s.miner) { bal += s.b; balM += s.m; } }
  state.balanceWeek[endedWeek] = { balance: bal, balance_miner_origin: balM };
}

/** Shape served by the API. */
export function aggregates(state) {
  const weeks = [...new Set([...Object.keys(state.rewardWeek), ...Object.keys(state.sellWeek), ...Object.keys(state.balanceWeek)].map(Number))].sort((a, b) => a - b);
  const price = Object.fromEntries(state.price.map((p) => [p.week, p.close]));
  const by_reward_week = weeks.map((w) => { const r = state.rewardWeek[w] || {}; const paid = r.paid || 0; const sold = (r.safetrade || 0) + (r.otc || 0); return { week: w, week_start: W0 + w * 604800, emitted: r.emitted || 0, paid_to_miners: paid, held: Math.max(0, paid - sold - (r.bridge || 0) - (r.other || 0)), safetrade: r.safetrade || 0, otc: r.otc || 0, bridge: r.bridge || 0, other: r.other || 0, price_close_usd: price[w] ?? null }; });
  const selling_weekly = weeks.map((w) => { const r = state.sellWeek[w] || {}; return { week: w, week_start: W0 + w * 604800, safetrade: r.safetrade || 0, otc: r.otc || 0, bridge: r.bridge || 0, other: r.other || 0, moved_unsold: r.moved || 0, price_close_usd: price[w] ?? null }; });
  let prev = null; const miner_balance_weekly = weeks.filter((w) => state.balanceWeek[w]).map((w) => { const b = state.balanceWeek[w]; const s = state.sellWeek[w] || {}; const sold = (s.safetrade || 0) + (s.otc || 0); const row = { week: w, week_start: W0 + w * 604800, balance: b.balance, balance_miner_origin: b.balance_miner_origin, wow: prev == null ? null : b.balance - prev, sold, sold_to_balance: prev ? sold / prev : null, price_close_usd: price[w] ?? null }; prev = b.balance; return row; });
  let miners = 0, recv = 0; for (const a in state.addr) { const s = state.addr[a]; if (s.miner) { miners++; recv += s.recv; } }
  return { height: state.height, time: state.time, generated_at: new Date().toISOString(), totals: { miners, paid_to_miners: recv }, by_reward_week, selling_weekly, miner_balance_weekly, wprl_supply_daily: state.wprl, price_daily: state.price };
}
