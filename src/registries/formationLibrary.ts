// ============================================================================
// Formation Library — Premade animated and static formation definitions
// ============================================================================
// Each entry produces an AnimatedFormationDef that can be added to the
// formation store. Formations are authored in local space (centered at origin).
//
// The whole-formation transform (node's base transform + keyframes) is applied
// on top by the evaluator, so these just define the internal drone motion.
// ============================================================================

import type { AnimatedFormationDef, DroneTrack, PositionKeyframe, ColorKeyframe, PlaybackConfig } from '../graph/animatedFormation'
import type { Vec3 } from '../graph/types'
import { createRegistry } from './createRegistry'

export interface LibraryFormationEntry {
  id: string
  name: string
  description: string
  tags: string[]
  droneCount: number
  duration: number
  defaultPlayback: PlaybackConfig
  build: () => AnimatedFormationDef
}

const registry = createRegistry<LibraryFormationEntry>('formationLibrary')

export const registerLibraryFormation = registry.register
export const getLibraryFormations = registry.getAll

// ============================================================================
// Helper utilities for authoring formations
// ============================================================================

/** Create a position keyframe */
function pk(time: number, x: number, y: number, z: number, easing: PositionKeyframe['easing'] = 'ease-in-out'): PositionKeyframe {
  return { time, value: { x, y, z }, easing }
}

/** Create a color keyframe */
function ck(time: number, r: number, g: number, b: number, mode: ColorKeyframe['mode'] = 'lerp'): ColorKeyframe {
  return { time, value: { r, g, b }, mode }
}

/** Distribute N points in a filled circle (XZ plane) at height Y */
function filledCircle(n: number, radius: number, y: number): Vec3[] {
  const points: Vec3[] = []
  // Sunflower pattern for even distribution
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const r = radius * Math.sqrt((i + 0.5) / n)
    const theta = i * goldenAngle
    points.push({ x: r * Math.cos(theta), y, z: r * Math.sin(theta) })
  }
  return points
}

/** Distribute N points along a vertical line (trunk) */
function verticalLine(n: number, yMin: number, yMax: number, x: number = 0, z: number = 0): Vec3[] {
  const points: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5
    points.push({ x, y: yMin + t * (yMax - yMin), z })
  }
  return points
}

// ============================================================================
// Apple Tree — Shakes and drops an apple
// ============================================================================
// Structure:
//   - Trunk: ~10 drones in a vertical column
//   - Canopy: ~35 drones in a filled sphere/dome
//   - Apple: 5 drones clustered together, starts in canopy, drops
//
// Animation timeline (8 seconds):
//   0-1s:  Still (resting tree)
//   1-2s:  Canopy shakes (oscillates position)
//   2-3s:  Canopy settles, apple starts to detach
//   3-5s:  Apple falls from canopy to ground
//   5-6s:  Apple bounces slightly
//   6-8s:  Still (final pose)
// ============================================================================

