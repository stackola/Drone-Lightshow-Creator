// ============================================================================
// Demo 1: Pulse Test — 15s, 40 drones, minimalist
// First appearance: pulse-white, chase-rgb, gradient-warm, idle:pulse
// ============================================================================

import {
  resetProject, addLaunch, addLand, addFormation,
  makeFormation, wireFlow,
} from './helpers'

export function seedPulseTest(): void {
  resetProject('Pulse Test', 40)

  // r=12 → arc spacing ≈ 1.88m, comfortably above minDist=1.5m.
  const ring = makeFormation('Pulse Ring', 'ring', { count: 40, radius: 12 })

  const launch = addLaunch(40, 0.02)
  const fA = addFormation({
    label: 'Pulse White', formationId: ring,
    startTime: 4, duration: 4, altitude: 12,
    colorProgramId: 'pulse-white',
  })
  const fB = addFormation({
    label: 'Chase RGB', formationId: ring,
    startTime: 9, duration: 4, altitude: 12,
    colorProgramId: 'chase-rgb',
  })
  const fC = addFormation({
    label: 'Sweep', formationId: ring,
    startTime: 13.5, duration: 2, altitude: 12,
    colorProgramId: 'sweep-cyan-magenta',
  })
  const land = addLand(0.02)

  wireFlow(launch, fA, { strategyId: 'shortest-path', preferredDuration: 1.5 })
  wireFlow(fA, fB, { strategyId: 'shortest-path', preferredDuration: 1 })
  wireFlow(fB, fC, { strategyId: 'shortest-path', preferredDuration: 0.5 })
  wireFlow(fC, land, { strategyId: 'shortest-path', preferredDuration: 1.5 })
}
