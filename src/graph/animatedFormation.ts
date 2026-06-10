// ============================================================================
// Animated Formation — Per-drone position + color keyframe interpolation
// ============================================================================
//
// Schema design:
//
//   AnimatedFormationDef {
//     duration        — total animation length in seconds
//     droneCount      — how many drones this animation is authored for
//     tracks[]        — one per drone, each with position & color keyframes
//     playback        — loop/boomerang/clamp, speed, trimIn/trimOut
//   }
//
//   DroneTrack {
//     positionKeyframes[]  — { time, value: Vec3, easing }
//     colorKeyframes[]     — { time, value: {r,g,b}, mode: 'lerp'|'step' }
//   }
//
// Playback modes:
//   - 'clamp'     — plays once, holds last frame after duration
//   - 'loop'      — wraps back to start after duration
//   - 'boomerang' — plays forward then backward, seamlessly
//
// If the formation node's duration exceeds the animation duration:
//   - clamp: holds last frame
//   - loop: wraps around (animation replays)
//   - boomerang: ping-pongs
//
// trimIn/trimOut allow using a sub-range of the animation.
// speed multiplies the local time progression.
//
// The formation node's whole-formation transform (base + keyframes) is applied
// ON TOP of the per-drone animated positions. This allows the user to move
// the entire animated formation around while drones animate internally.
// ============================================================================

import type { Vec3 } from './types'
import { applyEasingWithStep } from './easing'
import { v3lerp } from './vec3'
import { lerpColor, type Color3 } from './colors'
export type { Color3 } from './colors'

// --- Keyframe types ---

export type PositionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step'

export interface PositionKeyframe {
  time: number
  value: Vec3
  easing: PositionEasing
}

export type ColorMode = 'lerp' | 'step'

export interface ColorKeyframe {
  time: number
  value: Color3
  mode: ColorMode
}

// --- Drone track ---

export interface DroneTrack {
  positionKeyframes: PositionKeyframe[]
  colorKeyframes: ColorKeyframe[]
}

// --- Playback ---

export type PlaybackMode = 'clamp' | 'loop' | 'boomerang'

export interface PlaybackConfig {
  mode: PlaybackMode
  speed: number
  trimIn: number   // seconds from start to skip
  trimOut: number  // seconds from end to skip (0 = use full duration)
}

export const DEFAULT_PLAYBACK: PlaybackConfig = {
  mode: 'clamp',
  speed: 1,
  trimIn: 0,
  trimOut: 0,
}

// --- Animated formation definition ---

export interface AnimatedFormationDef {
  duration: number
  droneCount: number
  tracks: DroneTrack[]
  playback: PlaybackConfig
}

// ============================================================================
// Interpolation engine
// ============================================================================

// applyEasingWithStep, v3lerp, lerpColor imported from shared modules

/**
 * Compute effective local time accounting for playback config.
 * Returns the time to sample within the [trimIn, duration-trimOut] range.
 */
export function computeAnimationTime(
  localTime: number,
  duration: number,
  playback: PlaybackConfig,
): number {
  const { mode, speed, trimIn, trimOut } = playback
  const effectiveDuration = Math.max(0.001, duration - trimIn - trimOut)
  const t = (localTime * speed) - trimIn

  if (t <= 0) return trimIn
  if (mode === 'clamp') {
    return trimIn + Math.min(t, effectiveDuration)
  }

  if (mode === 'loop') {
    const wrapped = ((t % effectiveDuration) + effectiveDuration) % effectiveDuration
    return trimIn + wrapped
  }

  // boomerang: ping-pong
  const cycle = effectiveDuration * 2
  const wrapped = ((t % cycle) + cycle) % cycle
  if (wrapped <= effectiveDuration) {
    return trimIn + wrapped
  }
  return trimIn + (cycle - wrapped)
}

/**
 * Interpolate a drone's position at a given time from its position keyframes.
 * Keyframes must be sorted by time.
 */
