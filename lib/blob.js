// Minimal Vercel Blob client over the REST API, so no new dependency touches package-lock.
// Env: BLOB_READ_WRITE_TOKEN (created with the Blob store in the Vercel dashboard, Storage tab).
const BASE = 'https://blob.vercel-storage.com'
const token = () => {
  const t = process.env.BLOB_READ_WRITE_TOKEN
  if (!t) throw new Error('BLOB_READ_WRITE_TOKEN is not set')
  return t
}

export async function blobFind(pathname) {
  const r = await fetch(`${BASE}?prefix=${encodeURIComponent(pathname)}&limit=1`, {
    headers: { authorization: `Bearer ${token()}`, 'x-api-version': '7' },
    cache: 'no-store'
  })
  if (!r.ok) throw new Error(`blob list ${r.status}`)
  const j = await r.json()
  return (j.blobs || []).find(b => b.pathname === pathname) || null
}

export async function blobReadJson(pathname) {
  const b = await blobFind(pathname)
  if (!b) return null
  const r = await fetch(b.url, { cache: 'no-store' })
  return r.ok ? r.json() : null
}

export async function blobReadText(pathname) {
  const b = await blobFind(pathname)
  if (!b) return null
  const r = await fetch(b.url, { cache: 'no-store' })
  return r.ok ? r.text() : null
}

export async function blobWriteJson(pathname, obj) {
  const r = await fetch(`${BASE}/${pathname}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token()}`,
      'x-api-version': '7',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '60'
    },
    body: JSON.stringify(obj)
  })
  if (!r.ok) throw new Error(`blob put ${r.status} ${await r.text()}`)
  return r.json()
}
