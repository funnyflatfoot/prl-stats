# Miners page: data setup

1. Vercel → Storage → create a Blob store, attach to `prl-stats`. This adds `BLOB_READ_WRITE_TOKEN`.
2. Vercel → Settings → Environment Variables → `CRON_SECRET` (any long random string), and the same value
   as a GitHub repo secret (Settings → Secrets and variables → Actions). The hourly workflow
   `.github/workflows/prl-index.yml` sends it as `Authorization: Bearer …`; the route rejects anything else.
3. Seed the indexer state so the cron does not start from genesis:
   - open the explorer tab that holds the `prlscrape` IndexedDB dump, paste `scripts/bootstrap-state.js`
     into the console; it downloads `prl-state.json`;
   - upload it to the Blob store as `prl/miner-state.json` (Vercel dashboard → Storage → Blob → Upload,
     or `curl -X PUT "https://blob.vercel-storage.com/prl/miner-state.json" -H "authorization: Bearer $BLOB_READ_WRITE_TOKEN" -H "x-api-version: 7" -H "x-add-random-suffix: 0" -H "x-allow-overwrite: 1" --data-binary @prl-state.json`).
4. Trigger once: `curl -H "authorization: Bearer $CRON_SECRET" https://prl-stats.vercel.app/api/cron/prl-index`.
   Each run advances up to ~50 s of blocks and resumes next hour until caught up (or run the
   `prl-index` workflow by hand from the Actions tab).

Until step 3 runs, `/miners` and `/api/miner-behavior` serve the committed snapshot in `data/miner_behavior.json`.
