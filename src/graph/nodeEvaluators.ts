// ============================================================================
// Node Evaluators — Per-type evaluation strategies
// ============================================================================
// Extracted from the monolithic evaluateAtTime switch statement.
// Each evaluator receives a shared context and mutates DroneState[] in place.
// Transition evaluation is per-flow-edge (not per-node) — see evaluateEdgeTransition.
// ============================================================================

import type { ShowNode, ShowEdge, DroneState, Vec3, FormationNodeData, LaunchNodeData, IdleNodeData, LandNodeData, IdleInherit } from './types'
import { DEFAULT_IDLE_INHERIT } from './types'
import type { TimeRange } from './timing'
import type { GraphIndex } from './graphIndex'
import { type TransitionConstraints, DEFAULT_TRANSITION_CONSTRAINTS } from '../registries/transitions'
import { planTransition } from './trajectoryPlanner'
import { getIdleBehavior, type IdleParams } from '../registries/idleBehaviors'
import { interpolateTransform, applyTransform } from './interpolateTransform'
import { sampleAnimatedFormation } from './animatedFormation'
import type { AnimatedFormationDef } from './animatedFormation'
import { COLOR_FORMATION, COLOR_TRANSITION, COLOR_IDLE, COLOR_LAUNCH, lerpColor } from './colors'
import { getColorProgram, evaluateColorProgram, evaluateColorAtKeyframes } from './colorPrograms'

// ── Shared evaluation context ────────────────────────────────────────────────

export interface EvalContext {
  t: number
  states: DroneState[]
  homePositions: Vec3[]
  formations: Map<string, Vec3[]>
  animatedDefs?: Map<string, AnimatedFormationDef>
  timing: Map<string, TimeRange>
  /** Per-edge transition time windows. */
  edgeTiming: Map<string, TimeRange>
  idx: GraphIndex
  nodeAssignment: Map<string, number[]>
  edgeAssignment: Map<string, number[]>
  /** Slice 1 Step 6+: physics constraints used to clamp idle params at the evaluator boundary. */
  constraints?: TransitionConstraints
}

// ── Idle inheritance helper ──────────────────────────────────────────────────

export function applyIdleInheritance(
  idlePos: Vec3,
  baseTransform: { position: Vec3; rotation: Vec3; scale: Vec3 },
  animTransform: { position: Vec3; rotation: Vec3; scale: Vec3 },
  inherit: IdleInherit,
): Vec3 {
  let ox = idlePos.x - baseTransform.position.x
  let oy = idlePos.y - baseTransform.position.y
  let oz = idlePos.z - baseTransform.position.z

  const sx = inherit.scaleX ? animTransform.scale.x / (baseTransform.scale.x || 1) : 1
  const sy = inherit.scaleY ? animTransform.scale.y / (baseTransform.scale.y || 1) : 1
  const sz = inherit.scaleZ ? animTransform.scale.z / (baseTransform.scale.z || 1) : 1
  ox *= sx; oy *= sy; oz *= sz

  const drx = inherit.rotateX ? animTransform.rotation.x - baseTransform.rotation.x : 0
  const dry = inherit.rotateY ? animTransform.rotation.y - baseTransform.rotation.y : 0
  const drz = inherit.rotateZ ? animTransform.rotation.z - baseTransform.rotation.z : 0

  if (drx !== 0) {
    const c = Math.cos(drx), s = Math.sin(drx)
    const y1 = oy * c - oz * s, z1 = oy * s + oz * c
    oy = y1; oz = z1
  }
  if (dry !== 0) {
    const c = Math.cos(dry), s = Math.sin(dry)
    const x1 = ox * c + oz * s, z1 = -ox * s + oz * c
    ox = x1; oz = z1
  }
  if (drz !== 0) {
    const c = Math.cos(drz), s = Math.sin(drz)
    const x1 = ox * c - oy * s, y1 = ox * s + oy * c
    ox = x1; oy = y1
  }

  const dtx = inherit.translateX ? animTransform.position.x - baseTransform.position.x : 0
  const dty = inherit.translateY ? animTransform.position.y - baseTransform.position.y : 0
  const dtz = inherit.translateZ ? animTransform.position.z - baseTransform.position.z : 0

  return {
    x: baseTransform.position.x + ox + dtx,
    y: baseTransform.position.y + oy + dty,
    z: baseTransform.position.z + oz + dtz,
  }
}

