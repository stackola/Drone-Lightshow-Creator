// ============================================================================
// S10-08 to S10-18: Color Program System
// ============================================================================
// Per-drone color support with reusable color programs.
// Programs: solid, gradient, sweep, rainbow, pulse, chase, custom
// ============================================================================

import type { Vec3, ColorProgramKeyframe } from './types'
import type { Color3 } from './colors'
import { applyEasing } from './easing'

// --- Color Program Types ---

export type ColorProgramType = 'solid' | 'gradient' | 'multi-gradient' | 'sweep' | 'rainbow' | 'pulse' | 'chase' | 'custom'

export interface ColorProgramBase {
  id: string
  name: string
  type: ColorProgramType
}

// S10-10: Solid
export interface SolidColorProgram extends ColorProgramBase {
  type: 'solid'
  color: Color3
}

// S10-11: Gradient (mapped by position along axis)
export interface GradientColorProgram extends ColorProgramBase {
  type: 'gradient'
  colorStart: Color3
  colorEnd: Color3
  axis: 'x' | 'y' | 'z'
}

// S10-12: Sweep (propagating color change)
export interface SweepColorProgram extends ColorProgramBase {
  type: 'sweep'
  colorFrom: Color3
  colorTo: Color3
  speed: number       // units per second
  direction: Vec3     // normalized direction vector
}

// S6 (2026-05-21) — Multi-stop gradient. Like `gradient` but with N≥2 colour
// stops at user-defined `t` positions in [0,1]. Stops are sorted by `t` at
// evaluation time. Falls back to nearest stop outside the [0,1] range.
export interface MultiStopGradientColorProgram extends ColorProgramBase {
  type: 'multi-gradient'
  stops: { t: number; color: Color3 }[]
  axis: 'x' | 'y' | 'z'
}

// S10-13: Rainbow (hue mapped by index or position)
export interface RainbowColorProgram extends ColorProgramBase {
  type: 'rainbow'
  mode: 'index' | 'spatial'
  axis: 'x' | 'y' | 'z' // for spatial mode
  saturation: number  // 0–1
  brightness: number  // 0–1
  speed: number       // hue rotation speed (revolutions/sec)
}

// S10-14: Pulse (brightness oscillation)
export interface PulseColorProgram extends ColorProgramBase {
  type: 'pulse'
  color: Color3
  frequency: number   // Hz
  amplitude: number   // 0–1
  minBrightness: number // 0–1
}

// S10-15: Chase (rotating pattern around perimeter)
export interface ChaseColorProgram extends ColorProgramBase {
  type: 'chase'
  colors: Color3[]     // pattern colors
  speed: number        // rotations per second
  width: number        // number of drones per color segment
}

// S10-16: Custom (per-drone keyframe)
export interface CustomColorProgram extends ColorProgramBase {
  type: 'custom'
  keyframes: { time: number; colors: Color3[] }[]
}

export type ColorProgram =
  | SolidColorProgram
  | GradientColorProgram
  | MultiStopGradientColorProgram
  | SweepColorProgram
  | RainbowColorProgram
  | PulseColorProgram
  | ChaseColorProgram
  | CustomColorProgram

// --- Color Program Registry (S10-09) + Bundle 7 user preset persistence ---

const programs = new Map<string, ColorProgram>()
const PRESET_STORAGE_KEY = 'drone-color-presets-v1'

function isUserPreset(id: string): boolean {
  return id.startsWith('custom-') || id.startsWith('user-')
}

function persistUserPresets(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const presets: ColorProgram[] = []
    programs.forEach((p) => { if (isUserPreset(p.id)) presets.push(p) })
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets))
  } catch {
    /* ignore */
  }
}

export function loadColorPresetsFromStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY)
    if (!raw) return
    const presets = JSON.parse(raw) as ColorProgram[]
    for (const p of presets) programs.set(p.id, p)
  } catch {
    /* ignore */
  }
}

export function registerColorProgram(program: ColorProgram): void {
  programs.set(program.id, program)
  if (isUserPreset(program.id)) persistUserPresets()
}

export function getColorProgram(id: string): ColorProgram | undefined {
  return programs.get(id)
}

export function getAllColorPrograms(): ColorProgram[] {
  return Array.from(programs.values())
}

export function removeColorProgram(id: string): void {
  programs.delete(id)
  if (isUserPreset(id)) persistUserPresets()
}

// --- Color Evaluation (S10-08, S10-20) ---

/**
 * Evaluate a color program for a specific drone at a specific time.
 * Returns per-drone color based on program type, drone position, index, and time.
 */
