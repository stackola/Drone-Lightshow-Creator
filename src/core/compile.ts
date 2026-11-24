// Compile a ShowDoc into a fully-timed, per-drone flight plan.
//
//   takeoff → flight → hold(scene 1) → flight → hold(scene 2) → … → flight → land
//
// Each flight is a synchronised min-jerk move along straight lines, with the
// drone↔point matching solved optimally (see assign.ts). The plan is pure data:
// `evaluate()` turns it into positions and colours at any time, and the same
// function feeds the preview, the validator and the exporters.

import type { Blend, Effect, Group, HoldMotion, Limits, Scene, ShowDoc, TransitionStyle, Vec3 } from './types'
import {
  PLAIN, buildAnt, buildCascade, buildRain, choreoPairs, choreoPeaks, choreoPos, legCentroids, minDurationFor, sampledPeaks, wrapPos,
  TRANSITIONS, type Choreo, type FlightStyle, type TransitionInfo, type Wrap,
} from './transitions'
import { assignMinSquared } from './assign'
import { allocate, hasSplit, pointGroups } from './groups'
import { generateShape, gridRows } from './shapes'
import { DEG, ceilTo, centroid, hash01, hashArray, isIdentityRotation, minPairDistance, rotationMatrix, transformPoints } from './math'
import { NO_MOTION, ZERO_PROFILE, fastestProfile, moveExtents, spinAngle, stretchProfile, type Profile } from './motion'
import { comfortableSpacing, flightClosestApproach } from './separation'
import { blankLook, effectColor, type BeatPhase, type DroneLook } from './effects'
import type { RGB } from './color'

/** Dim warm white used while taking off and landing. */
export const GROUND_COLOR: RGB = [0.22, 0.2, 0.16]

/** Comfort margin applied to automatic flight durations. */
export const AUTO_FLIGHT_MARGIN = 1.2
export const MIN_AUTO_FLIGHT = 2

export interface CompiledScene {
  id: string
  index: number
  /** World positions at hold start, in point order. */
  points: Float32Array
  /** World positions at hold end (after spin), in point order. */
  endPoints: Float32Array
  /** Spin axis (vertical, through x/z of the centre). */
  center: Vec3
  /** rad/s */
  omega: number
  hold: number
  /** drone → point index */
  slot: Int32Array
  /** point → layer index */
  layerOf: Uint16Array
  layerCounts: number[]
  effects: Effect[]
  /** Per point: u, v, order, rand */
  look: Float32Array
  /** Per point image rgb, or null. */
  image: Float32Array | null
  /** Smallest distance between two drones in this formation. */
  spacing: number
  /** Largest horizontal distance of any drone from the spin axis. */
  spinRadius: number
  /** Motion while held (breathe / bob / sway), on top of spin. */
  motion: HoldMotion
}

/**
 * One synchronised straight-line move of every drone. A flight is one
 * 'direct' leg, or — when a straight flight would bring drones too close — a
 * collision-avoiding detour: 'spread' (the formation expands: distances only
 * grow), 'cross' (between two well-spaced formations, provably collision-free
 * with optimal assignment) and 'gather' (the target contracts: distances only
 * shrink to its own safe spacing).
 */
export interface Leg {
  t0: number
  t1: number
  from: Float32Array
  to: Float32Array
  profile: Profile
  kind: 'direct' | 'spread' | 'cross' | 'gather'
}

export type Segment =
  | { kind: 'takeoff'; t0: number; t1: number; from: Float32Array; to: Float32Array; legs: Leg[] }
  | {
      kind: 'flight'
      t0: number
      t1: number
      legs: Leg[]
      /** True when the flight takes the collision-avoiding detour. */
      detour: boolean
      /** Choreographed transition (swirl/burst wrap the legs; cascade/rain/ant replace them). */
      style?: FlightStyle
      transition: TransitionInfo
      /** Lowest altitude this flight may use (below the floor only when it starts or ends on the pads). */
      floor: number
      from: Float32Array
      to: Float32Array
      c0: Float32Array
      c1: Float32Array
      dim: boolean
      /** Target scene index, or -1 for the return flight. */
      into: number
      minDuration: number
      auto: boolean
      /** True when a manual duration was too short and has been extended. */
      extended: boolean
    }
  | { kind: 'hold'; t0: number; t1: number; scene: number }
  | { kind: 'land'; t0: number; t1: number; from: Float32Array; to: Float32Array; legs: Leg[] }
  /** Groups flying their own sequences after `scene`'s hold, until everyone merges into the next scene. */
  | { kind: 'split'; t0: number; t1: number; scene: number; tracks: Track[] }

export type FlightSegment = Extract<Segment, { kind: 'flight' }>

/**
 * A segment of one group's timeline. Holds play `scene` (a step index, or -1
 * for the formation the group split from) from hold-local time `tau0`; the
 * pose stops at the end of the scene's own hold (the group then waits, still),
 * while colours keep animating.
 */
export type TrackSegment = FlightSegment | { kind: 'hold'; t0: number; t1: number; scene: number; tau0: number }

export interface SceneTime {
  id: string
  flightStart: number
  holdStart: number
  holdEnd: number
  /** When everyone is back together after this scene's groups (= holdEnd without groups). */
  splitEnd: number
  minFlight: number
  auto: boolean
  extended: boolean
  detour: boolean
  transition: TransitionInfo
}

/** One group's own timeline during a split (or the drones that stay behind, id ''). */
export interface Track {
  id: string
  name: string
  /** Show-wide drone index of each of this track's drones. */
  drones: Int32Array
  /** Point of the parent formation each drone held when the split began. */
  parentSlot: Int32Array
  steps: CompiledScene[]
  segments: TrackSegment[]
  stepTimes: SceneTime[]
  /** When the group's own sequence ends; it then holds still until the merge. */
  end: number
}