// ── Launch evaluator ─────────────────────────────────────────────────────────

export function evaluateLaunch(
  node: ShowNode,
  assigned: number[],
  ctx: EvalContext,
): void {
  const data = node.data as LaunchNodeData
  const riseHeight = 8
  const riseDuration = Math.max(1.5, riseHeight / 4)
  for (let i = 0; i < assigned.length; i++) {
    const di = assigned[i]!
    const launchTime = data.startTime + i * data.staggerDelay
    const progress = Math.min(1, Math.max(0, (ctx.t - launchTime) / riseDuration))
    const eased = 1 - (1 - progress) * (1 - progress)
    const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
    const state = ctx.states[di]
    if (state) {
      state.position = { x: home.x, y: home.y + eased * 8, z: home.z }
      state.color = { r: COLOR_LAUNCH.r, g: Math.min(1, COLOR_LAUNCH.g + eased * 0.5), b: COLOR_LAUNCH.b }
    }
  }
}

// ── Formation evaluator ──────────────────────────────────────────────────────

export function evaluateFormation(
  node: ShowNode,
  assigned: number[],
  ctx: EvalContext,
): void {
  const data = node.data as FormationNodeData
  const points = data.formationId ? ctx.formations.get(data.formationId) : null
  const animDef = data.formationId && ctx.animatedDefs ? ctx.animatedDefs.get(data.formationId) : undefined
  const idleConfigs = data.idleConfigs ?? []

  const localTime = ctx.t - data.startTime
  const animTransform = interpolateTransform(data.transform, data.keyframes, localTime)

  let animSample: { positions: (Vec3 | null)[]; colors: ({ r: number; g: number; b: number } | null)[] } | null = null
  if (animDef) {
    animSample = sampleAnimatedFormation(animDef, localTime)
  }

  const formationPointCount = points ? points.length : assigned.length
  const formationDroneCount = Math.min(assigned.length, formationPointCount)

  for (let i = 0; i < formationDroneCount; i++) {
    const di = assigned[i]!
    const state = ctx.states[di]
    if (!state) continue

    const animPos = animSample?.positions[i]
    if (animPos) {
      state.position = applyTransform(animPos, animTransform)
    } else if (points && i < points.length) {
      state.position = applyTransform(points[i]!, animTransform)
    } else {
      state.position = {
        x: animTransform.position.x + (i % 10) * 0.5,
        y: animTransform.position.y,
        z: animTransform.position.z + Math.floor(i / 10) * 0.5,
      }
    }

    const animColor = animSample?.colors[i]
    const kfColor = evaluateColorAtKeyframes(
      data.colorKeyframes,
      data.colorProgramId,
      i,
      formationDroneCount,
      state.position,
      localTime,
      ctx.t,
      points ?? undefined,
    )
    if (kfColor) {
      state.color = kfColor
    } else {
      state.color = animColor ? { r: animColor.r, g: animColor.g, b: animColor.b } : { ...COLOR_FORMATION }
    }
  }

  if (data.colorOverrides && data.colorOverrides.length > 0) {
    for (const grp of data.colorOverrides) {
      for (const ptIdx of grp.pointIndices) {
        if (ptIdx < 0 || ptIdx >= formationDroneCount) continue
        const di = assigned[ptIdx]
        if (di === undefined) continue
        const st = ctx.states[di]
        if (st) st.color = { ...grp.color }
      }
    }
  }

  const leftoverCount = assigned.length - formationDroneCount
  if (leftoverCount > 0 && idleConfigs.length > 0) {
    const perIdle = Math.floor(leftoverCount / idleConfigs.length)
    let remainder = leftoverCount - perIdle * idleConfigs.length
    let idleOffset = formationDroneCount

    for (const cfg of idleConfigs) {
      const idleCount = perIdle + (remainder > 0 ? 1 : 0)
      if (remainder > 0) remainder--
      const inherit = cfg.inherit ?? DEFAULT_IDLE_INHERIT
      const behavior = getIdleBehavior(cfg.behavior)

      for (let j = 0; j < idleCount; j++) {
        const di = assigned[idleOffset + j]!
        const state = ctx.states[di]
        if (!state) continue
        const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }

        let idlePos: Vec3
        if (behavior) {
          let idleParams = { center: data.transform.position, radius: cfg.radius, speed: cfg.speed, altitude: cfg.altitude }
          if (behavior.clampToConstraints && ctx.constraints) {
            idleParams = behavior.clampToConstraints(idleParams, ctx.constraints, idleCount).params
          }
          idlePos = behavior.getPosition(j, idleCount, ctx.t, idleParams, home)
        } else {
          const angle = (j / Math.max(1, idleCount)) * Math.PI * 2 + ctx.t * cfg.speed
          idlePos = {
            x: data.transform.position.x + Math.cos(angle) * cfg.radius,
            y: cfg.altitude,
            z: data.transform.position.z + Math.sin(angle) * cfg.radius,
          }
        }

        state.position = applyIdleInheritance(idlePos, data.transform, animTransform, inherit)
        if (cfg.colorProgramId) {
          const prog = getColorProgram(cfg.colorProgramId)
          if (prog) {
            state.color = evaluateColorProgram(prog, j, idleCount, state.position, ctx.t)
          } else {
            state.color = { ...COLOR_IDLE }
          }
        } else {
          state.color = { ...COLOR_IDLE }
        }
      }
      idleOffset += idleCount
    }
  } else if (leftoverCount > 0) {
    for (let j = 0; j < leftoverCount; j++) {
      const di = assigned[formationDroneCount + j]!
      const state = ctx.states[di]
      if (!state) continue
      const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
      state.position = {
        x: home.x,
        y: animTransform.position.y + 2,
        z: home.z,
      }
      state.color = { ...COLOR_IDLE }
    }
  }
}