export function evaluateColorProgram(
  program: ColorProgram,
  droneIndex: number,
  totalDrones: number,
  position: Vec3,
  time: number,
  allPositions?: Vec3[],
): Color3 {
  switch (program.type) {
    case 'solid':
      return { ...program.color }

    case 'gradient':
      return evaluateGradient(program, position, allPositions)

    case 'multi-gradient':
      return evaluateMultiGradient(program, position, allPositions)

    case 'sweep':
      return evaluateSweep(program, position, time)

    case 'rainbow':
      return evaluateRainbow(program, droneIndex, totalDrones, position, time)

    case 'pulse':
      return evaluatePulse(program, time)

    case 'chase':
      return evaluateChase(program, droneIndex, totalDrones, time)

    case 'custom':
      return evaluateCustom(program, droneIndex, time)

    default:
      return { r: 1, g: 1, b: 1 }
  }
}

function evaluateGradient(program: GradientColorProgram, position: Vec3, allPositions?: Vec3[]): Color3 {
  // Find min/max along axis for normalization
  let min = 0, max = 1
  if (allPositions && allPositions.length > 0) {
    const values = allPositions.map((p) => p[program.axis])
    min = Math.min(...values)
    max = Math.max(...values)
  }
  const range = max - min || 1
  const t = (position[program.axis] - min) / range

  return lerpColor3(program.colorStart, program.colorEnd, t)
}

function evaluateMultiGradient(
  program: MultiStopGradientColorProgram,
  position: Vec3,
  allPositions?: Vec3[],
): Color3 {
  if (program.stops.length === 0) return { r: 1, g: 1, b: 1 }
  if (program.stops.length === 1) return { ...program.stops[0]!.color }
  // Same axis-normalisation as the 2-stop gradient.
  let min = 0, max = 1
  if (allPositions && allPositions.length > 0) {
    const values = allPositions.map((p) => p[program.axis])
    min = Math.min(...values)
    max = Math.max(...values)
  }
  const range = max - min || 1
  const t = (position[program.axis] - min) / range
  // Sort stops by `t` for deterministic interpolation. Returns the nearest
  // stop's colour when `t` is outside [0, 1] (i.e. clamp, not extrapolate).
  const sorted = [...program.stops].sort((a, b) => a.t - b.t)
  if (t <= sorted[0]!.t) return { ...sorted[0]!.color }
  if (t >= sorted[sorted.length - 1]!.t) return { ...sorted[sorted.length - 1]!.color }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    if (t >= a.t && t <= b.t) {
      const local = (t - a.t) / Math.max(1e-6, b.t - a.t)
      return lerpColor3(a.color, b.color, local)
    }
  }
  return { ...sorted[sorted.length - 1]!.color }
}

function evaluateSweep(program: SweepColorProgram, position: Vec3, time: number): Color3 {
  const d = position.x * program.direction.x + position.y * program.direction.y + position.z * program.direction.z
  const wave = d - time * program.speed
  const t = Math.max(0, Math.min(1, (Math.sin(wave) + 1) / 2))
  return lerpColor3(program.colorFrom, program.colorTo, t)
}

function evaluateRainbow(program: RainbowColorProgram, index: number, total: number, position: Vec3, time: number): Color3 {
  let hue: number
  if (program.mode === 'index') {
    hue = (index / Math.max(1, total)) + time * program.speed
  } else {
    hue = position[program.axis] * 0.1 + time * program.speed
  }
  hue = ((hue % 1) + 1) % 1
  return hsvToRgb(hue, program.saturation, program.brightness)
}

function evaluatePulse(program: PulseColorProgram, time: number): Color3 {
  const phase = Math.sin(time * program.frequency * Math.PI * 2)
  const brightness = program.minBrightness + (1 - program.minBrightness) * program.amplitude * (phase + 1) / 2
  return {
    r: program.color.r * brightness,
    g: program.color.g * brightness,
    b: program.color.b * brightness,
  }
}

function evaluateChase(program: ChaseColorProgram, index: number, total: number, time: number): Color3 {
  if (program.colors.length === 0) return { r: 1, g: 1, b: 1 }
  const totalSegments = program.colors.length
  const offset = time * program.speed * totalSegments
  const pos = ((index / Math.max(1, program.width)) + offset) % totalSegments
  const segIndex = Math.floor(((pos % totalSegments) + totalSegments) % totalSegments)
  return { ...program.colors[segIndex % program.colors.length]! }
}

