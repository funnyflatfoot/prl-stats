# Nightly data refresh

`.github/workflows/prl-daily.yml` runs at 18:30 UTC (00:00 IST) and on demand from the Actions tab.
It ingests new blocks, pulls the market snapshot, reruns the miner fate walk, and commits whatever
changed under `data/`. That commit redeploys the site. There is nothing to configure: no secrets, no
database, no environment variables.

The first run backfills the whole chain for the miners page, roughly four hours. If it stops early,
run it again and it resumes from where the cache left off. Every later run takes about half an hour,
most of it walking prlscan's holder list for labels.

Watching it: github.com/funnyflatfoot/prl-stats/actions, the `prl-daily` workflow. GitHub emails you
when a scheduled run fails. On the site, the Miners page header shows when the data was generated and
the Chain page shows the ingested tip; if either stops moving for more than a day, check the Actions tab.

Refreshing by hand still works the way it always did: `npm run refresh`, then commit `data/`.