// ── Per-edge transition evaluator ────────────────────────────────────────────

/**
 * Compute canonical upstream-end positions for the drones converging on `targetNode`.
 *
 * The returned positions are **frame-stable** — they describe where each drone *will*
 * be at the moment its incoming transition starts (i.e. the upstream formation's
 * end-of-life position), independent of the current evaluation time.
 *
 * Why frame-stable matters: the Hungarian-style swap improvement that runs over
 * these sources must converge on the same permutation every frame. If sources were
 * read from `ctx.states[di].position`, they'd reflect the drone's mid-transition
 * position — which drifts each frame, causing Hungarian to flip assignments
 * mid-flight and producing the visible position jumps that the showVerification
 * continuity test was catching.
 *
 * Returns Vec3 keyed by drone index in `mergedAssigned`. For drones whose upstream
 * isn't resolvable (no incoming edge containing them — shouldn't happen but kept
 * safe), falls back to current state.position.
 */
function resolveCanonicalSourcePositions(
  mergedAssigned: number[],
  ctx: EvalContext,
): Vec3[] {
  const result: Vec3[] = new Array(mergedAssigned.length)

  // Reverse-lookup: drone id → (upstream node id, slot index within upstream).
  // Walk all incoming flow edges; each contributes a slice of drones via edgeAssignment.
  // Then look up that drone's slot in the upstream node's own nodeAssignment.
  const droneToSource = new Map<number, { upstreamId: string; slotIdx: number }>()
  // We need to identify the target node's incoming edges. The caller (evaluate.ts)
  // hasn't told us which target, but mergedAssigned was built from those edges.
  // Build the reverse via the whole edgeAssignment map: for each drone, find which
  // edge contains it (last writer wins, but there should be exactly one).
  // To narrow it, scan only edges whose targets share a downstream — too costly.
  // Simpler: scan all edgeAssignments for membership. O(E × N_per_edge).
  for (const [edgeId, edgeDrones] of ctx.edgeAssignment) {
    const edge = ctx.idx.edgeById.get(edgeId)
    if (!edge) continue
    const upstreamId = edge.source
    const upstreamAssignment = ctx.nodeAssignment.get(upstreamId)
    if (!upstreamAssignment) continue
    for (const di of edgeDrones) {
      // Only record if drone is in our merged list (avoid populating for unrelated edges).
      if (!mergedAssigned.includes(di)) continue
      const slotIdx = upstreamAssignment.indexOf(di)
      if (slotIdx >= 0) {
        droneToSource.set(di, { upstreamId, slotIdx })
      }
    }
  }

  for (let i = 0; i < mergedAssigned.length; i++) {
    const di = mergedAssigned[i]!
    const src = droneToSource.get(di)
    if (!src) {
      const s = ctx.states[di]
      result[i] = s ? { ...s.position } : { x: 0, y: 0, z: 0 }
      continue
    }
    const upstream = ctx.idx.nodeById.get(src.upstreamId)
    if (!upstream) {
      const s = ctx.states[di]
      result[i] = s ? { ...s.position } : { x: 0, y: 0, z: 0 }
      continue
    }
    if (upstream.type === 'formation') {
      const ud = upstream.data as FormationNodeData
      const pts = ud.formationId ? ctx.formations.get(ud.formationId) : null
      const endTransform = interpolateTransform(ud.transform, ud.keyframes, ud.duration)
      if (pts && src.slotIdx < pts.length) {
        result[i] = applyTransform(pts[src.slotIdx]!, endTransform)
      } else {
        result[i] = { ...endTransform.position }
      }
    } else if (upstream.type === 'launch') {
      // Launch end-of-life: drone at home XZ, risen by riseHeight.
      const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
      result[i] = { x: home.x, y: home.y + 8, z: home.z }
    } else if (upstream.type === 'idle') {
      const ud = upstream.data as IdleNodeData
      const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
      const behavior = getIdleBehavior(ud.behavior)
      const idleEnd = ud.startTime + ud.duration
      if (behavior) {
        result[i] = behavior.getPosition(
          src.slotIdx, ctx.nodeAssignment.get(src.upstreamId)?.length ?? 1,
          idleEnd,
          { center: ud.center, radius: ud.radius, speed: ud.speed, altitude: ud.altitude, direction: ud.direction },
          home,
        )
      } else {
        result[i] = { x: ud.center.x, y: ud.altitude, z: ud.center.z }
      }
    } else {
      const s = ctx.states[di]
      result[i] = s ? { ...s.position } : { x: 0, y: 0, z: 0 }
    }
  }

  return result
}

