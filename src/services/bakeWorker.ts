// ============================================================================
// S9-01: BakeWorker — Web Worker for deterministic trajectory computation
// ============================================================================
// Runs evaluateAtTime at configurable sample rate, produces per-drone
// trajectory arrays. Communicates progress back to main thread.
// ============================================================================

import { evaluateAtTime, createFrameValidationReport } from '../graph/evaluate'
import { computeAllTiming } from '../graph/timing'
import type { ShowGraph, Vec3, DroneState } from '../graph/types'
import type { AnimatedFormationDef } from '../graph/animatedFormation'
import type { TransitionConstraints } from '../registries/transitions'

export interface BakeRequest {
  type: 'bake'
  graph: ShowGraph
  formations: Record<string, Vec3[]>
  animatedDefs?: Record<string, AnimatedFormationDef>
  homePositions: Vec3[]
  sampleRate: number // Hz (samples per second)
  enforceConstraints?: boolean // S16-01: enforce physics during bake
  constraints?: {
    maxVelocity: number
    minDroneDistance: number
    altitudeMin: number
    altitudeMax: number
    geofenceRadius: number
  }
}

export interface BakeSample {
  time: number
  x: number
  y: number
  z: number
  r: number
  g: number
  b: number
}

// S16-03: Bake validation report
export interface BakeValidationReport {
  maxVelocityAchieved: number
  minSpacingAchieved: number
  maxAltitude: number
  constraintViolations: number
  clampedSamples: number
}

export interface BakeResult {
  type: 'bake-complete'
  trajectories: Record<number, BakeSample[]> // droneId → samples
  duration: number
  sampleCount: number
  report?: BakeValidationReport
}

export interface BakeProgress {
  type: 'bake-progress'
  progress: number // 0–1
  samplesComputed: number
  totalSamples: number
}

export interface BakeError {
  type: 'bake-error'
  message: string
}

export type BakeMessage = BakeResult | BakeProgress | BakeError

/**
 * S9-02: Core bake algorithm — evaluate at configurable sample rate.
 * Can be called from a Web Worker or from the main thread.
 */
export function bakeShow(
  graph: ShowGraph,
  formationsMap: Map<string, Vec3[]>,
  homePositions: Vec3[],
  sampleRate: number,
  animatedDefs?: Map<string, AnimatedFormationDef>,
  onProgress?: (progress: number, computed: number, total: number) => void,
  enforceConstraints?: boolean,
  constraints?: BakeRequest['constraints'],
): { trajectories: Map<number, BakeSample[]>; duration: number; sampleCount: number; report?: BakeValidationReport } {
  // Compute total show duration
  const timing = computeAllTiming(graph)
  let maxEnd = 0
  timing.forEach((range) => {
    if (range.end > maxEnd) maxEnd = range.end
  })

  if (maxEnd <= 0) {
    return { trajectories: new Map(), duration: 0, sampleCount: 0 }
  }

  const dt = 1 / sampleRate
  const totalSamples = Math.ceil(maxEnd * sampleRate) + 1
  const trajectories = new Map<number, BakeSample[]>()

  // Initialize trajectory arrays
  for (let d = 0; d < homePositions.length; d++) {
    trajectories.set(d, [])
  }

  // Slice 1 Step 7: bake always validates per-frame and accumulates report.
  // Constraints converted from project format to TransitionConstraints shape.
  const tcConstraints: TransitionConstraints | undefined = constraints
    ? {
      maxVelocity: constraints.maxVelocity,
      maxAcceleration: 4,
      minSpacing: constraints.minDroneDistance,
      motionSpacing: Math.max(0.5, constraints.minDroneDistance * 0.5),
    }
    : undefined
  const frameReport = createFrameValidationReport()
  let prevStates: DroneState[] | undefined
  let prevT: number | undefined

  // Evaluate at each sample point
  for (let i = 0; i < totalSamples; i++) {
    const t = Math.min(i * dt, maxEnd)
    const states = evaluateAtTime(graph, formationsMap, t, homePositions, animatedDefs, {
      constraints: tcConstraints,
      validate: tcConstraints !== undefined && prevStates !== undefined,
      prevStates,
      prevT,
      report: frameReport,
    })

    for (const state of states) {
      const samples = trajectories.get(state.droneId)
      if (samples) {
        samples.push({
          time: t,
          x: state.position.x,
          y: state.position.y,
          z: state.position.z,
          r: state.color.r,
          g: state.color.g,
          b: state.color.b,
        })
      }
    }

    prevStates = states.map((s) => ({ ...s, position: { ...s.position }, color: { ...s.color } }))
    prevT = t

    // Report progress every 50 samples
    if (onProgress && i % 50 === 0) {
      onProgress(i / totalSamples, i, totalSamples)
    }
  }

  if (onProgress) {
    onProgress(1, totalSamples, totalSamples)
  }

  // WYSIWYG: bake output exactly matches what preview shows. We measure spacing and
  // altitude after-the-fact for reporting but never mutate trajectories — if the engine
  // produced a collision in preview, it stays in the bake. Authors fix collisions by
  // editing the show (durations, mappings, parameters), not via silent post-processing.
  let report: BakeValidationReport | undefined
  if (constraints && homePositions.length >= 2) {
    report = measureSpacingAndAltitude(trajectories, constraints.minDroneDistance, totalSamples)
  }
  if (tcConstraints) {
    if (!report) {
      report = {
        maxVelocityAchieved: 0,
        minSpacingAchieved: 0,
        maxAltitude: 0,
        constraintViolations: 0,
        clampedSamples: 0,
      }
    }
    report.maxVelocityAchieved = Math.max(report.maxVelocityAchieved, frameReport.maxVelocityAchieved)
    if (frameReport.minSpacingAchieved < Infinity && (report.minSpacingAchieved === 0 || frameReport.minSpacingAchieved < report.minSpacingAchieved)) {
      report.minSpacingAchieved = frameReport.minSpacingAchieved
    }
    report.constraintViolations += frameReport.velocityViolations + frameReport.spacingViolations
  }

  // Reference for the legacy 'enforceConstraints' param — it no longer alters output, but
  // callers may set it. Bake never nudges; the engine is fully WYSIWYG.
  void enforceConstraints

  return { trajectories, duration: maxEnd, sampleCount: totalSamples, report }
}