registerLibraryFormation({
  id: 'apple-tree-shake',
  name: 'Apple Tree (Shake & Drop)',
  description: 'A tree that shakes its canopy and drops an apple',
  tags: ['nature', 'animated', 'tree'],
  droneCount: 50,
  duration: 8,
  defaultPlayback: { mode: 'clamp', speed: 1, trimIn: 0, trimOut: 0 },
  build() {
    const TRUNK_COUNT = 10
    const CANOPY_COUNT = 35
    const APPLE_COUNT = 5
    const TOTAL = TRUNK_COUNT + CANOPY_COUNT + APPLE_COUNT // 50

    const tracks: DroneTrack[] = []

    // --- Trunk drones (indices 0..9) ---
    // Trunk spans y=0..15 (was 0..6) so 10 drones meet 1.5m vertical
    // spacing (15/9 = 1.67m vs 0.67m before). Canopy baseline + apple
    // rest position shifted to match below. 2026-05-21.
    const trunkPositions = verticalLine(TRUNK_COUNT, 0, 15, 0, 0)
    for (let i = 0; i < TRUNK_COUNT; i++) {
      const p = trunkPositions[i]!
      // Trunk is static — brown color
      tracks.push({
        positionKeyframes: [pk(0, p.x, p.y, p.z, 'linear')],
        colorKeyframes: [ck(0, 0.45, 0.25, 0.1)],
      })
    }

    // --- Canopy drones (indices 10..44) ---
    // canopy radius 9 (was 5) — sunflower spacing ≈ r/√n; 5/√35 = 0.85m
    // (sub-spec), 9/√35 = 1.52m (just above the 1.5m floor). 2026-05-21.
    const canopyRestPositions = filledCircle(CANOPY_COUNT, 9, 0)
    // Raise canopy above the (now taller, 15m) trunk
    const canopyBaseY = 17

    for (let i = 0; i < CANOPY_COUNT; i++) {
      const cp = canopyRestPositions[i]!
      // Add vertical spread to make it dome-like
      const distFromCenter = Math.sqrt(cp.x * cp.x + cp.z * cp.z)
      const heightOffset = Math.max(0, 2.5 - distFromCenter * 0.4) // dome shape
      const restX = cp.x
      const restY = canopyBaseY + heightOffset
      const restZ = cp.z

      // Shake amplitude varies by position (outer drones shake more)
      const shakeAmp = 0.3 + distFromCenter * 0.15
      const shakePhase = i * 0.3 // stagger the shake

      // Build shake keyframes: rest → shake left → shake right → settle
      const posKfs: PositionKeyframe[] = [
        pk(0, restX, restY, restZ, 'linear'),       // rest
        pk(1, restX, restY, restZ, 'ease-in'),       // start of shake
        pk(1.25, restX + Math.sin(shakePhase) * shakeAmp, restY + 0.1, restZ + Math.cos(shakePhase) * shakeAmp, 'ease-in-out'),
        pk(1.5, restX - Math.sin(shakePhase + 1) * shakeAmp, restY - 0.1, restZ - Math.cos(shakePhase + 1) * shakeAmp, 'ease-in-out'),
        pk(1.75, restX + Math.sin(shakePhase + 2) * shakeAmp * 0.7, restY + 0.05, restZ + Math.cos(shakePhase + 2) * shakeAmp * 0.7, 'ease-in-out'),
        pk(2.0, restX - Math.sin(shakePhase + 3) * shakeAmp * 0.4, restY, restZ - Math.cos(shakePhase + 3) * shakeAmp * 0.4, 'ease-in-out'),
        pk(2.5, restX, restY, restZ, 'ease-out'),    // settle back
      ]

      // Canopy is green, flashes slightly during shake
      const colorKfs: ColorKeyframe[] = [
        ck(0, 0.15, 0.55, 0.1),
        ck(1, 0.15, 0.55, 0.1),
        ck(1.5, 0.25, 0.7, 0.15),   // brighter during shake
        ck(2.5, 0.15, 0.55, 0.1),
      ]

      tracks.push({ positionKeyframes: posKfs, colorKeyframes: colorKfs })
    }

    // --- Apple drones (indices 45..49) ---
    // Start at the canopy's bottom edge (y=canopyBaseY=17) — high enough
    // above the trunk top (y=15) that the apple cluster doesn't bump into
    // the topmost trunk drone. Apples still "fall" from here when the
    // shake animation kicks in.
    const appleRestY = canopyBaseY
    // Apples placed 1.5m apart from each other so the cluster meets the
    // 1.5m pair-spacing floor. The 5 apples sit at the corners of a unit
    // pentagon of radius √(1.5²·2)/2 ≈ 1.06m — gives pair distance 1.5m
    // between adjacent apples. 2026-05-21.
    const appleCluster = (() => {
      const out: { x: number; z: number }[] = []
      const r = 1.28 // 2·r·sin(π/5) ≈ 1.5 for pentagon
      for (let i = 0; i < APPLE_COUNT; i++) {
        const theta = (i / APPLE_COUNT) * Math.PI * 2
        out.push({ x: r * Math.cos(theta), z: r * Math.sin(theta) })
      }
      return out
    })()

    for (let i = 0; i < APPLE_COUNT; i++) {
      const ac = appleCluster[i]!
      const ax = ac.x
      const az = ac.z

      // Shake with canopy, then detach and fall
      const posKfs: PositionKeyframe[] = [
        pk(0, ax, appleRestY, az, 'linear'),                    // rest in tree
        pk(1, ax, appleRestY, az, 'ease-in'),                   // start shake
        pk(1.5, ax + 0.2, appleRestY + 0.1, az + 0.1, 'ease-in-out'), // shake
        pk(2.0, ax - 0.15, appleRestY, az - 0.1, 'ease-in-out'),      // shake
        pk(2.5, ax, appleRestY, az, 'ease-out'),                 // settle
        pk(3.0, ax, appleRestY - 0.5, az, 'ease-in'),           // detach start
        pk(5.0, ax * 1.5, 0.5, az * 1.5, 'ease-in-out'),       // controlled descent (~3 m/s avg)
        pk(6.0, ax * 1.5, 0.3, az * 1.5, 'ease-out'),          // settle on ground
      ]

      // Red apple, glows slightly as it detaches
      const colorKfs: ColorKeyframe[] = [
        ck(0, 0.9, 0.1, 0.1),            // red
        ck(2.5, 0.9, 0.1, 0.1),          // still red
        ck(3.0, 1.0, 0.3, 0.1),          // glow as detaching
        ck(4.5, 0.9, 0.1, 0.1),          // back to red on ground
      ]

      tracks.push({ positionKeyframes: posKfs, colorKeyframes: colorKfs })
    }

    return {
      duration: 8,
      droneCount: TOTAL,
      tracks,
      playback: { mode: 'clamp', speed: 1, trimIn: 0, trimOut: 0 },
    }
  },
})

// ============================================================================
// Firework Burst — Expands outward from center
// ============================================================================