function evaluateCustom(program: CustomColorProgram, droneIndex: number, time: number): Color3 {
  if (program.keyframes.length === 0) return { r: 1, g: 1, b: 1 }
  if (program.keyframes.length === 1) {
    const colors = program.keyframes[0]!.colors
    return droneIndex < colors.length ? { ...colors[droneIndex]! } : { r: 1, g: 1, b: 1 }
  }

  // Find surrounding keyframes
  let i = 0
  while (i < program.keyframes.length - 1 && program.keyframes[i + 1]!.time <= time) i++

  if (i >= program.keyframes.length - 1) {
    const colors = program.keyframes[program.keyframes.length - 1]!.colors
    return droneIndex < colors.length ? { ...colors[droneIndex]! } : { r: 1, g: 1, b: 1 }
  }

  const kf0 = program.keyframes[i]!
  const kf1 = program.keyframes[i + 1]!
  const t = (time - kf0.time) / (kf1.time - kf0.time || 1)

  const c0 = droneIndex < kf0.colors.length ? kf0.colors[droneIndex]! : { r: 1, g: 1, b: 1 }
  const c1 = droneIndex < kf1.colors.length ? kf1.colors[droneIndex]! : { r: 1, g: 1, b: 1 }
  return lerpColor3(c0, c1, t)
}

// --- Helpers ---

function lerpColor3(a: Color3, b: Color3, t: number): Color3 {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

function hsvToRgb(h: number, s: number, v: number): Color3 {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0: return { r: v, g: t, b: p }
    case 1: return { r: q, g: v, b: p }
    case 2: return { r: p, g: v, b: t }
    case 3: return { r: p, g: q, b: v }
    case 4: return { r: t, g: p, b: v }
    case 5: return { r: v, g: p, b: q }
    default: return { r: v, g: v, b: v }
  }
}

/**
 * Bundle 4: evaluate the color for a drone given a (possibly empty) keyframe list.
 *
 * Falls back to fallbackProgramId when keyframes is empty. Programs are evaluated at
 * absolute time so pulse/sweep phases survive across keyframes; only the per-drone RGB
 * is lerped between the two bracketing keyframes.
 */
export function evaluateColorAtKeyframes(
  keyframes: ColorProgramKeyframe[] | undefined,
  fallbackProgramId: string | null,
  droneIndex: number,
  totalDrones: number,
  position: Vec3,
  localTime: number,
  absTime: number,
  allPositions?: Vec3[],
): Color3 | null {
  if (!keyframes || keyframes.length === 0) {
    if (!fallbackProgramId) return null
    const prog = getColorProgram(fallbackProgramId)
    if (!prog) return null
    return evaluateColorProgram(prog, droneIndex, totalDrones, position, absTime, allPositions)
  }

  const sorted = [...keyframes].sort((a, b) => a.time - b.time)

  if (localTime <= sorted[0]!.time) {
    const prog = getColorProgram(sorted[0]!.colorProgramId)
    if (!prog) return null
    return evaluateColorProgram(prog, droneIndex, totalDrones, position, absTime, allPositions)
  }
  const last = sorted[sorted.length - 1]!
  if (localTime >= last.time) {
    const prog = getColorProgram(last.colorProgramId)
    if (!prog) return null
    return evaluateColorProgram(prog, droneIndex, totalDrones, position, absTime, allPositions)
  }

  let i = 0
  while (i < sorted.length - 1 && sorted[i + 1]!.time <= localTime) i++
  const kfA = sorted[i]!
  const kfB = sorted[i + 1]!
  const span = kfB.time - kfA.time
  const rawU = span > 0 ? (localTime - kfA.time) / span : 0
  const u = applyEasing(rawU, kfB.easing ?? 'linear', undefined, kfB.bezierConfig)

  const progA = getColorProgram(kfA.colorProgramId)
  const progB = getColorProgram(kfB.colorProgramId)
  if (!progA && !progB) return null
  if (!progA) return progB ? evaluateColorProgram(progB, droneIndex, totalDrones, position, absTime, allPositions) : null
  if (!progB) return evaluateColorProgram(progA, droneIndex, totalDrones, position, absTime, allPositions)
  const cA = evaluateColorProgram(progA, droneIndex, totalDrones, position, absTime, allPositions)
  const cB = evaluateColorProgram(progB, droneIndex, totalDrones, position, absTime, allPositions)
  return lerpColor3(cA, cB, u)
}

// S10-19: Transition color interpolation helper
export function interpolateTransitionColors(
  fromColors: Color3[],
  toColors: Color3[],
  t: number,
  droneCount: number,
): Color3[] {
  const result: Color3[] = []
  for (let i = 0; i < droneCount; i++) {
    const from = i < fromColors.length ? fromColors[i]! : { r: 1, g: 1, b: 1 }
    const to = i < toColors.length ? toColors[i]! : { r: 1, g: 1, b: 1 }
    result.push(lerpColor3(from, to, t))
  }
  return result
}
