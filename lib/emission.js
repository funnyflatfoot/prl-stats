// Whitepaper emission. Reward is a function of block HEIGHT, the schedule below is a function
// of TIME. The gap between the two is panel 4.
//   E(t) = S*H / ((t+H)(t+H-1))        per-block subsidy at height t, floored to 1e-8 ("grain")
//   A(t) = S*t / (t+H)                 cumulative supply by height t

export const GRAIN = 1e-8

export function subsidyAt(height, { S, H }) {
  if (height < 1) return 0
  const raw = (S * H) / ((height + H) * (height + H - 1))
  return Math.floor(raw / GRAIN) * GRAIN
}

export function cumulativeAt(height, { S, H }) {
  if (height < 1) return 0
  return (S * height) / (height + H)
}

// Supply the published schedule implies at a wall-clock time, i.e. if every block took the target.
export function scheduledSupplyAtTime(unixSeconds, { S, H, genesisTimeUnix, targetBlockSeconds }) {
  const elapsed = Math.max(0, unixSeconds - genesisTimeUnix)
  return cumulativeAt(elapsed / targetBlockSeconds, { S, H })
}
