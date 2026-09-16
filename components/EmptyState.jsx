import { Eyebrow } from '@/components/ui'

export default function EmptyState({ checkpoint, startHeight }) {
  const stale = checkpoint?.status === 'stale-action-id'
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-16">
      <Eyebrow className="mb-5 tracking-[0.18em]">Proof of Useful Work · Chain Metrics</Eyebrow>
      <h1 className="m-0 font-medium leading-[1.05] tracking-[-0.035em]" style={{ fontSize: 'clamp(32px, 5vw, 48px)' }}>
        PRL Stats
      </h1>
      <p className="mt-5 max-w-[56ch] text-lede text-ink2">
        No chain data in the local store. Nothing is rendered rather than showing placeholder numbers.
      </p>

      {stale && (
        <div className="mt-8 border-l-2 border-neg bg-raise px-4 py-3.5">
          <div className="text-note font-medium text-neg">Last ingestion stopped: stale explorer action id</div>
          <div className="mt-1 text-note text-ink2">{checkpoint.error}</div>
          <div className="mt-2 text-note text-ink2">Rotate the id in config/explorer.config.json, then re-run ingestion. See README.</div>
        </div>
      )}

      <div className="mt-8 border border-line bg-raise p-4">
        <Eyebrow>Run</Eyebrow>
        <pre className="mt-2.5 overflow-x-auto font-mono text-chip leading-[1.8] text-ink">{`npm install
npm run ingest          # chain, from #${startHeight} to tip, resumable
npm run market          # price and daily close from CoinGecko
npm run dev`}</pre>
      </div>

      <p className="mt-5 max-w-[76ch] text-note text-muted">
        Ingestion runs at 6 concurrent requests, roughly 15 blocks a second. A cold start from #{startHeight} to a tip near #112,000 takes
        about fifteen minutes and checkpoints as it goes, so it can be interrupted and resumed.
      </p>
    </main>
  )
}
