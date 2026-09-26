// One-off bootstrap. Paste into the console of the explorer.pearlresearch.ai tab that holds the IndexedDB dump.
// Replays the whole chain through the same engine as lib/prlIndexer.js and downloads prl-state.json.
// (Engine duplicated inline because the console has no imports; keep in sync with lib/prlIndexer.js.)
(async () => {
  const W0 = 1777248000, weekOf = (t) => Math.floor((t - W0) / 604800), PRUNE = 1e-9;
  const SINK_KINDS = { pool: 'pool', pearl_trade: 'otc', bridge: 'bridge', bridge_treasury: 'bridge', bridge_fee: 'bridge' };
  const sinkFor = (k, l) => SINK_KINDS[k] || (k === 'system' ? ((l || '').toLowerCase().includes('safetrade') ? 'safetrade' : (l || '').toLowerCase().includes('otc') ? 'otcfee' : 'system') : null);
  const addMix = (d, s, sc) => { for (const k in s) { const v = s[k] * sc; if (v > PRUNE) d[k] = (d[k] || 0) + v; } };
  const takeMix = (s, f) => { const o = {}; for (const k in s) { const v = s[k] * f; if (v > PRUNE) o[k] = v; s[k] -= v; if (s[k] <= PRUNE) delete s[k]; } return o; };
  const scaleMix = (m, s) => { const o = {}; for (const k in m) o[k] = m[k] * s; return o; };
  const wk = (o, w) => (o[w] = o[w] || { emitted: 0, paid: 0, safetrade: 0, otc: 0, bridge: 0, other: 0, moved: 0 });
  const state = { version: 1, height: 0, time: 0, labels: {}, addr: {}, rewardWeek: {}, sellWeek: {}, balanceWeek: {}, wprl: [], price: [] };
  const ensure = (a) => state.addr[a] || (state.addr[a] = { b: 0, m: 0, rw: {}, lw: {}, miner: 0, recv: 0 });
  const sinkOf = (a) => { const L = state.labels[a]; return L ? sinkFor(L.kind, L.label) : null; };
  const book = (sink, amt, rw, lw) => { for (const w in rw) wk(state.rewardWeek, w)[sink] += rw[w]; for (const w in lw) { const r = wk(state.sellWeek, w); r[sink] += lw[w]; r.moved = Math.max(0, r.moved - lw[w]); } };
  function applyTx(ins, outs, coinbase, t) {
    const week = weekOf(t); const RW = wk(state.rewardWeek, week), SW = wk(state.sellWeek, week);
    if (coinbase) { for (const o of outs) { RW.emitted += o.v; if (sinkOf(o.a)) continue; const s = ensure(o.a); s.miner = 1; s.recv += o.v; s.b += o.v; s.m += o.v; addMix(s.rw, { [week]: o.v }, 1); RW.paid += o.v; } return; }
    const pure = ins.every((i) => sinkOf(i.a) === 'pool') && new Set(ins.map((i) => i.a)).size === 1;
    if (pure) { const pool = ins[0].a; for (const o of outs) { if (o.a === pool || sinkOf(o.a)) continue; const s = ensure(o.a); s.miner = 1; s.recv += o.v; s.b += o.v; s.m += o.v; addMix(s.rw, { [week]: o.v }, 1); RW.paid += o.v; } return; }
    let tot = 0, mv = 0; const rw = {}, lw = {}, inBySink = {};
    for (const i of ins) { tot += i.v; const sk = sinkOf(i.a); if (sk) { inBySink[sk] = (inBySink[sk] || 0) + i.v; continue; } const s = state.addr[i.a]; if (!s || s.b <= 0) continue; const frac = Math.min(1, i.v / s.b); const take = s.m * frac; mv += take; s.m -= take; s.b -= i.v; if (s.b < PRUNE) s.b = 0; addMix(rw, takeMix(s.rw, frac), 1); if (s.miner) { addMix(lw, { [week]: take }, 1); SW.moved += take; } else addMix(lw, takeMix(s.lw, frac), 1); if (s.m < PRUNE && s.b < PRUNE && !s.miner) delete state.addr[i.a]; }
    if (mv <= PRUNE || tot <= 0) return; const f = mv / tot;
    if (outs.some((o) => sinkOf(o.a) === 'otcfee')) { book('otc', mv, rw, lw); return; }
    for (const o of outs) { const sk = sinkOf(o.a); if (sk === 'otcfee') continue; if (sk) { if (inBySink[sk]) continue; const share = o.v / tot, amt = mv * share; book(sk === 'pool' || sk === 'system' ? 'other' : sk, amt, scaleMix(rw, share), scaleMix(lw, share)); continue; } const s = ensure(o.a); s.b += o.v; s.m += o.v * f; addMix(s.rw, rw, o.v / tot); addMix(s.lw, lw, o.v / tot); }
  }
  const rollover = (w) => { let bal = 0, balM = 0; for (const a in state.addr) { const s = state.addr[a]; if (s.miner) { bal += s.b; balM += s.m; } } state.balanceWeek[w] = { balance: bal, balance_miner_origin: balM }; };

  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('prlscrape', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = async (k) => { const db = await idb(); const v = await new Promise((res, rej) => { const q = db.transaction('chunks').objectStore('chunks').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); db.close(); return v; };
  const lab = JSON.parse(await get('labels'));
  for (const it of lab.holders || []) if (it.label_kind) state.labels[it.address] = { kind: it.label_kind, label: it.label };
  for (const it of (lab.miners && lab.miners.items) || []) if (it.label_kind) state.labels[it.address] = { kind: it.label_kind, label: it.label };
  for (const it of (lab.pools && lab.pools.items) || []) if (it.address && !state.labels[it.address]) state.labels[it.address] = { kind: 'pool', label: it.name };
  state.labelsAt = Date.now();

  const outByTx = new Map(); // txid -> [[addr, amt]] for input resolution
  let curT = 0, curH = 0;
  for (let c = 0; ; c++) {
    const text = await get(c); if (text === undefined) break;
    let p = 0;
    while (p < text.length) {
      let e = text.indexOf('\n', p); if (e < 0) e = text.length;
      if (e > p) {
        const r = JSON.parse(text.slice(p, e));
        if (r.x === undefined) { if (curT && weekOf(r.t) > weekOf(curT)) rollover(weekOf(curT)); curT = r.t; curH = r.b; }
        else {
          outByTx.set(r.x, r.vout);
          const ins = r.vin.map(([ptx, pv]) => { const o = outByTx.get(ptx)[pv]; return { a: o[0], v: +o[1] }; });
          const outs = r.vout.filter(([a, v]) => a && v > 0).map(([a, v]) => ({ a, v: +v }));
          applyTx(ins, outs, !!r.cb, curT);
        }
      }
      p = e + 1;
    }
    console.log('chunk', c, 'height', curH, 'addrs', Object.keys(state.addr).length);
    await new Promise((res) => setTimeout(res, 0));
  }
  state.height = curH; state.time = curT;
  const text = JSON.stringify(state);
  console.log('state bytes', text.length, 'height', curH);
  const a = document.createElementNS('http://www.w3.org/1999/xhtml', 'a'); a.setAttribute('href', URL.createObjectURL(new Blob([text], { type: 'application/json' }))); a.setAttribute('download', 'prl-state.json'); document.documentElement.appendChild(a); a.dispatchEvent(new MouseEvent('click', { bubbles: true })); a.remove();
})();
