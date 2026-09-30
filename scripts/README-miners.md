# Miners page: data setup

1. turso.tech → create a database `prl` (free tier). Copy its URL (`libsql://…turso.io`) and create an auth token.
2. GitHub repo → Settings → Secrets and variables → Actions: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
   Vercel project → Settings → Environment Variables: the same two.
3. GitHub → Actions → `prl-daily` → Run workflow. The first run backfills the chain from block 1
   (about 4 h); if it stops early, run it again and it resumes. Every later run is the 03:10 UTC schedule.
4. When a run finishes, `/miners` shows "Refresh: daily · <time>" in the header and `/api/miner-behavior`
   returns `"source":"db"`. Until then both serve the committed snapshot.

Local dry run without network: `PRL_ANALYZE_ONLY=1 PRL_FIXTURES=<dir with labels.json, price.json, wprl.json>` against a
cache dir holding `chunk-00000.ndjson.gz`… and a Turso (or compatible) endpoint.