registerLibraryFormation({
  id: 'firework-burst',
  name: 'Firework Burst',
  description: 'Drones explode outward from center then fade',
  tags: ['effects', 'animated', 'firework'],
  droneCount: 60,
  duration: 4,
  defaultPlayback: { mode: 'clamp', speed: 1, trimIn: 0, trimOut: 0 },
  build() {
    const COUNT = 60
    const tracks: DroneTrack[] = []
    const goldenRatio = (1 + Math.sqrt(5)) / 2

    for (let i = 0; i < COUNT; i++) {
      // Fibonacci sphere distribution for even spread
      const theta = Math.acos(1 - (2 * (i + 0.5)) / COUNT)
      const phi = (2 * Math.PI * i) / goldenRatio
      const dx = Math.sin(theta) * Math.cos(phi)
      const dy = Math.cos(theta)
      const dz = Math.sin(theta) * Math.sin(phi)

      // startRadius 4.5 (was 1.5) — at N=60 on a fibonacci sphere, pair
      // spacing is ≈ 2.7r/√n, so r=1.5 produced 0.52m closest pair (sub-spec).
      // 4.5 yields ≈1.57m, just above the 1.5m floor. 2026-05-21.
      const startRadius = 4.5
      const expandRadius = 6 + Math.random() * 4
      const drift = 0.5 + Math.random() * 1

      const posKfs: PositionKeyframe[] = [
        pk(0, dx * startRadius, dy * startRadius, dz * startRadius, 'linear'),
        pk(0.1, dx * startRadius, dy * startRadius, dz * startRadius, 'ease-out'),
        pk(2.5, dx * expandRadius, dy * expandRadius, dz * expandRadius, 'ease-out'),
        pk(4, dx * (expandRadius + drift), dy * (expandRadius + drift) - 2, dz * (expandRadius + drift), 'ease-in'),
      ]

      // Bright center → color → dim
      const hue = (i / COUNT) * 360
      const h = hue / 60
      const x = 1 - Math.abs(h % 2 - 1)
      let r = 0, g = 0, b = 0
      if (h < 1) { r = 1; g = x }
      else if (h < 2) { r = x; g = 1 }
      else if (h < 3) { g = 1; b = x }
      else if (h < 4) { g = x; b = 1 }
      else if (h < 5) { r = x; b = 1 }
      else { r = 1; b = x }

      const colorKfs: ColorKeyframe[] = [
        ck(0, 1, 1, 1),                  // white flash
        ck(0.3, r, g, b),                // rainbow color
        ck(3, r * 0.5, g * 0.5, b * 0.5), // dim
        ck(4, 0.1, 0.1, 0.1),            // nearly off
      ]

      tracks.push({ positionKeyframes: posKfs, colorKeyframes: colorKfs })
    }

    return {
      duration: 4,
      droneCount: COUNT,
      tracks,
      playback: { mode: 'clamp', speed: 1, trimIn: 0, trimOut: 0 },
    }
  },
})

// ============================================================================
// Breathing Sphere — Expands and contracts
// ============================================================================

registerLibraryFormation({
  id: 'breathing-sphere',
  name: 'Breathing Sphere',
  description: 'A sphere that rhythmically expands and contracts',
  tags: ['geometric', 'animated', 'loop'],
  droneCount: 80,
  duration: 4,
  defaultPlayback: { mode: 'loop', speed: 1, trimIn: 0, trimOut: 0 },
  build() {
    const COUNT = 80
    const tracks: DroneTrack[] = []
    const goldenRatio = (1 + Math.sqrt(5)) / 2
    // rMin 5 (was 4) so the contracted phase keeps 80 drones on a fibonacci
    // sphere above the 1.5m pair-spacing floor (2.7·r/√n ≈ 1.51m at r=5, n=80).
    // 2026-05-21.
    const rMin = 5
    const rMax = 8

    for (let i = 0; i < COUNT; i++) {
      const theta = Math.acos(1 - (2 * (i + 0.5)) / COUNT)
      const phi = (2 * Math.PI * i) / goldenRatio
      const dx = Math.sin(theta) * Math.cos(phi)
      const dy = Math.cos(theta)
      const dz = Math.sin(theta) * Math.sin(phi)

      const posKfs: PositionKeyframe[] = [
        pk(0, dx * rMin, dy * rMin, dz * rMin, 'ease-in-out'),
        pk(2, dx * rMax, dy * rMax, dz * rMax, 'ease-in-out'),
        pk(4, dx * rMin, dy * rMin, dz * rMin, 'ease-in-out'),
      ]

      // Pulse color with breathing
      const colorKfs: ColorKeyframe[] = [
        ck(0, 0.2, 0.4, 1.0),
        ck(2, 0.6, 0.8, 1.0),
        ck(4, 0.2, 0.4, 1.0),
      ]

      tracks.push({ positionKeyframes: posKfs, colorKeyframes: colorKfs })
    }

    return {
      duration: 4,
      droneCount: COUNT,
      tracks,
      playback: { mode: 'loop', speed: 1, trimIn: 0, trimOut: 0 },
    }
  },
})
