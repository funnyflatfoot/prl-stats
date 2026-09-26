// Hourly cron: advance the miner-behaviour state from api.prlscan.com, refresh price and WPRL supply,
// store state + aggregates in Vercel Blob. Time-boxed so it fits a serverless invocation; it resumes next run.
// Env: BLOB_READ_WRITE_TOKEN (Vercel Blob), CRON_SECRET. Optional: PRL_INDEX_BUDGET_MS (default 50000).
import { blobReadJson, blobWriteJson } from '@/lib/blob';
import { emptyState, applyTx, rolloverWeek, aggregates, weekOf, W0 } from '@/lib/prlIndexer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const API = 'https://api.prlscan.com/v1';
const STATE_KEY = 'prl/miner-state.json';
const AGG_KEY = 'prl/miner-behavior.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { cache: 'no-store' });
    if (r.status === 200) return r.json();
    if (r.status === 404) return null;
    await sleep(800 * (i + 1));
  }
  throw new Error('fetch failed ' + url);
}

async function refreshLabels(state) {
  const labels = {};
  const Q = '?';
  let cursor = null;
  for (let p = 0; p < 40; p++) { // labelled addresses sit near the top of the rich list; 4,000 rows is ample
    const d = await getJson(API + '/holders' + Q + 'limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (!d) break;
    for (const it of d.items) if (it.label_kind) labels[it.address] = { kind: it.label_kind, label: it.label };
    if (!d.next_cursor || !d.items.length) break; cursor = d.next_cursor; await sleep(150);
  }
  for (const it of ((await getJson(API + '/miners')) || {}).items || []) if (it.label_kind) labels[it.address] = { kind: it.label_kind, label: it.label };
  for (const it of ((await getJson(API + '/pools')) || {}).items || []) if (it.address && !labels[it.address]) labels[it.address] = { kind: 'pool', label: it.name };
  state.labels = labels; state.labelsAt = Date.now();
}

async function refreshPrice(state) {
  const h = await getJson(API + '/market/prl/history?days=45&bucket=day');
  if (!h) return;
  const rows = new Map(state.price.map((p) => [p.date, p]));
  for (const b of h.buckets) {
    const date = b.time.slice(0, 10);
    const price = b.safetrade_price_usd || b.coinmarketcap_price_usd || b.pearl_otc_vwap_usd || null;
    if (price) rows.set(date, { date, price_usd: price, source: b.safetrade_price_usd ? 'safetrade' : b.coinmarketcap_price_usd ? 'coinmarketcap' : 'pearl_otc_vwap', week: weekOf(Date.parse(b.time) / 1000) });
  }
  state.price = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  // weekly close = last daily price in the week
  const byWeek = {}; for (const p of state.price) byWeek[p.week] = p.price_usd;
  state.price.forEach((p) => { p.close = byWeek[p.week]; });
}

async function refreshWprl(state) {
  // Blockscout: recent mint/burn transfers of the WPRL ERC-20; walk back only until we reach a day we already hold.
  const C = '0x07696DcaB55E62cfef953666b29Fe1970518cB00', Z = '0x0000000000000000000000000000000000000000';
  const have = new Map(state.wprl.map((d) => [d.date, d]));
  const lastDate = state.wprl.length ? state.wprl[state.wprl.length - 1].date : null;
  const days = {}; let np = null;
  for (let p = 0; p < 60; p++) {
    let u = `https://eth.blockscout.com/api/v2/addresses/${Z}/token-transfers?token=${C}`;
    if (np) u += '&' + Object.entries(np).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const j = await getJson(u); if (!j) break;
    let stop = false;
    for (const t of j.items) {
      const d = t.timestamp.slice(0, 10); if (lastDate && d < lastDate) { stop = true; break; }
      const v = Number(t.total.value) / 1e8; const g = (days[d] = days[d] || { minted: 0, burned: 0 });
      if (t.from.hash.toLowerCase() === Z) g.minted += v; else g.burned += v;
    }
    np = j.next_page_params; if (stop || !np) break; await sleep(250);
  }
  for (const d of Object.keys(days)) have.set(d, { date: d, minted: days[d].minted, burned: days[d].burned });
  const rows = [...have.values()].sort((a, b) => a.date.localeCompare(b.date)); let cum = 0;
  for (const r of rows) { cum += r.minted - r.burned; r.supply = cum; }
  state.wprl = rows;
}

export async function GET(req) {
  if (process.env.CRON_SECRET && req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('unauthorized', { status: 401 });
  const t0 = Date.now(); const budget = Number(process.env.PRL_INDEX_BUDGET_MS || 50000);
  const state = (await blobReadJson(STATE_KEY)) || emptyState();
  if (!state.labelsAt || Date.now() - state.labelsAt > 86400e3) await refreshLabels(state);

  const status = await getJson(API + '/status');
  const tip = status.indexed_height;
  let h = state.height + 1, blocks = 0, txs = 0;
  while (h <= tip && Date.now() - t0 < budget) {
    const b = await getJson(API + '/blocks/' + h); if (!b) break;
    const t = Date.parse(b.block.time) / 1000;
    if (state.time && weekOf(t) > weekOf(state.time)) rolloverWeek(state, weekOf(state.time));
    for (const tx of b.transactions) {
      const d = await getJson(API + '/txs/' + tx.txid); await sleep(120);
      applyTx(state, d, t); txs++;
    }
    state.height = h; state.time = t; h++; blocks++;
  }
  const caughtUp = state.height >= tip;
  if (caughtUp && Date.now() - t0 < budget - 15000) { await refreshPrice(state); await refreshWprl(state); }
  await blobWriteJson(STATE_KEY, state);
  const agg = aggregates(state); agg.caught_up = caughtUp; agg.tip = tip;
  await blobWriteJson(AGG_KEY, agg);
  return Response.json({ ok: true, height: state.height, tip, blocks, txs, caughtUp, ms: Date.now() - t0 });
}
