// ============================================================================
// Demo 5: Heartbeat — 40s, 80 drones, intimate
// First appearance: heart generator, breathing-sphere animated, breathe idle,
// morph transition as hero.
// ============================================================================

import {
  resetProject, addLaunch, addLand, addFormation,
  makeFormation, makeAnimatedFormation, wireFlow, idleConfig,
} from './helpers'

export function seedHeartbeat(): void {
  resetProject('Heartbeat', 80)

  // count 36 — the parametric heart curve crowds adjacent drones around
  // its cusp at t≈π. Smaller count + larger sizes (perimeter scales
  // linearly with size, ≈6× per the formula) keeps the visual "heart"
  // intact while clearing the 1.5m floor. 2026-05-21.
  const heart = makeFormation('Heart', 'heart', { count: 36, size: 22 })
  const heartLarge = makeFormation('Heart Large', 'heart', { count: 36, size: 28 })
  const breathing = makeAnimatedFormation('breathing-sphere')

  const launch = addLaunch(80, 0.02)
  const fHeart = addFormation({
    label: 'Heart', formationId: heart,
    // altitude 24 (was 14) so the size-22 heart's bottom lobe stays above the
    // 0m geofence floor (heart yRaw -17 × 22/16 = -23.4, plus a ~1m margin).
    startTime: 5, duration: 6, altitude: 24,
    colorProgramId: 'solid-red',
    idleConfigs: [idleConfig('pulse', { radius: 1, speed: 1, altitude: 24 })],
  })
  const fBreathing = addFormation({
    label: 'Breathing', formationId: breathing,
    startTime: 16, duration: 8, altitude: 12,
    colorProgramId: 'solid-red',
  })
  const fHeartLarge = addFormation({
    label: 'Heart Large', formationId: heartLarge,
    // altitude 32 (was 14) keeps the size-28 heart's bottom (yRaw -17 × 28/16
    // = -29.75) safely above the 0m geofence floor.
    startTime: 27, duration: 6, altitude: 32,
    colorProgramId: 'solid-red',
    idleConfigs: [idleConfig('breathe', { radius: 6, speed: 0.4, altitude: 32 })],
  })
  const land = addLand(0.025)

  // Hearts have cusps where adjacent points crowd; morph through cusp regions
  // causes close passes even with bumped durations. Switched the two heart-target
  // morphs to shortest-path so per-formation Hungarian + canonical sources can
  // route around the cusp. Inner morph (sphere→sphere-ish) stays.
  wireFlow(launch, fHeart, { strategyId: 'shortest-path', preferredDuration: 12 })
  wireFlow(fHeart, fBreathing, {
    strategyId: 'morph', preferredDuration: 4,
    parameters: { arcHeight: 3 },
  })
  wireFlow(fBreathing, fHeartLarge, { strategyId: 'shortest-path', preferredDuration: 10 })
  wireFlow(fHeartLarge, land, { strategyId: 'shortest-path', preferredDuration: 8 })
}