export interface Compiled {
  n: number
  duration: number
  segments: Segment[]
  scenes: CompiledScene[]
  /** Takeoff pads (drone order). */
  pads: Float32Array
  /** Landing pads (drone order). */
  landPads: Float32Array
  /** Beat times in show time. */
  beats: number[]
  /** Index into `beats` of the first downbeat. */
  downbeat: number
  /** Music loudness per beat (aligned with `beats`). */
  musicEnergy: number[]
  /** Accents (stand-out hits) in show time. */
  accents: number[]
  limits: Limits
  /** Light cues, sorted by start. */
  cues: CompiledCue[]
  /** Normalisation for position-based cue effects: centre and half-extent of the show. */
  stage: { cx: number; cy: number; r: number; minX: number; maxX: number; minY: number; maxY: number }
  /** Everything the audience should see: the stage plus where spectacle transitions travel (for camera framing). */
  view: { minX: number; maxX: number; maxY: number }
  /** Times for UI. */
  takeoff: { t0: number; t1: number }
  landing: { t0: number; t1: number }
  returnFlight: { t0: number; t1: number; minDuration: number; auto: boolean; extended: boolean; detour: boolean; transition: TransitionInfo }
  sceneTimes: SceneTime[]
}

export interface CompiledCue {
  id: string
  t0: number
  t1: number
  fadeIn: number
  fadeOut: number
  blend: Blend
  effect: Effect
}

// --- Layout helpers ---------------------------------------------------------------

export { allocate }

export function padGrid(n: number, spacing: number, altitude = 0): Float32Array {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.ceil(n / cols)
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols)
    out[i * 3] = (c - (cols - 1) / 2) * spacing
    out[i * 3 + 1] = altitude
    out[i * 3 + 2] = (r - (rows - 1) / 2) * spacing
  }
  return out
}

export interface SceneGeometry {
  points: Float32Array
  layerOf: Uint16Array
  layerCounts: number[]
  look: Float32Array
  image: Float32Array | null
}

/** Per-point look data stride: u, v, order, rand, glyphs, half-width, half-height, grid rows (see DroneLook). */
export const LOOK = 8

/** World-space points for a scene at hold start (point order), plus per-point look data. */
export function sceneGeometry(scene: Scene, n: number): SceneGeometry {
  const counts = allocate(n, scene.layers.map((l) => l.weight))
  const points = new Float32Array(n * 3)
  const layerOf = new Uint16Array(n)
  const look = new Float32Array(n * LOOK)
  let image: Float32Array | null = null
  const sceneRot = isIdentityRotation(scene.rotation) ? null : rotationMatrix(scene.rotation)
  let o = 0
  scene.layers.forEach((layer, li) => {
    const c = counts[li]!
    if (c === 0) return
    const { points: local, colors, order, glyphs } = generateShape(layer.shape, c)
    // Rows of drones in a grid layer (LED panels): lets dot-matrix text sit on exact rows.
    const rows = layer.shape.kind === 'grid' && layer.shape.fill !== 'outline' ? gridRows(c, layer.shape.aspect) : 0
    // Normalise for effects using the unrotated local shape.
    let ext = 1e-9, extX = 1e-9, extY = 1e-9
    for (let k = 0; k < c; k++) {
      const ax = Math.abs(local[k * 3]!), ay = Math.abs(local[k * 3 + 1]!)
      ext = Math.max(ext, ax, ay, Math.abs(local[k * 3 + 2]!))
      extX = Math.max(extX, ax); extY = Math.max(extY, ay)
    }
    for (let k = 0; k < c; k++) {
      const L = (o + k) * LOOK
      look[L] = local[k * 3]! / ext
      look[L + 1] = local[k * 3 + 1]! / ext
      look[L + 2] = order ? order[k]! : c > 1 ? k / (c - 1) : 0
      look[L + 3] = hash01(k, li * 7919 + 17)
      look[L + 4] = glyphs ?? 0
      look[L + 5] = extX / ext
      look[L + 6] = extY / ext
      look[L + 7] = rows
      layerOf[o + k] = li
    }
    if (colors) {
      image ??= new Float32Array(n * 3).fill(1)
      image.set(colors, o * 3)
    }
    transformPoints(local, isIdentityRotation(layer.rotation) ? null : rotationMatrix(layer.rotation), layer.offset)
    transformPoints(local, sceneRot, scene.position)
    points.set(local, o * 3)
    o += c
  })
  return { points, layerOf, layerCounts: counts, look, image }
}

export function rotateAboutVertical(src: Float32Array, center: Vec3, angle: number, out = new Float32Array(src.length)): Float32Array {
  const c = Math.cos(angle), s = Math.sin(angle)
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i]! - center[0], z = src[i + 2]! - center[2]
    out[i] = center[0] + c * x + s * z
    out[i + 1] = src[i + 1]!
    out[i + 2] = center[2] - s * x + c * z
  }
  return out
}

// --- Matching cache ------------------------------------------------------------------

const matchCache = new Map<string, Int32Array>()

function cachedMatch(from: Float32Array, to: Float32Array): Int32Array {
  const key = `${from.length}:${hashArray(from)}:${hashArray(to)}`
  let m = matchCache.get(key)
  if (!m) {
    m = assignMinSquared(from, to)
    matchCache.set(key, m)
    if (matchCache.size > 400) matchCache.delete(matchCache.keys().next().value as string)
  }
  return m
}

// --- Beats ---------------------------------------------------------------------------

export function showBeats(doc: ShowDoc): number[] {
  if (!doc.audio) return []
  return doc.audio.beats.map((b) => b + doc.audio!.offset)
}

/** Show-time accents of the doc's music. */
export function showAccents(doc: ShowDoc): number[] {
  const a = doc.audio
  return a?.accents ? a.accents.map((t) => t + a.offset) : []
}

/** The music clock: beat phase, loudness and time since the last accent at any show time. */
export function beatPhaseFn(beats: number[], downbeat = 0, energy: number[] = [], accents: number[] = []): BeatPhase {
  if (beats.length < 2) return () => null
  return (t: number) => {
    if (t < beats[0]! || t > beats[beats.length - 1]! + 2) return null
    let lo = 0, hi = beats.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (beats[mid]! <= t) lo = mid
      else hi = mid - 1
    }
    const a = beats[lo]!
    const b = beats[lo + 1] ?? a + (a - beats[lo - 1]!)
    const phase = Math.max(0, Math.min(1, (t - a) / Math.max(1e-3, b - a)))
    const e0 = energy[lo], e1 = energy[lo + 1] ?? e0
    let accentSince = Infinity
    if (accents.length && t >= accents[0]!) {
      let l = 0, h = accents.length - 1
      while (l < h) { const m = (l + h + 1) >> 1; if (accents[m]! <= t) l = m; else h = m - 1 }
      accentSince = t - accents[l]!
    }
    return { phase, index: lo - downbeat, since: t - a, energy: e0 === undefined ? 0.5 : e0 + ((e1 ?? e0) - e0) * phase, accentSince }
  }
}

