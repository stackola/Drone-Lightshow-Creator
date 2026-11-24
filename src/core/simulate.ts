// Wind test: fly the planned show through a physical simulation.
//
// The plan is exact, but real drones are not on rails. This simulates every
// drone as a point mass with the forces that matter for a show:
//   • thrust, limited in magnitude and in tilt (a multirotor accelerates
//     sideways only by tilting), with a short response lag;
//   • quadratic air drag on the velocity relative to the wind;
//   • wind: a mean wind that grows with altitude, gusts that travel with the
//     wind, and independent turbulence on every drone;
//   • a position controller (PID with feed-forward of the planned
//     acceleration, as show flight controllers use) that does not know the
//     wind and has to fight it.
// It reports how far drones are blown off their paths and how close they
// really come to each other.

import type { Compiled } from './compile'
import { evaluate } from './evaluate'
import { rng } from './math'

export const G = 9.81

export interface WindSpec {
  /** Mean wind at 10 m (m/s); grows with altitude (power law, α = 0.14). */
  speed: number
  /** Compass direction the wind blows FROM (degrees, 0 = north/behind the show, 180 = from the audience). */
  from: number
  /** Gust amplitude (m/s) on top of the mean. */
  gust: number
  /** Per-drone turbulence (m/s, standard deviation). */
  turbulence: number
  seed: number
}

export interface DroneModel {
  /** Maximum tilt (degrees): limits horizontal thrust to T·tan(tilt). */
  maxTilt: number
  /** Thrust beyond hover available for climbing and braking (m/s²). */
  climbAccel: number
  /** Quadratic drag per unit mass (1/m): a = −k·|v_rel|·v_rel. */
  drag: number
  /** Thrust response time constant (s). */
  lag: number
  kp: number
  kd: number
  ki: number
}

/** A typical show drone: ≈ 1 kg, ≈ 0.04 m² frontal area (k = ½ρC_dA/m ≈ 0.025). */
export const DEFAULT_DRONE: DroneModel = { maxTilt: 35, climbAccel: 6, drag: 0.025, lag: 0.12, kp: 2.2, kd: 2.8, ki: 0.5 }

export const WIND_PRESETS: { label: string; wind: Omit<WindSpec, 'from' | 'seed'> }[] = [
  { label: 'Calm', wind: { speed: 2, gust: 1, turbulence: 0.3 } },
  { label: 'Breezy', wind: { speed: 5, gust: 2.5, turbulence: 0.6 } },
  { label: 'Windy', wind: { speed: 7, gust: 3, turbulence: 0.9 } },
  { label: 'Stormy', wind: { speed: 10, gust: 4.5, turbulence: 1.3 } },
]

export interface CloseCall { i: number; j: number; d: number; t: number }

export interface SimResult {
  wind: WindSpec
  duration: number
  steps: number
  /** Closest any two drones came (m), or null if none came within `checkRadius`. */
  minDistance: number | null
  minDistanceTime: number
  checkRadius: number
  /** Worst moment for each pair that came closer than the minimum spacing, worst first (at most 25). */
  closeCalls: CloseCall[]
  /** Number of distinct pairs that came closer than the minimum spacing. */
  closePairs: number
  /** Largest distance of any drone from its planned position (m). */
  maxDeviation: number
  maxDeviationTime: number
  maxDeviationDrone: number
  /** Root-mean-square deviation over all drones and the whole show (m). */
  rmsDeviation: number
  /** Share of drone-time spent at the thrust or tilt limit (0..1). */
  saturated: number
  /** The simulation was stopped early. */
  cancelled: boolean
  /** Recorded positions (frames × n × 3), every `frameDt` seconds from t = 0, if requested. */
  frames: Float32Array | null
  frameDt: number
}

/** Wind direction unit vector (where it blows TO) in show coordinates (x east, z south). */
export function windVector(from: number): [number, number] {
  const b = (from * Math.PI) / 180
  return [-Math.sin(b), Math.cos(b)]
}