/**
 * Per-formation Hungarian assignment. Permutes `mergedAssigned` so the drone at
 * position i is the optimal occupant of slot i — minimizing total chord length
 * across all (source, slot) pairs. Triangle-inequality guarantees no XZ path
 * crossings in the result.
 *
 * Architectural premise: physical drone identity is fungible at formations. What's
 * slot-bound (animation keyframes, color overrides at pointIndices, per-slot
 * coloring) cares only that *some* drone occupies slot i, not which one. Drone
 * identity only matters at launch/land (home positions). So Hungarian-permuting
 * here is safe for any formation, animated or not — the visual outcome (trunk
 * drones at trunk slots, canopy at canopy, override colors at override points)
 * is identical; only the internal numbering changes.
 *
 * This replaces the previous positional identity propagation through chains
 * (which forced ring slot i to feed apple-tree slot i, defeating any crossing-
 * elimination at the apple-tree transition).
 *
 * Idle-slot leftovers are left in original order — some idle behaviours read
 * drone home position, so swapping there can shift slot positions. Only the
 * first `formCount` formation slots are optimized.
 *
 * Cost: O(passes × N²) with passes ≤ 3 for typical layouts. Runs once per
 * downstream node per frame; for N=100 that's ~30k ops, negligible.
 */
export function optimizeAssignmentMapping(
  targetNode: ShowNode,
  mergedAssigned: number[],
  ctx: EvalContext,
): number[] {
  if (mergedAssigned.length < 2 || targetNode.type !== 'formation') return mergedAssigned
  const fd = targetNode.data as FormationNodeData
  const pts = fd.formationId ? ctx.formations.get(fd.formationId) : null
  if (!pts || pts.length < 2) return mergedAssigned

  const formCount = Math.min(mergedAssigned.length, pts.length)
  if (formCount < 2) return mergedAssigned

  const arrivalTransform = interpolateTransform(fd.transform, fd.keyframes, 0)
  const slots: Vec3[] = []
  for (let i = 0; i < formCount; i++) {
    slots.push(applyTransform(pts[i]!, arrivalTransform))
  }
  // Canonical (frame-stable) upstream-end positions. Reading ctx.states.position
  // here would couple Hungarian's output to mid-transition drone positions, causing
  // the assignment to flip between frames and producing visible jumps.
  const canonical = resolveCanonicalSourcePositions(mergedAssigned, ctx)
  const sources: Vec3[] = []
  for (let i = 0; i < formCount; i++) {
    sources.push(canonical[i]!)
  }

  const result = mergedAssigned.slice()
  const MAX_PASSES = 3
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false
    for (let i = 0; i < formCount; i++) {
      for (let j = i + 1; j < formCount; j++) {
        const si = sources[i]!, sj = sources[j]!
        const ti = slots[i]!, tj = slots[j]!
        const curr =
          (si.x - ti.x) ** 2 + (si.y - ti.y) ** 2 + (si.z - ti.z) ** 2 +
          (sj.x - tj.x) ** 2 + (sj.y - tj.y) ** 2 + (sj.z - tj.z) ** 2
        const swap =
          (si.x - tj.x) ** 2 + (si.y - tj.y) ** 2 + (si.z - tj.z) ** 2 +
          (sj.x - ti.x) ** 2 + (sj.y - ti.y) ** 2 + (sj.z - ti.z) ** 2
        if (swap < curr - 1e-9) {
          const tmpA = result[i]!; result[i] = result[j]!; result[j] = tmpA
          const tmpB = sources[i]!; sources[i] = sources[j]!; sources[j] = tmpB
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return result
}

/**
 * Build a droneId → target-position map for the start-of-life state of a target node,
 * using the **merged** drone list across all incoming edges. Mirrors the index→slot
 * mapping that `evaluateFormation` uses at t = node.start, so transitions hand off
 * to the formation evaluator without a position jump.
 *
 * The merge case (formA(40) + formB(60) → formC(50-point + idle)) used to produce
 * ~20m jumps because each per-edge evaluator sliced by within-edge index and both
 * claimed formC point 0. With a single resolver over the merged list, drone identity
 * decides the slot and the two evaluators agree.
 */
export function resolveTargetPositions(
  targetNode: ShowNode,
  mergedAssigned: number[],
  ctx: EvalContext,
  arrivalTime: number,
): Map<number, Vec3> {
  const targetByDrone = new Map<number, Vec3>()

  if (targetNode.type === 'formation') {
    const fd = targetNode.data as FormationNodeData
    const pts = fd.formationId ? ctx.formations.get(fd.formationId) : null
    const idleCfgs = fd.idleConfigs ?? []
    const arrivalTransform = interpolateTransform(fd.transform, fd.keyframes, 0)

    const formPointCount = pts ? pts.length : mergedAssigned.length
    const formCount = Math.min(mergedAssigned.length, formPointCount)
    const leftoverCount = mergedAssigned.length - formCount

    const idleCounts: number[] = []
    if (leftoverCount > 0 && idleCfgs.length > 0) {
      const perIdle = Math.floor(leftoverCount / idleCfgs.length)
      let rem = leftoverCount - perIdle * idleCfgs.length
      for (let ic = 0; ic < idleCfgs.length; ic++) {
        idleCounts.push(perIdle + (rem > 0 ? 1 : 0))
        if (rem > 0) rem--
      }
    }

    for (let ei = 0; ei < mergedAssigned.length; ei++) {
      const di = mergedAssigned[ei]!
      let target: Vec3

      if (ei < formCount) {
        if (pts && ei < pts.length) {
          target = applyTransform(pts[ei]!, arrivalTransform)
        } else {
          target = { ...arrivalTransform.position }
        }
      } else if (idleCfgs.length > 0) {
        let idleIdx = ei - formCount
        let cfgIdx = 0
        while (cfgIdx < idleCounts.length && idleIdx >= (idleCounts[cfgIdx] ?? 0)) {
          idleIdx -= idleCounts[cfgIdx] ?? 0
          cfgIdx++
        }
        const targetCfg = idleCfgs[cfgIdx]
        const totalForCfg = idleCounts[cfgIdx] ?? 1
        if (targetCfg) {
          const behavior = getIdleBehavior(targetCfg.behavior)
          const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
          if (behavior) {
            target = behavior.getPosition(
              idleIdx, totalForCfg, arrivalTime,
              { center: arrivalTransform.position, radius: targetCfg.radius, speed: targetCfg.speed, altitude: targetCfg.altitude },
              home,
            )
          } else {
            const angle = (idleIdx / Math.max(1, totalForCfg)) * Math.PI * 2
            target = {
              x: arrivalTransform.position.x + Math.cos(angle) * targetCfg.radius,
              y: targetCfg.altitude,
              z: arrivalTransform.position.z + Math.sin(angle) * targetCfg.radius,
            }
          }
        } else {
          target = { ...arrivalTransform.position }
        }
      } else {
        const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
        target = {
          x: home.x,
          y: arrivalTransform.position.y + 2,
          z: home.z,
        }
      }
      targetByDrone.set(di, target)
    }
  } else if (targetNode.type === 'land') {
    for (const di of mergedAssigned) {
      const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
      targetByDrone.set(di, { ...home })
    }
  } else if (targetNode.type === 'idle') {
    const idleData = targetNode.data as IdleNodeData
    const idleBehavior = getIdleBehavior(idleData.behavior)
    for (let ei = 0; ei < mergedAssigned.length; ei++) {
      const di = mergedAssigned[ei]!
      const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
      let target: Vec3
      if (idleBehavior) {
        const params: IdleParams = {
          center: idleData.center,
          radius: idleData.radius,
          speed: idleData.speed,
          altitude: idleData.altitude,
          direction: idleData.direction,
        }
        target = idleBehavior.getPosition(ei, mergedAssigned.length, arrivalTime, params, home)
      } else {
        const angle = (ei / Math.max(1, mergedAssigned.length)) * Math.PI * 2
        target = {
          x: idleData.center.x + Math.cos(angle) * idleData.radius,
          y: idleData.altitude,
          z: idleData.center.z + Math.sin(angle) * idleData.radius,
        }
      }
      targetByDrone.set(di, target)
    }
  } else {
    for (const di of mergedAssigned) {
      const s = ctx.states[di]
      targetByDrone.set(di, s ? { ...s.position } : { x: 0, y: 0, z: 0 })
    }
  }

  return targetByDrone
}

/**
 * Evaluate the transition of a single flow edge during its time window.
 * Drones' "from" position is whatever their current ctx.states[di] is (set
 * by the upstream node's evaluator). Target positions come from `targetByDrone`,
 * which the caller computes once per target node over the **merged** drone list
 * across all incoming edges — so per-edge calls agree on slot assignment with
 * the target's formation evaluator (no merge jump).
 */
export function evaluateEdgeTransition(
  edge: ShowEdge,
  edgeTimeRange: TimeRange,
  assigned: number[],
  targetByDrone: Map<number, Vec3>,
  ctx: EvalContext,
): void {
  if (!edge.transition || assigned.length === 0) return

  const sourceEnd = edgeTimeRange.start
  const transDuration = edgeTimeRange.end - sourceEnd
  const cfg = edge.transition

  // Build the positional from/to arrays the planner consumes. Drone identity is
  // positional: from[i]/to[i] are this edge's i-th drone (= assigned[i]).
  const orderedDrones: number[] = []
  const fromPts: Vec3[] = []
  const toPts: Vec3[] = []
  for (const di of assigned) {
    const state = ctx.states[di]
    const tgt = targetByDrone.get(di)
    if (!state || !tgt) continue
    orderedDrones.push(di)
    fromPts.push({ ...state.position })
    toPts.push(tgt)
  }
  if (orderedDrones.length === 0) return

  // Step 2: plan per call (no cache yet). Cache + content-hash keying lands in
  // a later step alongside the canonical-source-position lookup that replaces
  // the per-frame state.position read.
  const trajectory = planTransition({
    from: fromPts,
    to: toPts,
    strategyId: cfg.strategyId,
    parameters: cfg.parameters,
    duration: transDuration,
    constraints: ctx.constraints ?? DEFAULT_TRANSITION_CONSTRAINTS,
  })

  const overallT = transDuration > 0
    ? Math.max(0, Math.min(1, (ctx.t - sourceEnd) / transDuration))
    : 1

  for (let i = 0; i < orderedDrones.length; i++) {
    const di = orderedDrones[i]!
    const state = ctx.states[di]
    if (!state) continue
    state.position = trajectory.sample(i, overallT)
    state.color = lerpColor(COLOR_FORMATION, COLOR_TRANSITION, overallT < 0.5 ? overallT * 2 : 2 - overallT * 2)
  }
}

// ── Idle (standalone) evaluator ──────────────────────────────────────────────

export function evaluateIdle(
  node: ShowNode,
  assigned: number[],
  ctx: EvalContext,
): void {
  const data = node.data as IdleNodeData
  const idleBehavior = getIdleBehavior(data.behavior)
  for (let i = 0; i < assigned.length; i++) {
    const di = assigned[i]!
    const state = ctx.states[di]
    if (!state) continue
    const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
    if (idleBehavior) {
      let idleParams: IdleParams = {
        center: data.center,
        radius: data.radius,
        speed: data.speed,
        altitude: data.altitude,
        direction: data.direction,
      }
      if (idleBehavior.clampToConstraints && ctx.constraints) {
        const clamped = idleBehavior.clampToConstraints(idleParams, ctx.constraints)
        idleParams = clamped.params
      }
      state.position = idleBehavior.getPosition(i, assigned.length, ctx.t, idleParams, home)
    } else {
      const angle = (i / Math.max(1, assigned.length)) * Math.PI * 2 + ctx.t * data.speed
      state.position = {
        x: data.center.x + Math.cos(angle) * data.radius,
        y: data.altitude,
        z: data.center.z + Math.sin(angle) * data.radius,
      }
    }
    if (data.colorProgramId) {
      const prog = getColorProgram(data.colorProgramId)
      if (prog) {
        state.color = evaluateColorProgram(prog, i, assigned.length, state.position, ctx.t)
      } else {
        state.color = { ...COLOR_IDLE }
      }
    } else {
      state.color = { ...COLOR_IDLE }
    }
  }
}

// ── Land evaluator ───────────────────────────────────────────────────────────

export function evaluateLand(
  node: ShowNode,
  nodeTime: TimeRange,
  assigned: number[],
  ctx: EvalContext,
): void {
  const data = node.data as LandNodeData
  const landDuration = nodeTime.end - nodeTime.start
  for (let i = 0; i < assigned.length; i++) {
    const di = assigned[i]!
    const home = ctx.homePositions[di] ?? { x: 0, y: 0, z: 0 }
    const state = ctx.states[di]
    if (!state) continue
    const landStart = nodeTime.start + i * data.staggerDelay
    if (ctx.t < landStart) continue
    const individualDuration = Math.max(0.5, landDuration - i * data.staggerDelay)
    const progress = landDuration > 0
      ? Math.min(1, Math.max(0, (ctx.t - landStart) / individualDuration))
      : 1
    const fromPos = { ...state.position }
    state.position = {
      x: fromPos.x + (home.x - fromPos.x) * progress,
      y: fromPos.y + (home.y - fromPos.y) * progress,
      z: fromPos.z + (home.z - fromPos.z) * progress,
    }
    state.color = { r: 1, g: 1 - progress * 0.7, b: 0.3 - progress * 0.3 }
  }
}
