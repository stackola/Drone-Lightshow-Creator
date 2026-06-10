// ============================================================================
// Demo 2: Countdown — 20s, 60 drones, narrative/festive
// First appearance: line + star generators, cascade transition, sparkle idle,
// solid-red/blue/green colors.
// ============================================================================

import {
  resetProject, addLaunch, addLand, addFormation,
  makeFormation, wireFlow,
} from './helpers'

export function seedCountdown(): void {
  resetProject('Countdown', 30)

  // 60 drones in tight formations need wide layouts: line spacing 1.5m → length 90m.
  // Use 30 drones to keep visuals compact.
  const three = makeFormation('Three', 'line', { count: 30, length: 45, arcAngle: 0 })
  const two = makeFormation('Two', 'line', { count: 30, length: 45, arcAngle: 45 })
  const one = makeFormation('One', 'star', { count: 30, points_n: 5, outerRadius: 12, innerRadius: 5 })

  const launch = addLaunch(30, 0.02)
  const f3 = addFormation({
    label: 'Three', formationId: three,
    startTime: 4, duration: 3, altitude: 14,
    colorProgramId: 'solid-red',
  })
  const f2 = addFormation({
    label: 'Two', formationId: two,
    startTime: 9, duration: 3, altitude: 14,
    colorProgramId: 'solid-blue',
  })
  const f1 = addFormation({
    label: 'One', formationId: one,
    startTime: 14, duration: 3, altitude: 14,
    colorProgramId: 'solid-green',
    idleConfigs: [],
  })
  const land = addLand(0.02)

  wireFlow(launch, f3, { strategyId: 'shortest-path', preferredDuration: 2 })
  wireFlow(f3, f2, {
    strategyId: 'cascade', preferredDuration: 2,
    parameters: { propagationSpeed: 1.2, directionX: 1, directionY: 0, directionZ: 0 },
  })
  wireFlow(f2, f1, {
    strategyId: 'cascade', preferredDuration: 2,
    parameters: { propagationSpeed: 1, directionX: 1, directionY: 0, directionZ: 0 },
  })
  wireFlow(f1, land, { strategyId: 'shortest-path', preferredDuration: 1.5 })
}