// --- Compile -------------------------------------------------------------------------

/** Automatic flight duration: the fastest safe time plus a comfort margin, rounded up to 0.5 s. */
export function autoFlightDuration(min: number): number {
  return min <= 1e-9 ? 0 : Math.max(MIN_AUTO_FLIGHT, ceilTo(min * AUTO_FLIGHT_MARGIN, 0.5))
}

interface Move { from: Float32Array; to: Float32Array; kind: Leg['kind'] }

/**
 * Scale a formation about its centroid by k (distances between drones grow by
 * exactly k), then shift it so it stays inside the airspace where possible.
 */
export function expandSet(set: Float32Array, k: number, limits: Limits): Float32Array {
  if (k <= 1.0001) return set
  const c = centroid(set)
  const out = new Float32Array(set.length)
  let minY = Infinity, maxY = -Infinity
  for (let i = 0; i < set.length; i += 3) {
    out[i] = c[0] + k * (set[i]! - c[0])
    out[i + 1] = c[1] + k * (set[i + 1]! - c[1])
    out[i + 2] = c[2] + k * (set[i + 2]! - c[2])
    minY = Math.min(minY, out[i + 1]!)
    maxY = Math.max(maxY, out[i + 1]!)
  }
  // Translation never changes distances, so shifting into the airspace keeps the guarantee.
  const lo = limits.minAltitude + 1 - minY, hi = limits.maxAltitude - 1 - maxY
  const dy = lo <= hi ? Math.min(Math.max(0, lo), hi) : (lo + hi) / 2
  let maxR = 0
  for (let i = 0; i < out.length; i += 3) {
    out[i + 1]! += dy
    maxR = Math.max(maxR, Math.hypot(out[i]!, out[i + 2]!))
  }
  const ch = Math.hypot(c[0], c[2])
  const excess = maxR - (limits.maxRadius - 1)
  if (excess > 0 && ch > 1e-6) {
    const shift = Math.min(excess, ch)
    for (let i = 0; i < out.length; i += 3) {
      out[i]! -= (c[0] / ch) * shift
      out[i + 2]! -= (c[2] / ch) * shift
    }
  }
  return out
}

/**
 * Plan how drones get from one formation to the next. Straight synchronised
 * flight with optimal assignment when that keeps every pair apart; otherwise
 * the spread-cross-gather detour, whose crossing leg runs between formations
 * spaced at least √2 × the minimum — which optimal assignment makes
 * collision-free (Turpin, Michael & Kumar, 2014). Every leg is still checked
 * exactly by the validator.
 */
function planRoute(
  prevSet: Float32Array, prevSpacing: number, curSlot: Int32Array,
  targetSet: Float32Array, targetSpacing: number, limits: Limits, fixedSlot: Int32Array | null,
): { slot: Int32Array; moves: Move[]; detour: boolean } {
  const n = curSlot.length
  const compose = (m: Int32Array) => {
    const out = new Int32Array(n)
    for (let i = 0; i < n; i++) out[i] = m[curSlot[i]!]!
    return out
  }
  const slot0 = fixedSlot ?? compose(cachedMatch(prevSet, targetSet))
  const from = permute(prevSet, curSlot)
  const direct = { slot: slot0, moves: [{ from, to: permute(targetSet, slot0), kind: 'direct' as const }], detour: false }
  if (n < 2) return direct
  const d0 = flightClosestApproach(from, direct.moves[0]!.to, limits.minSpacing).d
  if (d0 + 1e-6 >= limits.minSpacing) return direct
  const need = comfortableSpacing(limits.minSpacing)
  const kA = prevSpacing > 1e-6 ? Math.min(2.5, Math.max(1, need / prevSpacing)) : 1
  const kB = targetSpacing > 1e-6 ? Math.min(2.5, Math.max(1, need / targetSpacing)) : 1
  const A2 = expandSet(prevSet, kA, limits)
  const B2 = expandSet(targetSet, kB, limits)
  const slot1 = fixedSlot ?? compose(cachedMatch(A2, B2))
  const a2 = permute(A2, curSlot), b2 = permute(B2, slot1)
  const moves: Move[] = []
  if (A2 !== prevSet) moves.push({ from, to: a2, kind: 'spread' })
  moves.push({ from: a2, to: b2, kind: 'cross' })
  if (B2 !== targetSet) moves.push({ from: b2, to: permute(targetSet, slot1), kind: 'gather' })
  // Keep the detour only if it really flies wider than the straight route.
  const d1 = Math.min(...moves.map((m) => flightClosestApproach(m.from, m.to, limits.minSpacing).d))
  return d1 > d0 + 1e-6 ? { slot: slot1, moves, detour: true } : direct
}

/** Time a route: automatic, or the requested duration (never faster than safe). Legs share the stretch. */
function timeRoute(moves: Move[], limits: Limits, requested: number | null, t0: number): { legs: Leg[]; min: number; auto: boolean; extended: boolean; T: number } {
  const fast = moves.map((m) => fastestProfile(moveExtents(m.from, m.to), limits))
  const min = fast.reduce((a, p) => a + p.T, 0)
  let T: number, auto = false, extended = false
  if (requested === null) {
    T = autoFlightDuration(min)
    auto = true
  } else {
    const floor = ceilTo(min, 0.1)
    if (requested + 1e-9 < floor) { T = floor; extended = true } else T = Math.max(0, requested)
  }
  const k = min > 1e-9 ? T / min : 0
  let t = t0
  const legs = moves.map((m, i) => {
    const dur = min > 1e-9 ? fast[i]!.T * k : i === 0 ? T : 0
    const profile = dur > 0 ? stretchProfile(fast[i]!.T > 0 ? fast[i]! : ZERO_PROFILE, dur) : ZERO_PROFILE
    const leg: Leg = { t0: t, t1: t + dur, from: m.from, to: m.to, profile, kind: m.kind }
    t += dur
    return leg
  })
  return { legs, min, auto, extended, T }
}

interface PlannedFlight {
  slot: Int32Array
  legs: Leg[]
  detour: boolean
  T: number
  min: number
  auto: boolean
  extended: boolean
  style?: FlightStyle
  transition: TransitionInfo
  floor: number
}

function lowest(p: Float32Array): number {
  let m = Infinity
  for (let i = 1; i < p.length; i += 3) m = Math.min(m, p[i]!)
  return m
}