/** Gust modes: angular frequencies (rad/s), weights and phases; travel with the mean wind. */
const GUST_W = [0.13, 0.37, 0.83, 1.9]
const GUST_A = [0.45, 0.3, 0.15, 0.1]

export function simulate(
  c: Compiled,
  minSpacing: number,
  wind: WindSpec,
  opts: { dt?: number; model?: Partial<DroneModel>; onProgress?: (fraction: number) => boolean | void; record?: number } = {},
): SimResult {
  const n = c.n
  const dt = opts.dt ?? 0.02
  const m = { ...DEFAULT_DRONE, ...opts.model }
  const tanTilt = Math.tan((m.maxTilt * Math.PI) / 180)
  const rand = rng(wind.seed >>> 0 || 1)
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  const phase = GUST_W.map(() => rand() * Math.PI * 2)
  const crossPhase = GUST_W.map(() => rand() * Math.PI * 2)
  const [dx, dz] = windVector(wind.from)
  const U = Math.max(0, wind.speed)
  // Gusts advect with the mean wind (Taylor's frozen turbulence).
  const advect = Math.max(U, 1)

  const steps = Math.max(1, Math.ceil(c.duration / dt))
  const refPrev = new Float32Array(n * 3), ref = new Float32Array(n * 3), refNext = new Float32Array(n * 3)
  evaluate(c, 0, refPrev, null)
  evaluate(c, 0, ref, null)
  evaluate(c, dt, refNext, null)
  const p = Float64Array.from(ref), v = new Float64Array(n * 3), integ = new Float64Array(n * 3)
  const T = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) T[i * 3 + 1] = G
  // Per-drone turbulence (Ornstein–Uhlenbeck, τ = 1.5 s).
  const turb = new Float64Array(n * 3)
  const tau = 1.5, sig = Math.max(0, wind.turbulence)
  const ouA = Math.exp(-dt / tau), ouB = sig * Math.sqrt(1 - ouA * ouA)
  for (let k = 0; k < n * 3; k++) turb[k] = sig * gauss() * (k % 3 === 1 ? 0.4 : 1)

  // Spatial hash for close pairs.
  const h = Math.max(minSpacing * 1.5, 0.5)
  const bits = Math.max(10, Math.ceil(Math.log2(n * 4)))
  const size = 1 << bits, mask = size - 1
  const head = new Int32Array(size), next = new Int32Array(n)
  const cellX = new Int32Array(n), cellY = new Int32Array(n), cellZ = new Int32Array(n)
  const hash = (x: number, y: number, z: number) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask
  const pairWorst = new Map<number, CloseCall>()
  // Recording: at most ~8M floats (32 MB).
  let frameEvery = 0, frames: Float32Array | null = null, frameDt = 0
  if (opts.record) {
    frameEvery = Math.max(1, Math.round(opts.record / dt))
    while (((steps / frameEvery) + 2) * n * 3 > 8e6) frameEvery *= 2
    frameDt = frameEvery * dt
    frames = new Float32Array((Math.floor(steps / frameEvery) + 1) * n * 3)
  }

  let minD = Infinity, minT = 0
  let maxDev = 0, maxDevT = 0, maxDevI = 0, devSq = 0, devCount = 0, sat = 0, satCount = 0
  let cancelled = false

  for (let step = 0; step <= steps; step++) {
    const t = Math.min(c.duration, step * dt)
    // Gust multiplier along the wind, and across it, at this drone's position.
    const gustAt = (x: number, z: number, cross: boolean) => {
      const s = x * dx + z * dz
      let g = 0
      for (let k = 0; k < 4; k++) g += GUST_A[k]! * Math.sin(GUST_W[k]! * (t - s / advect) + (cross ? crossPhase[k]! : phase[k]!))
      return g
    }
    for (let i = 0; i < n; i++) {
      const o = i * 3
      const rx = ref[o]!, ry = ref[o + 1]!, rz = ref[o + 2]!
      const vx = (refNext[o]! - refPrev[o]!) / (2 * dt), vy = (refNext[o + 1]! - refPrev[o + 1]!) / (2 * dt), vz = (refNext[o + 2]! - refPrev[o + 2]!) / (2 * dt)
      // On the pads (start and end) the drone sits on its landing gear.
      if (ry < 0.3) {
        p[o] = rx; p[o + 1] = ry; p[o + 2] = rz
        v[o] = vx; v[o + 1] = vy; v[o + 2] = vz
        integ[o] = integ[o + 1] = integ[o + 2] = 0
        T[o] = 0; T[o + 1] = G; T[o + 2] = 0
        continue
      }
      const ax = (refNext[o]! - 2 * rx + refPrev[o]!) / (dt * dt), ay = (refNext[o + 1]! - 2 * ry + refPrev[o + 1]!) / (dt * dt), az = (refNext[o + 2]! - 2 * rz + refPrev[o + 2]!) / (dt * dt)
      const px = p[o]!, py = p[o + 1]!, pz = p[o + 2]!
      const ex = rx - px, ey = ry - py, ez = rz - pz
      // Controller: feed-forward + PID; compensates drag as if the air were still.
      const sp = Math.hypot(v[o]!, v[o + 1]!, v[o + 2]!)
      let cx = ax + m.kp * ex + m.kd * (vx - v[o]!) + m.ki * integ[o]! + m.drag * sp * v[o]!
      let cy = ay + m.kp * ey + m.kd * (vy - v[o + 1]!) + m.ki * integ[o + 1]! + m.drag * sp * v[o + 1]! + G
      let cz = az + m.kp * ez + m.kd * (vz - v[o + 2]!) + m.ki * integ[o + 2]! + m.drag * sp * v[o + 2]!
      // Thrust limits: vertical between 25% of hover and hover + climb; horizontal by tilt.
      let saturated = false
      const yLo = 0.25 * G, yHi = G + m.climbAccel
      if (cy < yLo) { cy = yLo; saturated = true } else if (cy > yHi) { cy = yHi; saturated = true }
      const hMax = cy * tanTilt, hc = Math.hypot(cx, cz)
      if (hc > hMax) { cx *= hMax / hc; cz *= hMax / hc; saturated = true }
      // Integrate the error only while the controller has authority (anti-windup).
      if (!saturated) {
        integ[o] = Math.max(-3, Math.min(3, integ[o]! + ex * dt))
        integ[o + 1] = Math.max(-3, Math.min(3, integ[o + 1]! + ey * dt))
        integ[o + 2] = Math.max(-3, Math.min(3, integ[o + 2]! + ez * dt))
      }
      sat += saturated ? 1 : 0
      satCount++
      const kl = Math.min(1, dt / m.lag)
      T[o] = T[o]! + (cx - T[o]!) * kl
      T[o + 1] = T[o + 1]! + (cy - T[o + 1]!) * kl
      T[o + 2] = T[o + 2]! + (cz - T[o + 2]!) * kl
      // Wind at the drone.
      const mean = U * Math.pow(Math.max(py, 2) / 10, 0.14)
      const ga = wind.gust * gustAt(px, pz, false), gc = 0.5 * wind.gust * gustAt(px, pz, true)
      turb[o] = turb[o]! * ouA + ouB * gauss()
      turb[o + 1] = turb[o + 1]! * ouA + 0.4 * ouB * gauss()
      turb[o + 2] = turb[o + 2]! * ouA + ouB * gauss()
      const wx = (mean + ga) * dx - gc * dz + turb[o]!
      const wy = 0.15 * wind.gust * gustAt(px, pz, true) + turb[o + 1]!
      const wz = (mean + ga) * dz + gc * dx + turb[o + 2]!
      const rvx = v[o]! - wx, rvy = v[o + 1]! - wy, rvz = v[o + 2]! - wz
      const rs = Math.hypot(rvx, rvy, rvz)
      const accx = T[o]! - m.drag * rs * rvx
      const accy = T[o + 1]! - G - m.drag * rs * rvy
      const accz = T[o + 2]! - m.drag * rs * rvz
      v[o] = v[o]! + accx * dt; v[o + 1] = v[o + 1]! + accy * dt; v[o + 2] = v[o + 2]! + accz * dt
      p[o] = px + v[o]! * dt; p[o + 1] = Math.max(0, py + v[o + 1]! * dt); p[o + 2] = pz + v[o + 2]! * dt
      const dev = Math.hypot(p[o]! - rx, p[o + 1]! - ry, p[o + 2]! - rz)
      devSq += dev * dev
      devCount++
      if (dev > maxDev) { maxDev = dev; maxDevT = t; maxDevI = i }
    }

    if (frames && step % frameEvery === 0) {
      const f = step / frameEvery
      if ((f + 1) * n * 3 <= frames.length) for (let k = 0; k < n * 3; k++) frames[f * n * 3 + k] = p[k]!
    }

    // Close pairs via the spatial hash.
    if (n > 1) {
      head.fill(-1)
      for (let i = 0; i < n; i++) {
        const x = Math.floor(p[i * 3]! / h), y = Math.floor(p[i * 3 + 1]! / h), z = Math.floor(p[i * 3 + 2]! / h)
        cellX[i] = x; cellY[i] = y; cellZ[i] = z
        const k = hash(x, y, z)
        next[i] = head[k]!
        head[k] = i
      }
      for (let i = 0; i < n; i++) {
        if (p[i * 3 + 1]! < 0.3 && ref[i * 3 + 1]! < 0.3) continue // parked on the ground
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
          for (let j = head[hash(cellX[i]! + ox, cellY[i]! + oy, cellZ[i]! + oz)]!; j >= 0; j = next[j]!) {
            if (j <= i) continue
            const d = Math.hypot(p[i * 3]! - p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!, p[i * 3 + 2]! - p[j * 3 + 2]!)
            if (d >= h) continue
            if (d < minD) { minD = d; minT = t }
            if (d < minSpacing) {
              const key = i * n + j
              const w = pairWorst.get(key)
              if (!w) pairWorst.set(key, { i, j, d, t })
              else if (d < w.d) { w.d = d; w.t = t }
            }
          }
        }
      }
    }

    // Advance the reference window.
    refPrev.set(ref)
    ref.set(refNext)
    evaluate(c, Math.min(c.duration, (step + 2) * dt), refNext, null)
    if (opts.onProgress && step % 250 === 0 && opts.onProgress(step / steps) === false) { cancelled = true; break }
  }

  const closeCalls = [...pairWorst.values()].sort((a, b) => a.d - b.d)
  return {
    wind, duration: c.duration, steps,
    minDistance: Number.isFinite(minD) ? minD : null, minDistanceTime: minT, checkRadius: h,
    closeCalls: closeCalls.slice(0, 25), closePairs: closeCalls.length,
    maxDeviation: maxDev, maxDeviationTime: maxDevT, maxDeviationDrone: maxDevI,
    rmsDeviation: devCount ? Math.sqrt(devSq / devCount) : 0,
    saturated: satCount ? sat / satCount : 0,
    cancelled, frames, frameDt,
  }
}

/** One-line verdict for a simulation. */
export function simVerdict(r: SimResult, minSpacing: number): { level: 'ok' | 'warn' | 'bad'; text: string } {
  const hard = Math.min(1, minSpacing / 2)
  if (r.minDistance !== null && r.minDistance < hard) return { level: 'bad', text: `Drones come within ${r.minDistance.toFixed(2)} m of each other — collision risk in this wind.` }
  if (r.saturated > 0.05) return { level: 'bad', text: `Drones are at their thrust/tilt limit ${(r.saturated * 100).toFixed(0)}% of the time — too windy for this show.` }
  if (r.closePairs > 0) return { level: 'warn', text: `${r.closePairs} pair${r.closePairs === 1 ? '' : 's'} briefly closer than ${minSpacing} m (closest ${r.minDistance!.toFixed(2)} m). Consider more spacing or calmer conditions.` }
  return { level: 'ok', text: `Every pair stays at least ${minSpacing} m apart; drones drift at most ${r.maxDeviation.toFixed(2)} m from their paths.` }
}
