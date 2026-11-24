// Compile a ShowDoc into a fully-timed, per-drone flight plan.
//
//   takeoff → flight → hold(scene 1) → flight → hold(scene 2) → … → flight → land
//
// Each flight is a synchronised min-jerk move along straight lines, with the
// drone↔point matching solved optimally (see assign.ts). The plan is pure data:
// `evaluate()` turns it into positions and colours at any time, and the same
// function feeds the preview, the validator and the exporters.

import type { Blend, Effect, HoldMotion, Limits, Scene, ShowDoc, Vec3 } from './types'
import { assignMinSquared } from './assign'
import { generateShape } from './shapes'
import { DEG, ceilTo, centroid, hash01, hashArray, isIdentityRotation, minPairDistance, rotationMatrix, transformPoints } from './math'
import { NO_MOTION, ZERO_PROFILE, fastestProfile, moveExtents, spinAngle, stretchProfile, type Profile } from './motion'
import { comfortableSpacing, flightClosestApproach } from './separation'
import { effectColor, type BeatPhase, type DroneLook } from './effects'
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
  limits: Limits
  /** Light cues, sorted by start. */
  cues: CompiledCue[]
  /** Normalisation for position-based cue effects: centre and half-extent of the show. */
  stage: { cx: number; cy: number; r: number; minX: number; maxX: number; minY: number; maxY: number }
  /** Times for UI. */
  takeoff: { t0: number; t1: number }
  landing: { t0: number; t1: number }
  returnFlight: { t0: number; t1: number; minDuration: number; auto: boolean; extended: boolean; detour: boolean }
  sceneTimes: { id: string; flightStart: number; holdStart: number; holdEnd: number; minFlight: number; auto: boolean; extended: boolean; detour: boolean }[]
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

/** Largest-remainder split of `n` drones by layer weight. */
export function allocate(n: number, weights: number[]): number[] {
  const w = weights.map((x) => Math.max(0, x))
  const total = w.reduce((a, b) => a + b, 0)
  if (total <= 0) return w.map((_, i) => (i === 0 ? n : 0))
  const exact = w.map((x) => (x / total) * n)
  const counts = exact.map(Math.floor)
  let rest = n - counts.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; rest > 0; k++, rest--) counts[order[k % order.length]![1]]!++
  return counts
}

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