/** Pick T from a minimum: automatic (with margin) or the requested time, never below the minimum. */
function chooseDuration(min: number, requested: number | null): { T: number; auto: boolean; extended: boolean } {
  if (requested === null) return { T: autoFlightDuration(min), auto: true, extended: false }
  const floor = ceilTo(min, 0.1)
  return requested + 1e-9 < floor ? { T: floor, auto: false, extended: true } : { T: Math.max(0, requested), auto: false, extended: false }
}

const label = (k: string) => TRANSITIONS.find((x) => x.kind === k)?.label ?? k

/**
 * Plan one flight: the safe route (straight or detour), then the requested
 * transition style on top of it. Styles that would bring drones too close or
 * leave the airspace are softened step by step; if even the gentlest version
 * fails, the flight falls back to the plain route and says why.
 */
function planFlight(
  style: TransitionStyle | undefined, from: Float32Array, prevSet: Float32Array, prevSpacing: number, curSlot: Int32Array,
  targetSet: Float32Array, targetSpacing: number, limits: Limits, requested: number | null, t0: number, fixedSlot: Int32Array | null,
): PlannedFlight {
  const n = curSlot.length
  const want = style?.kind ?? 'direct'
  // Swirl turns the flying formation by any angle: plan the plain flight to a
  // counter-rotated copy of the target, and the swirl turns it back into place.
  const turns = want === 'swirl' ? Math.max(-3, Math.min(3, style?.turns ?? 0.5)) || 0.5 : 0
  const aimSet = turns ? rotateAboutVertical(targetSet, centroid(targetSet), -2 * Math.PI * turns) : targetSet
  const route = planRoute(prevSet, prevSpacing, curSlot, aimSet, targetSpacing, limits, fixedSlot)
  const floor = Math.min(limits.minAltitude, lowest(from), lowest(targetSet))
  const plain = (note: string | null): PlannedFlight => {
    const r = timeRoute(route.moves, limits, requested, t0)
    return {
      slot: route.slot, legs: r.legs, detour: route.detour, T: r.T, min: r.min, auto: r.auto, extended: r.extended, floor,
      transition: want === 'direct' ? PLAIN : { requested: want, used: 'direct', strength: 0, note },
    }
  }
  if (want === 'direct' || n < 2 || !style) return plain(null)
  const inAir = (e: { minY: number; maxY: number; maxR: number }) => e.minY >= floor - 1e-6 && e.maxY <= limits.maxAltitude + 1e-6 && e.maxR <= limits.maxRadius + 1e-6
  const amount = Math.max(0, Math.min(1, style.amount))

  if (want === 'swirl' || want === 'burst') {
    const wkey = `${want}|${JSON.stringify(style)}|${JSON.stringify(limits)}|${floor}|${hashArray(from)}|${hashArray(aimSet)}|${route.moves.length}`
    const hit = wrapCache.get(wkey)
    if (hit) {
      if (!hit.wrap) return plain(hit.note)
      const d = chooseDuration(hit.min, requested)
      return {
        slot: route.slot, legs: timeRoute(route.moves, limits, d.T, t0).legs, detour: route.detour, T: d.T, min: hit.min, auto: d.auto, extended: d.extended, floor,
        style: { kind: 'wrap', wrap: hit.wrap }, transition: { requested: want, used: want, strength: hit.strength, note: hit.note },
      }
    }
    const remember = (v: WrapPlan) => { wrapCache.set(wkey, v); if (wrapCache.size > 64) wrapCache.delete(wrapCache.keys().next().value as string) }
    const ref = timeRoute(route.moves, limits, null, 0)
    const Tref = Math.max(ref.T, 1)
    const legsRef = timeRoute(route.moves, limits, Tref, 0).legs
    const cents = legCentroids(legsRef)
    const tryWrap = (expand: number) => {
      const wrap = { turns, expand, ...cents }
      const pk = sampledPeaks(n, (u, out) => wrapPos(legsRef, wrap, 0, Tref, u * Tref, out), 480)
      return { wrap, pk }
    }
    const fullExpand = want === 'burst' ? 1 + 1.5 * Math.max(0.05, amount) : 1
    let best = tryWrap(fullExpand), strength = 1
    if (!inAir(best.pk)) {
      if (want === 'swirl') { const note = 'The swirling formation would leave the airspace — flying direct.'; remember({ wrap: null, min: 0, strength: 0, note }); return plain(note) }
      // Burst: find the largest expansion that stays inside the airspace.
      let lo = 1, hi = fullExpand
      for (let k = 0; k < 7; k++) {
        const mid = (lo + hi) / 2
        if (inAir(tryWrap(mid).pk)) lo = mid
        else hi = mid
      }
      if (lo < 1.15) { const note = 'No room in the airspace for the formation to burst outward — flying direct.'; remember({ wrap: null, min: 0, strength: 0, note }); return plain(note) }
      best = tryWrap(lo)
      strength = (lo - 1) / (fullExpand - 1)
    }
    const min = Math.max(ref.min, minDurationFor(best.pk, limits))
    const note = strength < 0.999 ? `Burst limited to ${Math.round(strength * 100)}% to stay inside the airspace.` : null
    remember({ wrap: best.wrap, min, strength, note })
    const d = chooseDuration(min, requested)
    const legs = timeRoute(route.moves, limits, d.T, t0).legs
    return {
      slot: route.slot, legs, detour: route.detour, T: d.T, min, auto: d.auto, extended: d.extended, floor,
      style: { kind: 'wrap', wrap: best.wrap },
      transition: { requested: want, used: want, strength, note },
    }
  }

  // Choreographed: cascade, rain, ant walk.
  if ((want === 'rain' || want === 'ant') && fixedSlot) return plain(`${label(want)} reorders drones, but landing returns each drone to its own pad — flying direct.`)
  const target = permute(targetSet, route.slot)
  const key = `${want}|${JSON.stringify(style)}|${JSON.stringify(limits)}|${floor}|${hashArray(from)}|${hashArray(targetSet)}|${hashArray(route.slot as unknown as Float32Array)}`
  const cached = choreoCache.get(key)
  if (cached) return finishChoreo(cached, requested, floor, want)
  const done = (r: ChoreoPlan): PlannedFlight => {
    choreoCache.set(key, r)
    if (choreoCache.size > 64) choreoCache.delete(choreoCache.keys().next().value as string)
    return finishChoreo(r, requested, floor, want)
  }
  // Softening: the ant walk spaces rows wider; cascade and rain search for the strongest safe stagger
  // (rain at zero stagger falls and rises in sync, which is always available).
  const build = (f: number): { choreo: Choreo; slot: Int32Array } | null => {
    const D = 0.9 * Math.max(0.1, amount) * f
    if (want === 'cascade') return { choreo: buildCascade(from, target, style.order ?? 'left', D, limits), slot: route.slot }
    if (want === 'rain') return buildRain(from, targetSet, limits, floor, D)
    return buildAnt(from, targetSet, limits, floor, style.lanes ?? 0, f)
  }
  const test = (f: number) => {
    const built = build(f)
    if (!built) return null
    const pk = choreoPeaks(built.choreo)
    if (!inAir(choreoExtents(built.choreo, n))) return { built, pk, ok: false }
    const pairs = choreoPairs(built.choreo, n, limits.minSpacing, pk.acc, Math.hypot(pk.h, Math.max(pk.up, pk.down)))
    return { built, pk, ok: pairs.d + 1e-6 >= limits.minSpacing }
  }
  const accept = (r: { built: { choreo: Choreo; slot: Int32Array }; pk: ReturnType<typeof choreoPeaks> }, f: number) => {
    const note = f >= 0.999 && want !== 'ant' ? null
      : want === 'ant' ? (f > 1 ? `Rows spaced ${f}× wider to keep drones apart.` : null)
        : f === 0 ? 'Drones fall and rise together (no drip stagger) to keep them apart.'
          : `${label(want)} softened to ${Math.round(f * 100)}% to keep drones apart.`
    return done({ ok: true, choreo: r.built.choreo, slot: r.built.slot, min: minDurationFor(r.pk, limits), strength: want === 'ant' ? 1 / f : f, note })
  }
  if (want === 'ant') {
    for (const f of [1, 1.5, 2.2]) {
      const r = test(f)
      if (!r) return plain('No room for the ant walk’s arch in the airspace — flying direct.')
      if (r.ok) return accept(r, f)
    }
  } else {
    const full = test(1)
    if (full?.ok) return accept(full, 1)
    // Largest safe stagger by bisection.
    let lo = 0, hi = 1, best: { f: number; r: NonNullable<ReturnType<typeof test>> } | null = null
    for (let k = 0; k < 5; k++) {
      const mid = (lo + hi) / 2
      const r = test(mid)
      if (r?.ok) { lo = mid; best = { f: Math.round(mid * 100) / 100, r } } else hi = mid
    }
    if (best && best.f >= 0.15) return accept(best.r, best.f)
    if (want === 'rain') {
      const sync = test(0)
      if (sync?.ok) return accept(sync, 0)
    }
  }
  return plain(`${label(want)} would bring drones too close or out of the airspace here — flying direct${route.detour ? ' (with a safe detour)' : ''}.`)
}

