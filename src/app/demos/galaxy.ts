// ============================================================================
// Demo 3: Galaxy — 45s, 100 drones, meditative
// First appearance: spiral generator, spiral transition, gradient-blue-red color.
// ============================================================================

import {
  resetProject, addLaunch, addLand, addFormation,
  makeFormation, wireFlow, kf, idleConfig,
} from './helpers'

export function seedGalaxy(): void {
  resetProject('Galaxy', 100)

  // 100 drones — spiral length ~ chord+turns·2π·r/2. For r=20, turns=3: ~190m total
  // → 1.9m/drone spacing. Sphere r=10 → ~1.78m surface spacing.
  // The spiral generator distributes `count` points uniformly in t∈[0,1],
  // so the innermost points crowd when count is high (r → 0). Dropping to
  // 60 keeps the visual "spiral arm" feel while bringing closest pair
  // above the 1.5m floor. `spacing` is ignored by the spiral generator.
  // The spiral generator now interprets `spacing` as the inner radius
  // (where t=0 starts). Omitting it lets it default to radius/3, keeping
  // inner points above the 1.5m pair-spacing floor.
  const spiral = makeFormation('Spiral Arm', 'spiral', { count: 60, turns: 3, radius: 20 })
  const sphere = makeFormation('Core', 'sphere', { count: 100, radius: 10 })

  const launch = addLaunch(100, 0.02)
  const fSpiral = addFormation({
    label: 'Galaxy', formationId: spiral,
    startTime: 4, duration: 10, altitude: 15,
    colorProgramId: 'gradient-blue-red',
    idleConfigs: [idleConfig('orbit', { radius: 12, speed: 0.3, altitude: 15 })],
    // Position y kept at 15 so the keyframe doesn't override altitude to 0
    // (the kf() helper defaults missing axes to 0, not "preserve base"). 2026-05-21.
    keyframes: [kf(0, { y: 15 }, { y: 0 }), kf(10, { y: 15 }, { y: Math.PI * 2 })],
  })
  const fSphere = addFormation({
    label: 'Core', formationId: sphere,
    startTime: 20, duration: 8, altitude: 15,
    colorProgramId: 'gradient-blue-red',
    keyframes: [kf(0, { y: 15 }, { y: 0 }), kf(8, { y: 15 }, { y: Math.PI * 2 })],
  })
  const fSpiral2 = addFormation({
    label: 'Disperse', formationId: spiral,
    startTime: 32, duration: 8, altitude: 15,
    colorProgramId: 'gradient-blue-red',
    idleConfigs: [idleConfig('orbit', { radius: 12, speed: 0.3, altitude: 15 })],
  })
  const land = addLand(0.025)

  // Durations sized for clean motion-spacing under post-Slice-3 validator
  // (no per-frame nudge to mask close passes). Sized to clear ERRORS; residual
  // close-pass warnings (0.4-0.7m) accepted as tight choreography.
  wireFlow(launch, fSpiral, { strategyId: 'shortest-path', preferredDuration: 5 })
  wireFlow(fSpiral, fSphere, {
    strategyId: 'spiral', preferredDuration: 8,
    parameters: { turns: 1, radius: 4, direction: 1 },
  })
  wireFlow(fSphere, fSpiral2, {
    strategyId: 'spiral', preferredDuration: 7,
    parameters: { turns: 1, radius: 4, direction: -1 },
  })
  wireFlow(fSpiral2, land, { strategyId: 'shortest-path', preferredDuration: 6 })
}