/** World-space points for a scene at hold start (point order), plus per-point look data. */
export function sceneGeometry(scene: Scene, n: number): SceneGeometry {
  const counts = allocate(n, scene.layers.map((l) => l.weight))
  const points = new Float32Array(n * 3)
  const layerOf = new Uint16Array(n)
  const look = new Float32Array(n * 4)
  let image: Float32Array | null = null
  const sceneRot = isIdentityRotation(scene.rotation) ? null : rotationMatrix(scene.rotation)
  let o = 0
  scene.layers.forEach((layer, li) => {
    const c = counts[li]!
    if (c === 0) return
    const { points: local, colors } = generateShape(layer.shape, c)
    // Normalise for effects using the unrotated local shape.
    let ext = 1e-9
    for (let k = 0; k < c; k++) ext = Math.max(ext, Math.abs(local[k * 3]!), Math.abs(local[k * 3 + 1]!), Math.abs(local[k * 3 + 2]!))
    for (let k = 0; k < c; k++) {
      look[(o + k) * 4] = local[k * 3]! / ext
      look[(o + k) * 4 + 1] = local[k * 3 + 1]! / ext
      look[(o + k) * 4 + 2] = c > 1 ? k / (c - 1) : 0
      look[(o + k) * 4 + 3] = hash01(k, li * 7919 + 17)
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

export function beatPhaseFn(beats: number[], downbeat = 0): BeatPhase {
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
    return { phase: Math.max(0, Math.min(1, (t - a) / Math.max(1e-3, b - a))), index: lo - downbeat, since: t - a }
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
  const beat = beatPhaseFn(beats, downbeat)

  // Geometry for every scene.
  const scenes: CompiledScene[] = doc.scenes.map((scene, index) => {
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
  })

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
    // Match the previous point set to this scene's points (detouring if needed).
    const route = planRoute(curPointsSet, curSpacing, curSlot, cs.points, cs.spacing, limits, null)
    const slot = route.slot
    cs.slot = slot
    const target = permute(cs.points, slot)
    const fd = timeRoute(route.moves, limits, scene.flight.duration, t)
    const dur = fd.T
    const startColors = sceneColors(cs, 0, t + dur, beat)
    segments.push({
      kind: 'flight', t0: t, t1: t + dur, legs: fd.legs, detour: route.detour, from: curPos, to: target, c0: curColors, c1: startColors,
      dim: scene.flight.dim, into: cs.index, minDuration: fd.min, auto: fd.auto, extended: fd.extended,
    })
    const flightStart = t
    t += dur
    segments.push({ kind: 'hold', t0: t, t1: t + cs.hold, scene: cs.index })
    sceneTimes.push({ id: cs.id, flightStart, holdStart: t, holdEnd: t + cs.hold, minFlight: fd.min, auto: fd.auto, extended: fd.extended, detour: route.detour })
    curColors = sceneColors(cs, cs.hold, t + cs.hold, beat)
    t += cs.hold
    curPos = permute(cs.endPoints, slot)
    curPointsSet = cs.endPoints
    curSlot = slot
    curSpacing = cs.spacing
  }

  // Return flight to the pads (at altitude), then descend.
  const back = planRoute(curPointsSet, curSpacing, curSlot, padsHigh, n > 1 ? site.gridSpacing : Infinity, limits, site.landing === 'home' ? identity(n) : null)
  const landSlot = back.slot
  const above = permute(padsHigh, landSlot)
  const rf = timeRoute(back.moves, limits, site.returnFlight.duration, t)
  segments.push({
    kind: 'flight', t0: t, t1: t + rf.T, legs: rf.legs, detour: back.detour, from: curPos, to: above, c0: curColors, c1: constColors(n, GROUND_COLOR),
    dim: site.returnFlight.dim, into: -1, minDuration: rf.min, auto: rf.auto, extended: rf.extended,
  })
  const returnFlight = { t0: t, t1: t + rf.T, minDuration: rf.min, auto: rf.auto, extended: rf.extended, detour: back.detour }
  t += rf.T
  const landPads = permute(pads, landSlot)
  const landLeg = planVertical(above, landPads, limits, t)
  const landDur = landLeg.t1 - t
  segments.push({ kind: 'land', t0: t, t1: t + landDur, from: above, to: landPads, legs: [landLeg] })
  const landing = { t0: t, t1: t + landDur }
  t += landDur

  // Stage box for position-based cue effects (stable for the whole show).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const cs of scenes)
    for (let k = 0; k < n; k++) {
      const x = cs.points[k * 3]!, y = cs.points[k * 3 + 1]!
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  const stage = Number.isFinite(minX)
    ? { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, r: Math.max(1, (maxX - minX) / 2, (maxY - minY) / 2), minX, maxX, minY, maxY }
    : { cx: 0, cy: site.takeoffAltitude, r: 20, minX: -20, maxX: 20, minY: 0, maxY: site.takeoffAltitude + 20 }

  const cues: CompiledCue[] = (doc.cues ?? [])
    .filter((q) => q.duration > 0)
    .map((q) => ({ id: q.id, t0: q.start, t1: q.start + q.duration, fadeIn: Math.max(0, q.fadeIn), fadeOut: Math.max(0, q.fadeOut), blend: q.blend, effect: q.effect }))
    .sort((a, b) => a.t0 - b.t0)

  return {
    n, duration: t, segments, scenes, pads, landPads, beats, downbeat, limits, cues, stage,
    takeoff: { t0: 0, t1: takeoffDur }, landing, returnFlight, sceneTimes,
  }
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

const look: DroneLook = { u: 0, v: 0, order: 0, rand: 0, image: null }
const imgTmp: RGB = [1, 1, 1]
const colTmp: RGB = [0, 0, 0]

/** Colour of point `k` of a compiled scene. */
export function pointColor(cs: CompiledScene, k: number, tau: number, t: number, beat: BeatPhase, out: RGB): RGB {
  look.u = cs.look[k * 4]!
  look.v = cs.look[k * 4 + 1]!
  look.order = cs.look[k * 4 + 2]!
  look.rand = cs.look[k * 4 + 3]!
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