interface WrapPlan { wrap: Wrap | null; min: number; strength: number; note: string | null }
const wrapCache = new Map<string, WrapPlan>()

interface ChoreoPlan { ok: true; choreo: Choreo; slot: Int32Array; min: number; strength: number; note: string | null }
const choreoCache = new Map<string, ChoreoPlan>()

function finishChoreo(r: ChoreoPlan, requested: number | null, floor: number, want: TransitionStyle['kind']): PlannedFlight {
  const d = chooseDuration(r.min, requested)
  return {
    slot: r.slot, legs: [], detour: false, T: d.T, min: r.min, auto: d.auto, extended: d.extended, floor,
    style: { kind: 'choreo', choreo: r.choreo },
    transition: { requested: want, used: want, strength: r.strength, note: r.note },
  }
}

/** Altitude and radius extremes of a choreography (dense sampling). */
export function choreoExtents(ch: Choreo, n: number, steps = 160): { minY: number; maxY: number; maxR: number } {
  const p = new Float32Array(n * 3)
  let minY = Infinity, maxY = -Infinity, maxR = 0
  for (let k = 0; k <= steps; k++) {
    for (let i = 0; i < n; i++) choreoPos(ch, i, k / steps, p)
    for (let i = 0; i < n * 3; i += 3) {
      minY = Math.min(minY, p[i + 1]!)
      maxY = Math.max(maxY, p[i + 1]!)
      maxR = Math.max(maxR, Math.hypot(p[i]!, p[i + 2]!))
    }
  }
  return { minY, maxY, maxR }
}

/** Vertical takeoff/landing: fastest safe time rounded up to half a second. */
function planVertical(from: Float32Array, to: Float32Array, limits: Limits, t0: number): Leg {
  const fastest = fastestProfile(moveExtents(from, to), limits)
  const profile = stretchProfile(fastest, ceilTo(Math.max(fastest.T, 1), 0.5))
  return { t0, t1: t0 + profile.T, from, to, profile, kind: 'direct' }
}

function permute(points: Float32Array, slot: Int32Array): Float32Array {
  const out = new Float32Array(slot.length * 3)
  for (let i = 0; i < slot.length; i++) {
    const j = slot[i]!
    out[i * 3] = points[j * 3]!; out[i * 3 + 1] = points[j * 3 + 1]!; out[i * 3 + 2] = points[j * 3 + 2]!
  }
  return out
}

