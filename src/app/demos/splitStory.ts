// ============================================================================
// Demo 7: Split Story — 60s, 120 drones, narrative
// First appearance: spin idle, swarm/figure8 in split topology, ant-walk in
// split + merge context.
// ============================================================================

import {
  resetProject, addLaunch, addLand, addFormation,
  makeFormation, wireFlow, splitWire, mergeWire, idleConfig,
} from './helpers'

export function seedSplitStory(): void {
  resetProject('Split Story', 120)

  // 120 drone ring needs r ≥ 30m; 60 drones need r ≥ 15m on ring, length ≥ 90m on line,
  // sphere r ≥ √(60·1.5²/(4π)) ≈ 3.4 → use 8m for visual margin.
  const together = makeFormation('Together', 'ring', { count: 120, radius: 30 })
  const leftGrid = makeFormation('Left Grid', 'grid', { count: 60, cols: 10, rows: 6, spacing: 1.6 })
  const leftSphere = makeFormation('Left Sphere', 'sphere', { count: 60, radius: 8 })
  const rightLine = makeFormation('Right Line', 'line', { count: 60, length: 90, arcAngle: 60 })
  const rightSphere = makeFormation('Right Sphere', 'sphere', { count: 60, radius: 8 })
  const reunited = makeFormation('Reunited', 'ring', { count: 120, radius: 30 })

  const launch = addLaunch(120, 0.015)
  const fTogether = addFormation({
    label: 'Together', formationId: together,
    startTime: 5, duration: 6, altitude: 14,
    colorProgramId: 'solid-blue',
    idleConfigs: [idleConfig('hover')],
  })

  const fLeft1 = addFormation({
    label: 'Left Grid', formationId: leftGrid,
    startTime: 15, duration: 6, altitude: 14,
    colorProgramId: 'solid-blue',
    idleConfigs: [idleConfig('swarm', { radius: 4, speed: 0.4, altitude: 14 })],
    transform: { position: { x: -10, y: 14, z: 0 } },
  })
  const fLeft2 = addFormation({
    label: 'Left Sphere', formationId: leftSphere,
    startTime: 26, duration: 6, altitude: 14,
    colorProgramId: 'gradient-blue-red',
    idleConfigs: [idleConfig('figure8', { radius: 4, speed: 0.4, altitude: 14 })],
    transform: { position: { x: -10, y: 14, z: 0 } },
  })

  const fRight1 = addFormation({
    label: 'Right Line', formationId: rightLine,
    startTime: 15, duration: 6, altitude: 14,
    colorProgramId: 'solid-green',
    idleConfigs: [idleConfig('spin', { radius: 4, speed: 0.5, altitude: 14 })],
    transform: { position: { x: 10, y: 14, z: 0 } },
  })
  const fRight2 = addFormation({
    label: 'Right Sphere', formationId: rightSphere,
    startTime: 26, duration: 6, altitude: 14,
    colorProgramId: 'solid-green',
    idleConfigs: [idleConfig('orbit', { radius: 4, speed: 0.4, altitude: 14 })],
    transform: { position: { x: 10, y: 14, z: 0 } },
  })

  const fReunited = addFormation({
    label: 'Reunited', formationId: reunited,
    startTime: 38, duration: 8, altitude: 14,
    colorProgramId: 'gradient-blue-red',
    idleConfigs: [idleConfig('figure8', { radius: 6, speed: 0.4, altitude: 14 })],
  })
  const land = addLand(0.02)

  // 8s — 120 drones fanning to a 30m-radius ring needs ~7.5s under post-nudge-
  // removal motion-spacing checks (was 7s, validator flagged 0.73m close pass).
  wireFlow(launch, fTogether, { strategyId: 'shortest-path', preferredDuration: 8 })

  // Split: fTogether (120-drone ring) fans out to two sub-formations. 3s left
  // the validator catching a 0.21m close pass; 5s gives clean motion-spacing.
  splitWire(fTogether, [
    [fLeft1, { strategyId: 'shortest-path', preferredDuration: 5 }],
    [fRight1, { strategyId: 'shortest-path', preferredDuration: 5 }],
  ])

  // Ant-walk swapped for shortest-path — the ant-walk funnel auto-extension was
  // blowing duration to 17s+ and converging multiple drones to a lane endpoint
  // at t→1 (0.00m collisions). shortest-path with explicit duration is what the
  // split-story narrative actually needs anyway: clean fan transitions.
  wireFlow(fLeft1, fLeft2, { strategyId: 'shortest-path', preferredDuration: 5 })
  wireFlow(fRight1, fRight2, { strategyId: 'shortest-path', preferredDuration: 5 })

  mergeWire([
    [fLeft2, { strategyId: 'shortest-path', preferredDuration: 6 }],
    [fRight2, { strategyId: 'shortest-path', preferredDuration: 6 }],
  ], fReunited)

  wireFlow(fReunited, land, { strategyId: 'shortest-path', preferredDuration: 5 })
}
