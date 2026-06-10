// ============================================================================
// Demo 4: Fireworks v2 — 50s, 200 drones, high-energy
// First appearance: firework-burst animated, explosion/implosion/bounce transitions,
// rainbow + rainbow-index colors, stagger transition.
// ============================================================================

import {
  resetProject, addLaunch, addLand, addFormation,
  makeFormation, makeAnimatedFormation, wireFlow,
} from './helpers'

export function seedFireworks(): void {
  resetProject('Fireworks v2', 200)

  // 200-drone formations need generous radii: ring r ≥ 200×1.5/(2π) ≈ 48m, sphere
  // r ≥ √(200×1.5²/(4π)) ≈ 4.9m × √(200/4π) ≈ 6m. Use 50m rings / r=12 sphere.
  const chargeRing = makeFormation('Charge Ring', 'ring', { count: 200, radius: 50 })
  const burstAnim = makeAnimatedFormation('firework-burst')
  const collapse = makeFormation('Collapse', 'sphere', { count: 200, radius: 14 })
  const settle = makeFormation('Settle', 'ring', { count: 200, radius: 50 })

  const launch = addLaunch(200, 0.008)
  const fCharge = addFormation({
    label: 'Charge', formationId: chargeRing,
    startTime: 5, duration: 4, altitude: 14,
    colorProgramId: 'solid-white',
  })
  const fBurst = addFormation({
    label: 'Burst', formationId: burstAnim,
    startTime: 14, duration: 4, altitude: 20,
    colorProgramId: 'rainbow',
  })
  const fCollapse = addFormation({
    label: 'Collapse', formationId: collapse,
    startTime: 23, duration: 5, altitude: 14,
    colorProgramId: 'rainbow-index',
  })
  const fSettle = addFormation({
    label: 'Settle', formationId: settle,
    startTime: 33, duration: 6, altitude: 12,
    colorProgramId: 'pulse-white',
  })
  const land = addLand(0.01)

  // Durations sized to clear ERROR-severity collisions under post-Slice-3
  // validator with 200 drones (high density). Implosion stretched to spread
  // its focal-clump over more time (the "blob at t≈20" the user reported).
  // Residual warnings (0.4-0.7m close passes) accepted as high-density flair.
  wireFlow(launch, fCharge, { strategyId: 'shortest-path', preferredDuration: 10 })
  wireFlow(fCharge, fBurst, {
    strategyId: 'explosion', preferredDuration: 5,
    parameters: { maxRadius: 12, gravity: 0.3 },
  })
  wireFlow(fBurst, fCollapse, {
    strategyId: 'implosion', preferredDuration: 5,
  })
  wireFlow(fCollapse, fSettle, {
    strategyId: 'bounce', preferredDuration: 4,
    parameters: { damping: 0.5 },
  })
  wireFlow(fSettle, land, {
    strategyId: 'stagger', preferredDuration: 4,
    parameters: { staggerAmount: 0.5, staggerMode: 'by-distance-from-center', staggerCurve: 'ease-out' },
  })
}