export function interpolateDronePosition(
  keyframes: PositionKeyframe[],
  time: number,
): Vec3 | null {
  if (keyframes.length === 0) return null
  if (keyframes.length === 1) return keyframes[0]!.value

  const first = keyframes[0]!
  if (time <= first.time) return first.value

  const last = keyframes[keyframes.length - 1]!
  if (time >= last.time) return last.value

  // Find segment
  for (let i = 0; i < keyframes.length - 1; i++) {
    const kA = keyframes[i]!
    const kB = keyframes[i + 1]!
    if (time >= kA.time && time <= kB.time) {
      const segDuration = kB.time - kA.time
      const segT = segDuration > 0 ? (time - kA.time) / segDuration : 1
      const eased = applyEasingWithStep(Math.max(0, Math.min(1, segT)), kB.easing)
      if (kB.easing === 'step') return kA.value
      return v3lerp(kA.value, kB.value, eased)
    }
  }

  return last.value
}

/**
 * Interpolate a drone's color at a given time from its color keyframes.
 * Keyframes must be sorted by time.
 */
export function interpolateDroneColor(
  keyframes: ColorKeyframe[],
  time: number,
): Color3 | null {
  if (keyframes.length === 0) return null
  if (keyframes.length === 1) return keyframes[0]!.value

  const first = keyframes[0]!
  if (time <= first.time) return first.value

  const last = keyframes[keyframes.length - 1]!
  if (time >= last.time) return last.value

  // Find segment
  for (let i = 0; i < keyframes.length - 1; i++) {
    const kA = keyframes[i]!
    const kB = keyframes[i + 1]!
    if (time >= kA.time && time <= kB.time) {
      if (kB.mode === 'step') return kA.value
      const segDuration = kB.time - kA.time
      const segT = segDuration > 0 ? (time - kA.time) / segDuration : 1
      const clamped = Math.max(0, Math.min(1, segT))
      return lerpColor(kA.value, kB.value, clamped)
    }
  }

  return last.value
}

/**
 * Sample a full animated formation at a given local time.
 * Returns arrays of positions and colors for all drones.
 * localTime is the raw time since the formation started (before playback transforms).
 */
export function sampleAnimatedFormation(
  def: AnimatedFormationDef,
  localTime: number,
): { positions: (Vec3 | null)[]; colors: (Color3 | null)[] } {
  const animTime = computeAnimationTime(localTime, def.duration, def.playback)
  const positions: (Vec3 | null)[] = []
  const colors: (Color3 | null)[] = []

  for (let i = 0; i < def.droneCount; i++) {
    const track = def.tracks[i]
    if (!track) {
      positions.push(null)
      colors.push(null)
      continue
    }
    positions.push(interpolateDronePosition(track.positionKeyframes, animTime))
    colors.push(interpolateDroneColor(track.colorKeyframes, animTime))
  }

  return { positions, colors }
}

/**
 * Get the initial positions (frame 0) of an animated formation.
 * Used for static point cloud display and transition targets.
 */
export function getAnimatedFormationRestPositions(def: AnimatedFormationDef): Vec3[] {
  const positions: Vec3[] = []
  for (let i = 0; i < def.droneCount; i++) {
    const track = def.tracks[i]
    if (track && track.positionKeyframes.length > 0) {
      positions.push(track.positionKeyframes[0]!.value)
    } else {
      positions.push({ x: 0, y: 0, z: 0 })
    }
  }
  return positions
}

/**
 * Validate an animated formation's playback config.
 * Returns issues as strings, empty array if valid.
 */
export function validateAnimatedFormation(def: AnimatedFormationDef): string[] {
  const issues: string[] = []
  const { trimIn, trimOut } = def.playback
  if (trimIn + trimOut >= def.duration) {
    issues.push(`trimIn (${trimIn}s) + trimOut (${trimOut}s) >= duration (${def.duration}s) — effective duration collapses to near zero`)
  }
  if (def.playback.speed <= 0) {
    issues.push(`speed must be positive (got ${def.playback.speed})`)
  }
  if (def.tracks.length !== def.droneCount) {
    issues.push(`track count (${def.tracks.length}) doesn't match droneCount (${def.droneCount})`)
  }
  return issues
}