/**
 * Read-only pass that gathers spacing + altitude stats from baked trajectories.
 * Does NOT mutate trajectories — bake output is WYSIWYG with preview. Authors
 * resolve collisions by editing the show (durations, mappings, parameters),
 * not via invisible post-processing.
 */
function measureSpacingAndAltitude(
  trajectories: Map<number, BakeSample[]>,
  minSpacing: number,
  totalSamples: number,
): BakeValidationReport {
  const report: BakeValidationReport = {
    maxVelocityAchieved: 0,
    minSpacingAchieved: Infinity,
    maxAltitude: 0,
    constraintViolations: 0,
    clampedSamples: 0, // always 0 — bake never clamps
  }

  const droneIds = Array.from(trajectories.keys()).sort((a, b) => a - b)
  if (droneIds.length < 2) return report

  const bucketSize = Math.max(0.5, minSpacing * 2)

  for (let si = 0; si < totalSamples; si++) {
    const buckets = new Map<string, number[]>()

    for (const droneId of droneIds) {
      const samples = trajectories.get(droneId)!
      if (si >= samples.length) continue
      const s = samples[si]!
      if (s.y > report.maxAltitude) report.maxAltitude = s.y
      const key = `${Math.floor(s.x / bucketSize)},${Math.floor(s.y / bucketSize)},${Math.floor(s.z / bucketSize)}`
      let bucket = buckets.get(key)
      if (!bucket) { bucket = []; buckets.set(key, bucket) }
      bucket.push(droneId)
    }

    const checked = new Set<string>()
    for (const droneId of droneIds) {
      const samples = trajectories.get(droneId)!
      if (si >= samples.length) continue
      const s = samples[si]!
      const bx = Math.floor(s.x / bucketSize)
      const by = Math.floor(s.y / bucketSize)
      const bz = Math.floor(s.z / bucketSize)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const neighbors = buckets.get(`${bx + dx},${by + dy},${bz + dz}`)
            if (!neighbors) continue
            for (const otherId of neighbors) {
              if (otherId <= droneId) continue
              const pairKey = `${droneId}-${otherId}`
              if (checked.has(pairKey)) continue
              checked.add(pairKey)
              const otherSamples = trajectories.get(otherId)!
              if (si >= otherSamples.length) continue
              const os = otherSamples[si]!
              const ddx = s.x - os.x, ddy = s.y - os.y, ddz = s.z - os.z
              const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz)
              if (dist < report.minSpacingAchieved) report.minSpacingAchieved = dist
              if (dist < minSpacing) report.constraintViolations++
            }
          }
        }
      }
    }
  }

  // Compute max velocity from final trajectories
  for (const droneId of droneIds) {
    const samples = trajectories.get(droneId)!
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1]!, curr = samples[i]!
      const dt = curr.time - prev.time
      if (dt <= 0) continue
      const vx = curr.x - prev.x, vy = curr.y - prev.y, vz = curr.z - prev.z
      const v = Math.sqrt(vx * vx + vy * vy + vz * vz) / dt
      if (v > report.maxVelocityAchieved) report.maxVelocityAchieved = v
    }
  }

  if (report.minSpacingAchieved === Infinity) report.minSpacingAchieved = 0

  return report
}

// Web Worker message handler
if (typeof self !== 'undefined' && typeof (self as unknown as { WorkerGlobalScope: unknown }).WorkerGlobalScope !== 'undefined') {
  self.onmessage = (e: MessageEvent<BakeRequest>) => {
    const req = e.data
    if (req.type !== 'bake') return

    try {
      // Convert plain objects back to Maps
      const formationsMap = new Map(Object.entries(req.formations))
      const animatedDefs = req.animatedDefs ? new Map(Object.entries(req.animatedDefs)) : undefined

      const result = bakeShow(
        req.graph,
        formationsMap,
        req.homePositions,
        req.sampleRate,
        animatedDefs,
        (progress, computed, total) => {
          self.postMessage({
            type: 'bake-progress',
            progress,
            samplesComputed: computed,
            totalSamples: total,
          } satisfies BakeProgress)
        },
        req.enforceConstraints,
        req.constraints,
      )

      // Convert Map to plain object for transfer
      const trajObj: Record<number, BakeSample[]> = {}
      result.trajectories.forEach((samples, droneId) => {
        trajObj[droneId] = samples
      })

      self.postMessage({
        type: 'bake-complete',
        trajectories: trajObj,
        duration: result.duration,
        sampleCount: result.sampleCount,
        report: result.report,
      } satisfies BakeResult)
    } catch (err) {
      self.postMessage({
        type: 'bake-error',
        message: (err as Error).message,
      } satisfies BakeError)
    }
  }
}