export function compile(doc: ShowDoc): Compiled {
  const n = Math.max(1, Math.floor(doc.droneCount))
  const { limits, site } = doc
  const beats = showBeats(doc)
  const downbeat = doc.audio?.downbeat ?? 0
  const musicEnergy = doc.audio?.energy ?? []
  const accents = showAccents(doc)
  const beat = beatPhaseFn(beats, downbeat, musicEnergy, accents)

  // Geometry for every scene.
  const scenes: CompiledScene[] = doc.scenes.map((scene, index) => compileScene(scene, index, n))

  const pads = padGrid(n, site.gridSpacing, 0)
  const padsHigh = padGrid(n, site.gridSpacing, site.takeoffAltitude)
  const segments: Segment[] = []
  const sceneTimes: Compiled['sceneTimes'] = []
  let t = 0

  // Takeoff: vertical climb.
  const takeoffLeg = planVertical(pads, padsHigh, limits, 0)
  const takeoffDur = takeoffLeg.t1
  segments.push({ kind: 'takeoff', t0: 0, t1: takeoffDur, from: pads, to: padsHigh, legs: [takeoffLeg] })
  t = takeoffDur

  // Drone positions/colours at the end of the previous segment (drone order).
  let curPos = padsHigh
  let curPointsSet = padsHigh // the same set in "point order" of the previous stage
  let curSlot = identity(n) // drone → index in curPointsSet
  let curColors = constColors(n, GROUND_COLOR)
  let curSpacing = n > 1 ? site.gridSpacing : Infinity

  for (const cs of scenes) {
    const scene = doc.scenes[cs.index]!
    // Match the previous point set to this scene's points (detouring if needed), then apply the transition style.
    const fd = planFlight(scene.flight.style, curPos, curPointsSet, curSpacing, curSlot, cs.points, cs.spacing, limits, scene.flight.duration, t, null)
    const slot = fd.slot
    cs.slot = slot
    const target = permute(cs.points, slot)
    const dur = fd.T
    const startColors = sceneColors(cs, 0, t + dur, beat)
    segments.push({
      kind: 'flight', t0: t, t1: t + dur, legs: fd.legs, detour: fd.detour, style: fd.style, transition: fd.transition, floor: fd.floor,
      from: curPos, to: target, c0: curColors, c1: startColors,
      dim: scene.flight.dim, into: cs.index, minDuration: fd.min, auto: fd.auto, extended: fd.extended,
    })
    const flightStart = t
    t += dur
    segments.push({ kind: 'hold', t0: t, t1: t + cs.hold, scene: cs.index })
    const st: SceneTime = { id: cs.id, flightStart, holdStart: t, holdEnd: t + cs.hold, splitEnd: t + cs.hold, minFlight: fd.min, auto: fd.auto, extended: fd.extended, detour: fd.detour, transition: fd.transition }
    sceneTimes.push(st)
    curColors = sceneColors(cs, cs.hold, t + cs.hold, beat)
    t += cs.hold
    curPos = permute(cs.endPoints, slot)
    curPointsSet = cs.endPoints
    curSlot = slot
    curSpacing = cs.spacing
    if (hasSplit(scene)) {
      // Groups break away and fly their own sequences; everyone then merges into the next scene.
      const sp = compileSplit(scene, cs, t, limits, beat)
      segments.push({ kind: 'split', t0: t, t1: sp.end, scene: cs.index, tracks: sp.tracks })
      st.splitEnd = sp.end
      t = sp.end
      curPos = sp.pos
      curColors = sp.colors
      curPointsSet = sp.pos
      curSlot = identity(n)
      curSpacing = minPairDistance(sp.pos)
    }
  }

  // Return flight to the pads (at altitude), then descend.
  const rf = planFlight(site.returnFlight.style, curPos, curPointsSet, curSpacing, curSlot, padsHigh, n > 1 ? site.gridSpacing : Infinity, limits, site.returnFlight.duration, t, site.landing === 'home' ? identity(n) : null)
  const landSlot = rf.slot
  const above = permute(padsHigh, landSlot)
  segments.push({
    kind: 'flight', t0: t, t1: t + rf.T, legs: rf.legs, detour: rf.detour, style: rf.style, transition: rf.transition, floor: rf.floor,
    from: curPos, to: above, c0: curColors, c1: constColors(n, GROUND_COLOR),
    dim: site.returnFlight.dim, into: -1, minDuration: rf.min, auto: rf.auto, extended: rf.extended,
  })
  const returnFlight = { t0: t, t1: t + rf.T, minDuration: rf.min, auto: rf.auto, extended: rf.extended, detour: rf.detour, transition: rf.transition }
  t += rf.T
  const landPads = permute(pads, landSlot)
  const landLeg = planVertical(above, landPads, limits, t)
  const landDur = landLeg.t1 - t
  segments.push({ kind: 'land', t0: t, t1: t + landDur, from: above, to: landPads, legs: [landLeg] })
  const landing = { t0: t, t1: t + landDur }
  t += landDur

  // Stage box for position-based cue effects (stable for the whole show).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const allScenes = [...scenes, ...segments.flatMap((sg) => (sg.kind === 'split' ? sg.tracks.flatMap((tr) => tr.steps) : []))]
  for (const cs of allScenes)
    for (let k = 0; k < cs.points.length / 3; k++) {
      const x = cs.points[k * 3]!, y = cs.points[k * 3 + 1]!
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  const stage = Number.isFinite(minX)
    ? { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, r: Math.max(1, (maxX - minX) / 2, (maxY - minY) / 2), minX, maxX, minY, maxY }
    : { cx: 0, cy: site.takeoffAltitude, r: 20, minX: -20, maxX: 20, minY: 0, maxY: site.takeoffAltitude + 20 }

  // Camera framing also covers transitions that travel outside the formations (arches, bursts).
  const view = { minX: stage.minX, maxX: stage.maxX, maxY: stage.maxY }
  const probe = new Float32Array(n * 3)
  const styled = segments.flatMap((sg): FlightSegment[] => (sg.kind === 'flight' ? [sg] : sg.kind === 'split' ? sg.tracks.flatMap((tr) => tr.segments.filter((x): x is FlightSegment => x.kind === 'flight')) : []))
  for (const seg of styled) {
    if (!seg.style) continue
    const m = seg.from.length / 3
    for (let k = 0; k <= 40; k++) {
      const u = k / 40
      if (seg.style.kind === 'choreo') for (let i = 0; i < m; i++) choreoPos(seg.style.choreo, i, u, probe)
      else wrapPos(seg.legs, seg.style.wrap, seg.t0, seg.t1 - seg.t0, seg.t0 + u * (seg.t1 - seg.t0), probe)
      for (let i = 0; i < m * 3; i += 3) {
        view.minX = Math.min(view.minX, probe[i]!); view.maxX = Math.max(view.maxX, probe[i]!); view.maxY = Math.max(view.maxY, probe[i + 1]!)
      }
    }
  }

  const cues: CompiledCue[] = (doc.cues ?? [])
    .filter((q) => q.duration > 0)
    .map((q) => ({ id: q.id, t0: q.start, t1: q.start + q.duration, fadeIn: Math.max(0, q.fadeIn), fadeOut: Math.max(0, q.fadeOut), blend: q.blend, effect: q.effect }))
    .sort((a, b) => a.t0 - b.t0)

  return {
    n, duration: t, segments, scenes, pads, landPads, beats, downbeat, musicEnergy, accents, limits, cues, stage, view,
    takeoff: { t0: 0, t1: takeoffDur }, landing, returnFlight, sceneTimes,
  }
}

const lookup = new WeakMap<Compiled, Map<string, { cs: CompiledScene; time: SceneTime; track: Track | null }>>()
function index(c: Compiled) {
  let m = lookup.get(c)
  if (!m) {
    m = new Map()
    c.scenes.forEach((cs, i) => m!.set(cs.id, { cs, time: c.sceneTimes[i]!, track: null }))
    for (const sg of c.segments) if (sg.kind === 'split') for (const tr of sg.tracks) tr.steps.forEach((cs, i) => m!.set(cs.id, { cs, time: tr.stepTimes[i]!, track: tr }))
    lookup.set(c, m)
  }
  return m
}
/** A compiled formation by scene id: a scene or a group step. */
export function findCompiledScene(c: Compiled, id: string): CompiledScene | undefined {
  return index(c).get(id)?.cs
}
/** Timing of a scene or group step. */
export function findSceneTime(c: Compiled, id: string): SceneTime | undefined {
  return index(c).get(id)?.time
}
/** The group track a step belongs to (null for main scenes). */
export function findTrack(c: Compiled, id: string): Track | null {
  return index(c).get(id)?.track ?? null
}

/** Geometry, spin and look of one formation for `n` drones. */
export function compileScene(scene: Scene, index: number, n: number): CompiledScene {
  const g = sceneGeometry(scene, n)
  const center: Vec3 = [scene.position[0], scene.position[1], scene.position[2]]
  const omega = scene.spin * DEG
  const endPoints = omega === 0 ? g.points : rotateAboutVertical(g.points, center, spinAngle(omega, scene.hold, scene.hold))
  let spinRadius = 0
  for (let k = 0; k < n; k++) spinRadius = Math.max(spinRadius, Math.hypot(g.points[k * 3]! - center[0], g.points[k * 3 + 2]! - center[2]))
  return {
    id: scene.id, index, points: g.points, endPoints, center, omega, hold: Math.max(0, scene.hold),
    slot: new Int32Array(n), layerOf: g.layerOf, layerCounts: g.layerCounts,
    effects: scene.layers.map((l) => l.effect), look: g.look, image: g.image,
    spacing: minPairDistance(g.points), spinRadius, motion: scene.motion ?? NO_MOTION,
  }
}

/** Colours of the points `slot[j]` of a formation at hold-local time tau. */
export function slotColors(cs: CompiledScene, slot: Int32Array, tau: number, t: number, beat: BeatPhase): Float32Array {
  const out = new Float32Array(slot.length * 3)
  for (let j = 0; j < slot.length; j++) {
    pointColor(cs, slot[j]!, tau, t, beat, colTmp)
    out[j * 3] = colTmp[0]; out[j * 3 + 1] = colTmp[1]; out[j * 3 + 2] = colTmp[2]
  }
  return out
}

/**
 * The groups of a scene, after its hold at t0. Drones are grouped by the
 * shape (layer) they hold; each group flies its steps with its own flights
 * (each planned and checked like any flight, within the group). Drones in no
 * group, and groups that finish early, hold still until the last group is done.
 */
function compileSplit(scene: Scene, cs: CompiledScene, t0: number, limits: Limits, beat: BeatPhase): { tracks: Track[]; end: number; pos: Float32Array; colors: Float32Array } {
  const n = cs.slot.length
  const groups = scene.groups ?? []
  // Groups are chosen from where the drones are when the split begins (after any spin).
  const groupOfPoint = pointGroups(scene, cs.endPoints, cs.layerOf)
  const members: number[][] = groups.map(() => [])
  const rest: number[] = []
  for (let i = 0; i < n; i++) {
    const gi = groupOfPoint[cs.slot[i]!]!
    if (gi >= 0 && groups[gi]!.steps.length) members[gi]!.push(i)
    else rest.push(i)
  }
  const tracks: Track[] = []
  let end = t0
  const steps = groups.map((g, gi) => g.steps.map((st, si) => compileScene(st, si, members[gi]!.length)))
  const departure = planDeparture(groups, members, steps, cs, t0, limits)
  groups.forEach((g, gi) => {
    const D = members[gi]!
    const m = D.length
    if (!m) return
    const drones = Int32Array.from(D)
    const parentSlot = Int32Array.from(D, (i) => cs.slot[i]!)
    const segs: TrackSegment[] = []
    const stepTimes: SceneTime[] = []
    let t = t0
    const delay = Math.max(0, g.delay)
    if (delay > 0) segs.push({ kind: 'hold', t0: t, t1: t + delay, scene: -1, tau0: cs.hold })
    t += delay
    let pos = permute(cs.endPoints, parentSlot)
    let set = pos
    let slot = identity(m)
    let spacing = minPairDistance(pos)
    let colors = slotColors(cs, parentSlot, cs.hold + delay, t, beat)
    const together = departure?.part.get(gi)
    steps[gi]!.forEach((sc, si) => {
      const st = g.steps[si]!
      // Groups that set off at once leave the formation together, on one clock (see planDeparture).
      const fd = si === 0 && together ? together : planFlight(st.flight.style, pos, set, spacing, slot, sc.points, sc.spacing, limits, st.flight.duration, t, null)
      sc.slot = fd.slot
      const target = permute(sc.points, fd.slot)
      segs.push({
        kind: 'flight', t0: t, t1: t + fd.T, legs: fd.legs, detour: fd.detour, style: fd.style, transition: fd.transition, floor: fd.floor,
        from: pos, to: target, c0: colors, c1: sceneColors(sc, 0, t + fd.T, beat),
        dim: st.flight.dim, into: si, minDuration: fd.min, auto: fd.auto, extended: fd.extended,
      })
      const flightStart = t
      t += fd.T
      segs.push({ kind: 'hold', t0: t, t1: t + sc.hold, scene: si, tau0: 0 })
      stepTimes.push({ id: sc.id, flightStart, holdStart: t, holdEnd: t + sc.hold, splitEnd: t + sc.hold, minFlight: fd.min, auto: fd.auto, extended: fd.extended, detour: fd.detour, transition: fd.transition })
      t += sc.hold
      colors = sceneColors(sc, sc.hold, t, beat)
      pos = permute(sc.endPoints, fd.slot)
      set = sc.endPoints
      slot = fd.slot
      spacing = sc.spacing
    })
    tracks.push({ id: g.id, name: g.name, drones, parentSlot, steps: steps[gi]!, segments: segs, stepTimes, end: t })
    end = Math.max(end, t)
  })
  if (rest.length) {
    const parentSlot = Int32Array.from(rest, (i) => cs.slot[i]!)
    tracks.push({ id: '', name: scene.name, drones: Int32Array.from(rest), parentSlot, steps: [], segments: [], stepTimes: [], end: t0 })
  }
  // Everyone waits, still, for the last group: extend each track's final hold to the merge.
  for (const tr of tracks) {
    const last = tr.segments[tr.segments.length - 1]
    if (last?.kind === 'hold') last.t1 = end
    else if (!last) tr.segments.push({ kind: 'hold', t0, t1: end, scene: -1, tau0: cs.hold })
    else tr.segments.push({ kind: 'hold', t0: last.t1, t1: end, scene: tr.steps.length - 1, tau0: tr.steps[tr.steps.length - 1]?.hold ?? 0 })
  }
  // Where everyone is when the merge flight starts.
  const pos = new Float32Array(n * 3), colors = new Float32Array(n * 3)
  for (const tr of tracks) {
    const last = tr.segments[tr.segments.length - 1] as Extract<TrackSegment, { kind: 'hold' }>
    const sc = last.scene < 0 ? cs : tr.steps[last.scene]!
    const slot = last.scene < 0 ? tr.parentSlot : sc.slot
    const tau = last.tau0 + (end - last.t0)
    const c = slotColors(sc, slot, tau, end, beat)
    for (let j = 0; j < tr.drones.length; j++) {
      const i = tr.drones[j]!, k = slot[j]!
      for (let a = 0; a < 3; a++) { pos[i * 3 + a] = sc.endPoints[k * 3 + a]!; colors[i * 3 + a] = c[j * 3 + a]! }
    }
  }
  return { tracks, end, pos, colors }
}

/**
 * The split itself: groups that set off as soon as the formation's hold ends
 * fly out of it together, as one synchronised flight (each group keeping its
 * own optimal drone↔point matching), so the moment the formation breaks up
 * is planned (with a detour if needed) and checked exactly like any flight.
 * Returns each group's share of that flight. Transitions apply to the
 * groups' later flights.
 */
function planDeparture(groups: Group[], members: number[][], steps: CompiledScene[][], cs: CompiledScene, t0: number, limits: Limits): { part: Map<number, PlannedFlight> } | null {
  const leaving = groups.map((g, gi) => gi).filter((gi) => Math.max(0, groups[gi]!.delay) <= 1e-9 && steps[gi]!.length && members[gi]!.length)
  if (!leaving.length) return null
  const N = leaving.reduce((a, gi) => a + members[gi]!.length, 0)
  const from = new Float32Array(N * 3), to = new Float32Array(N * 3)
  const rows: { gi: number; o: number; m: number; slot: Int32Array }[] = []
  let o = 0
  let requested: number | null = null
  for (const gi of leaving) {
    const D = members[gi]!, m = D.length
    const sc = steps[gi]![0]!
    const start = new Float32Array(m * 3)
    for (let j = 0; j < m; j++) for (let a = 0; a < 3; a++) start[j * 3 + a] = cs.endPoints[cs.slot[D[j]!]! * 3 + a]!
    const slot = cachedMatch(start, sc.points)
    from.set(start, o * 3)
    to.set(permute(sc.points, slot), o * 3)
    rows.push({ gi, o, m, slot })
    o += m
    const d = groups[gi]!.steps[0]!.flight.duration
    if (d !== null) requested = Math.max(requested ?? 0, d)
  }
  const spacing = minPairDistance(to)
  const fd = planFlight(undefined, from, from, minPairDistance(from), identity(N), to, spacing, limits, requested, t0, identity(N))
  const part = new Map<number, PlannedFlight>()
  for (const r of rows) {
    const cut = (a: Float32Array) => a.slice(r.o * 3, (r.o + r.m) * 3)
    part.set(r.gi, { ...fd, slot: r.slot, legs: fd.legs.map((l) => ({ ...l, from: cut(l.from), to: cut(l.to) })) })
  }
  return { part }
}

function identity(n: number): Int32Array {
  const a = new Int32Array(n)
  for (let i = 0; i < n; i++) a[i] = i
  return a
}

function constColors(n: number, c: RGB): Float32Array {
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2] }
  return out
}

