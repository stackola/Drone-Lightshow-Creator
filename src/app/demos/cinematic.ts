// ============================================================================
// Demo 8: Cinematic — 2 minutes, 250 drones, long-form
// First appearance: apple-tree-shake animated formation, pacing spectrum
// (15s static dwell, 20s animated dwell, 3s stagger spread on launch).
// ============================================================================

import {
  resetProject, addLaunch, addLand, addFormation,
  makeFormation, makeAnimatedFormation, wireFlow, kf, idleConfig,
} from './helpers'

export function seedCinematic(): void {
  resetProject('Cinematic', 250)

  // 250-drone formations need very generous layouts: ring r ≥ 60m; sphere r ≥ 7m;
  // heart size ≥ 65m; grid spacing 2m (was 1.5 — borderline).
  const ring = makeFormation('Awakening', 'ring', { count: 250, radius: 60 })
  // spacing param removed — the spiral generator now interprets it as
  // innerRadius (was 0.4, which caused inner-radius crowding). Defaults
  // to radius/3 ≈ 13.3 here, plenty of spread for 250 drones.
  const spiral = makeFormation('Spiral Galaxy', 'spiral', { count: 250, turns: 5, radius: 40 })
  const appleTree = makeAnimatedFormation('apple-tree-shake')
  const sphere = makeFormation('Climax', 'sphere', { count: 250, radius: 20 })
  // count 80 (was 250) — heart curve has a cusp at t=π where multiple
  // adjacent t values map to nearly the same point. Even with the
  // arc-length-uniform generator, 250 drones still cluster around the
  // cusp at sub-spec spacing. 80 keeps the silhouette intact; the
  // remaining 170 drones get the breathe idle below.
  const heart = makeFormation('Coda', 'heart', { count: 80, size: 65 })
  const grid = makeFormation('Wind-down', 'grid', { count: 250, cols: 20, rows: 13, spacing: 2 })

  // Act 1 (0–25s): slow rise.
  const launch = addLaunch(250, 0.012)
  const fRing = addFormation({
    label: 'Awakening', formationId: ring,
    startTime: 8, duration: 15, altitude: 14,
    colorProgramId: 'gradient-warm',
    idleConfigs: [idleConfig('hover')],
    // π/4 rotation over 15s at r=60: avg 3.1 m/s, peak ~4.7 m/s — well under limit.
    // Position y preserved at altitude=14 (kf defaults missing axes to 0; if
    // we wrote `{ y: 0 }` it'd lerp the formation down to ground).
    keyframes: [
      kf(0, { y: 14 }, { y: 0 }),
      kf(15, { y: 14 }, { y: Math.PI / 4 }),
    ],
  })

  // Act 2 (25–55s): animated spiral.
  const fSpiral = addFormation({
    label: 'Galaxy', formationId: spiral,
    startTime: 30, duration: 20, altitude: 16,
    colorProgramId: 'gradient-warm',
    idleConfigs: [idleConfig('drift', { radius: 1, speed: 0.2, altitude: 16 })],
    // Quarter rotation over 20s at r=40: avg 3.1 m/s, peak (cubic ease) 4.7 m/s,
    // comfortably under the 7.2 m/s effective limit (maxVelocity × 0.9 safety margin).
    keyframes: [
      // Position y kept at 16 (formation's altitude) so the keyframe doesn't
      // override altitude to 0 (kf() defaults missing position axes to 0).
      kf(0, { y: 16 }, { y: 0 }, { x: 1, y: 1, z: 1 }),
      kf(20, { y: 16 }, { y: Math.PI / 2 }, { x: 1.1, y: 1.1, z: 1.1 }),
    ],
  })

  // Act 3 (55–80s): apple tree shake.
  const fAppleTree = addFormation({
    label: 'Apple Tree', formationId: appleTree,
    startTime: 56, duration: 12, altitude: 14,
    colorProgramId: 'gradient-warm',
    // The apple-tree library formation has 50 drones; the remaining 200
    // need an idle behaviour or they pile into the leftover grid at 0.5m
    // spacing. Orbit at r=25 (5/√n_remaining ≈ 1.77m pair distance).
    idleConfigs: [idleConfig('orbit', { radius: 100, speed: 0.2, altitude: 20 })],
  })

  // Act 4 (80–105s): explosion → implosion climax.
  const fClimax = addFormation({
    label: 'Climax', formationId: sphere,
    startTime: 75, duration: 8, altitude: 18,
    colorProgramId: 'rainbow',
    // Position y kept at 18 (formation's altitude) so the kf scale-only
    // keyframes don't override altitude to 0.
    keyframes: [kf(0, { y: 18 }, {}, { x: 0.5, y: 0.5, z: 0.5 }), kf(8, { y: 18 }, {}, { x: 1, y: 1, z: 1 })],
  })
  const fCoda = addFormation({
    // altitude 70 (was 14): heart yRaw spans [-17, 11.5], scaled by 65/16
    // gives [-69, 47]. altitude 70 lands the heart between y=1 and y=117,
    // within the [0, 120] geofence. 2026-05-21.
    label: 'Coda', formationId: heart,
    startTime: 90, duration: 8, altitude: 70,
    colorProgramId: 'solid-red',
    idleConfigs: [idleConfig('breathe', { radius: 6, speed: 0.4, altitude: 70 })],
  })

  // Act 5 (105–120s): wind-down + land.
  const fGrid = addFormation({
    label: 'Wind-down', formationId: grid,
    startTime: 105, duration: 6, altitude: 12,
    colorProgramId: 'gradient-warm',
    keyframes: [kf(0, { y: 12 }, {}, { x: 1, y: 1, z: 1 }), kf(6, { y: 12 }, {}, { x: 0.8, y: 0.8, z: 0.8 })],
  })
  const land = addLand(0.04)

  // 250 drones fanning out from launch grid to opening ring needs real space.
  // 8s left the validator flagging close passes; 18s clears motionSpacing.
  wireFlow(launch, fRing, { strategyId: 'shortest-path', preferredDuration: 18 })
  wireFlow(fRing, fSpiral, {
    strategyId: 'ant-walk', preferredDuration: 5,
    parameters: { laneCount: 3, arcHeight: 5, laneSpread: 8 },
  })
  wireFlow(fSpiral, fAppleTree, { strategyId: 'shortest-path', preferredDuration: 4 })
  wireFlow(fAppleTree, fClimax, {
    strategyId: 'explosion', preferredDuration: 4,
    parameters: { maxRadius: 10, gravity: 0.3 },
  })
  wireFlow(fClimax, fCoda, { strategyId: 'implosion', preferredDuration: 4 })
  wireFlow(fCoda, fGrid, {
    strategyId: 'morph', preferredDuration: 4,
    parameters: { arcHeight: 3 },
  })
  wireFlow(fGrid, land, { strategyId: 'shortest-path', preferredDuration: 3 })
}
