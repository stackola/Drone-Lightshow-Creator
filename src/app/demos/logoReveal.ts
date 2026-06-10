// ============================================================================
// Demo 6: Logo Reveal — 35s, 150 drones, branded
// First appearance: color-sweep transition, drift + wave idle behaviors.
// ============================================================================

import {
  resetProject, addLaunch, addLand, addFormation,
  makeFormation, wireFlow, idleConfig,
} from './helpers'

export function seedLogoReveal(): void {
  resetProject('Logo Reveal', 150)

  // 150 drones — grid spacing 1.8m (was 1.2 ❌); star outer 24m; heart size 36m.
  const grid = makeFormation('Wordmark', 'grid', { count: 150, cols: 15, rows: 10, spacing: 1.8 })
  // outerRadius 50 (was 24) so 150 drones on a 5-point star perimeter
  // (~440m at r=50) meet the 1.5m pair spacing floor (1.57m at r=50).
  const star = makeFormation('Logo Star', 'star', { count: 150, points_n: 5, outerRadius: 50, innerRadius: 20 })
  // size 50, count 80 — at size 36 / count 80 the arc-length spacing was
  // 1.15m (sub-spec); size 50 brings it to ~1.6m above the floor. The
  // remaining 70 drones get the (idle-less) leftover-grid treatment.
  const heart = makeFormation('Sign-off', 'heart', { count: 80, size: 50 })

  const launch = addLaunch(150, 0.01)
  const fGrid = addFormation({
    label: 'Wordmark', formationId: grid,
    startTime: 5, duration: 5, altitude: 15,
    colorProgramId: 'gradient-warm',
    idleConfigs: [idleConfig('drift', { radius: 1, speed: 0.2, altitude: 15 })],
  })
  const fStar = addFormation({
    label: 'Star', formationId: star,
    // altitude 55 so the star's outer tips at r=50 stay above 0 (5m
    // clearance). No keyframes — the rotation that used to live here
    // exceeded peak velocity at the new larger outerRadius.
    startTime: 13, duration: 7, altitude: 55,
    colorProgramId: 'gradient-blue-red',
    idleConfigs: [idleConfig('wave', { radius: 5, speed: 0.5, altitude: 55 })],
  })
  const fHeart = addFormation({
    label: 'Heart', formationId: heart,
    // altitude 55 so the size-50 heart's bottom (yRaw -17 × 50/16 ≈ -53)
    // stays above 0. Top is at 55 + 11.5×50/16 ≈ 91m, under the 120m ceiling.
    startTime: 23, duration: 5, altitude: 55,
    colorProgramId: 'solid-white',
  })
  const land = addLand(0.015)

  wireFlow(launch, fGrid, { strategyId: 'shortest-path', preferredDuration: 4 })
  // duration 6 (was 3) — fStar's keyframes now correctly hold altitude 14
  // instead of accidentally dropping to 0, which tightened the transition's
  // path geometry. The extra 3s gives drones room to avoid pair collisions.
  wireFlow(fGrid, fStar, { strategyId: 'color-sweep', preferredDuration: 6 })
  wireFlow(fStar, fHeart, {
    strategyId: 'morph', preferredDuration: 3,
    parameters: { arcHeight: 5 },
  })
  wireFlow(fHeart, land, { strategyId: 'shortest-path', preferredDuration: 4 })
}
