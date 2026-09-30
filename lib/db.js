// Turso (libSQL) over its HTTP pipeline API. No SDK, so package-lock stays untouched.
// Env: TURSO_DATABASE_URL (libsql://... or https://...), TURSO_AUTH_TOKEN.
const base = () => {
  const u = process.env.TURSO_DATABASE_URL
  if (!u) throw new Error('TURSO_DATABASE_URL is not set')
  return u.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '')
}
const arg = v =>
  v == null ? { type: 'null' } :
  typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }) :
  v instanceof Uint8Array ? { type: 'blob', base64: Buffer.from(v).toString('base64') } :
  { type: 'text', value: String(v) }
const val = c => (c == null ? null : c.type === 'integer' ? Number(c.value) : c.type === 'float' ? c.value : c.type === 'blob' ? Buffer.from(c.base64, 'base64') : c.type === 'null' ? null : c.value)

/** Run statements in one round trip. Each item: [sql, args?]. Returns one {cols, rows} per statement. */
export async function batch(stmts, { tries = 4 } = {}) {
  const body = JSON.stringify({ requests: [...stmts.map(([sql, args = []]) => ({ type: 'execute', stmt: { sql, args: args.map(arg) } })), { type: 'close' }] })
  let last
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${base()}/v2/pipeline`, { method: 'POST', headers: { authorization: `Bearer ${process.env.TURSO_AUTH_TOKEN}`, 'content-type': 'application/json' }, body, cache: 'no-store' })
    if (r.ok) {
      const j = await r.json()
      return j.results.slice(0, stmts.length).map((res, k) => {
        if (res.type !== 'ok') throw new Error(`sql error in statement ${k}: ${res.error?.message}`)
        const cols = res.response.result.cols.map(c => c.name)
        return { cols, rows: res.response.result.rows.map(row => Object.fromEntries(row.map((c, i) => [cols[i], val(c)]))) }
      })
    }
    last = `${r.status} ${await r.text()}`
    if (r.status < 500 && r.status !== 429) break
    await new Promise(res => setTimeout(res, 800 * (i + 1)))
  }
  throw new Error(`turso ${last}`)
}
export const query = async (sql, args) => (await batch([[sql, args]]))[0]

export async function ensureSchema() {
  await batch([
    ['CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, blocks_to INTEGER NOT NULL, bytes INTEGER NOT NULL, gz BLOB NOT NULL)'],
    ['CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'],
    ['CREATE TABLE IF NOT EXISTS aggregates (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)']
  ])
}
export async function getMeta(key) {
  const r = await query('SELECT value FROM meta WHERE key = ?', [key])
  return r.rows.length ? r.rows[0].value : null
}
export const setMeta = (key, value) => query('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)])
export const putAggregate = (key, obj) => query('INSERT INTO aggregates (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at', [key, JSON.stringify(obj), new Date().toISOString()])
export async function getAggregate(key) {
  const r = await query('SELECT json, updated_at FROM aggregates WHERE key = ?', [key])
  return r.rows.length ? { data: JSON.parse(r.rows[0].json), updated_at: r.rows[0].updated_at } : null
}