const look: DroneLook = blankLook()
const imgTmp: RGB = [1, 1, 1]
const colTmp: RGB = [0, 0, 0]

/** Colour of point `k` of a compiled scene. */
/** Fill a DroneLook from packed look data (point k). */
export function readLook(src: Float32Array, k: number, look: DroneLook): DroneLook {
  const L = k * LOOK
  look.u = src[L]!
  look.v = src[L + 1]!
  look.order = src[L + 2]!
  look.rand = src[L + 3]!
  look.glyphs = src[L + 4]!
  look.uh = src[L + 5]!
  look.vh = src[L + 6]!
  look.rows = src[L + 7]!
  return look
}

export function pointColor(cs: CompiledScene, k: number, tau: number, t: number, beat: BeatPhase, out: RGB): RGB {
  readLook(cs.look, k, look)
  if (cs.image) {
    imgTmp[0] = cs.image[k * 3]!; imgTmp[1] = cs.image[k * 3 + 1]!; imgTmp[2] = cs.image[k * 3 + 2]!
    look.image = imgTmp
  } else look.image = null
  return effectColor(cs.effects[cs.layerOf[k]!]!, look, tau, t, beat, out)
}

/** Colours of every drone (drone order) at hold-local time tau. */
export function sceneColors(cs: CompiledScene, tau: number, t: number, beat: BeatPhase): Float32Array {
  const n = cs.slot.length
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    pointColor(cs, cs.slot[i]!, tau, t, beat, colTmp)
    out[i * 3] = colTmp[0]; out[i * 3 + 1] = colTmp[1]; out[i * 3 + 2] = colTmp[2]
  }
  return out
}

/** Colours in point order (for thumbnails), at hold start. */
export function scenePointColors(cs: CompiledScene, beats: number[] = []): Float32Array {
  const beat = beatPhaseFn(beats, 0)
  const n = cs.points.length / 3
  const out = new Float32Array(n * 3)
  for (let k = 0; k < n; k++) {
    pointColor(cs, k, 0, 0, beat, colTmp)
    out[k * 3] = colTmp[0]; out[k * 3 + 1] = colTmp[1]; out[k * 3 + 2] = colTmp[2]
  }
  return out
}
