// ============================================================================
// evaluateAtTime — Live Preview Evaluator (Orchestrator)
// ============================================================================
// ARCHITECTURAL LAW (G-03): This is the LIVE PREVIEW path.
// - Must return in <16ms for 60fps scrubbing
// - Allowed approximations: no collision avoidance, simplified stagger
// - Uses greedy point matching for transitions
// - Produces DroneState[] — positions + colors, no trajectory history
// - Is NOT the export truth — only baked trajectories leave the editor
// See: src/docs/PREVIEW_VS_BAKE.md
//
// Per-node-type logic lives in nodeEvaluators.ts (strategy pattern).
// This file handles drone assignment propagation and dispatches to evaluators.
// ============================================================================

import type { ShowGraph, DroneState, Vec3, LaunchNodeData } from './types'
import { computeTiming } from './timing'
import { topologicalSort } from './topology'
import { buildGraphIndex } from './graphIndex'
import type { AnimatedFormationDef } from './animatedFormation'
import { COLOR_WHITE } from './colors'
import {
  evaluateLaunch,
  evaluateFormation,
  evaluateEdgeTransition,
  evaluateIdle,
  evaluateLand,
  resolveTargetPositions,
  optimizeAssignmentMapping,
  type EvalContext,
} from './nodeEvaluators'
import type { TransitionConstraints } from '../registries/transitions'
import { computePairwiseMinDist } from './spatialHash'

/**
 * Slice 1 Step 7: per-frame validation accumulator. Mutated by evaluateAtTime when
 * opts.validate is true and opts.prevStates/prevT are provided.
 */
export interface FrameValidationReport {
  maxVelocityAchieved: number
  minSpacingAchieved: number
  velocityViolations: number
  spacingViolations: number
}

export function createFrameValidationReport(): FrameValidationReport {
  return { maxVelocityAchieved: 0, minSpacingAchieved: Infinity, velocityViolations: 0, spacingViolations: 0 }
}

export interface EvaluateOptions {
  /** Physics constraints. Idle behaviours clamp params; per-frame validation uses these. */
  constraints?: TransitionConstraints
  /** When true, populate `report` with per-frame velocity / spacing checks (needs prevStates). */
  validate?: boolean
  /** Previous-frame states for velocity computation. */
  prevStates?: DroneState[]
  /** Previous-frame time. */
  prevT?: number
  /** Mutated by validation pass. Create one with createFrameValidationReport(). */
  report?: FrameValidationReport
  /**
   * Bundle 5 — preview-only runtime flags. Bake ignores these to preserve
   * deterministic export.
   */
  runtimeFlags?: {
    mutedIds?: Set<string>
    soloedIds?: Set<string>
  }
  /**
   * Optional out-array: when provided, `owners[droneId]` is set to the id of the
   * formation/idle node that last positioned that drone at time `t` (the
   * effective on-screen owner, via topological last-write-wins). Used by the 3D
   * viewport to map a clicked/hovered drone back to its formation. Length should
   * be ≥ droneCount; entries default to whatever the caller initialised. Purely
   * additive — has no effect on the returned states.
   */
  owners?: (string | null)[]
}

/**
 * Evaluate the graph at a specific time, returning drone positions + colors.
 *
 * Split/merge aware: tracks which drone indices are assigned to each node
 * by propagating assignments along flow edges in topological order.
 *
 * @param graph - The canonical show graph
 * @param formations - Map of formationId → generated points (rest positions for animated)
 * @param t - Current time in seconds
 * @param homePositions - Default positions for all drones
 * @param animatedDefs - Optional map of formationId → AnimatedFormationDef for animated formations
 */
export function evaluateAtTime(
  graph: ShowGraph,
  formations: Map<string, Vec3[]>,
  t: number,
  homePositions: Vec3[],
  animatedDefs?: Map<string, AnimatedFormationDef>,
  opts?: EvaluateOptions,
): DroneState[] {
  const idx = buildGraphIndex(graph)
  const timingResult = computeTiming(graph, undefined, idx)
  const timing = timingResult.ranges
  const edgeTiming = timingResult.edgeRanges
  const droneCount = homePositions.length
  const states: DroneState[] = []

  // Initialize all drones at home positions
  for (let i = 0; i < droneCount; i++) {
    const home = homePositions[i] ?? { x: 0, y: 0, z: 0 }
    states.push({
      droneId: i,
      position: { ...home },
      color: { ...COLOR_WHITE },
    })
  }

  let sortedIds: string[]
  try {
    sortedIds = topologicalSort(graph, idx)
  } catch {
    return states
  }

  // --- Drone assignment tracking ---
  const nodeAssignment = new Map<string, number[]>()
  const edgeAssignment = new Map<string, number[]>()
  // Persistent set of all assigned drone indices (avoids O(n^2) rebuild per launch node)
  const globalUsedSet = new Set<number>()

  // Shared context for all evaluators
  const ctx: EvalContext = {
    t,
    states,
    homePositions,
    formations,
    animatedDefs,
    timing,
    edgeTiming,
    idx,
    nodeAssignment,
    edgeAssignment,
    constraints: opts?.constraints,
  }

  for (const nodeId of sortedIds) {
    const node = idx.nodeById.get(nodeId)
    if (!node) continue
    const nodeTime = timing.get(nodeId)
    if (!nodeTime) continue

    // Collect incoming drone indices from upstream flow edges
    const incomingEdges = idx.flowInEdges.get(nodeId) ?? []
    let incomingDrones: number[] = []
    for (const edge of incomingEdges) {
      const edgeDrones = edgeAssignment.get(edge.id)
      if (edgeDrones) {
        incomingDrones.push(...edgeDrones)
      }
    }

    // For launch nodes: assign fresh drone indices using persistent globalUsedSet (O(n) not O(n^2))
    if (node.type === 'launch') {
      const data = node.data as LaunchNodeData
      const assigned: number[] = []
      for (let i = 0; i < droneCount && assigned.length < data.droneCount; i++) {
        if (!globalUsedSet.has(i)) {
          assigned.push(i)
          globalUsedSet.add(i)
        }
      }
      nodeAssignment.set(nodeId, assigned)
    } else {
      // Per-formation Hungarian assignment. Picks the optimal drone-to-slot mapping
      // for this formation independent of upstream chains, eliminating XZ path
      // crossings at the incoming transition. Drone identity is fungible at slots
      // (animation keyframes / color overrides target pointIndices, not drone ids),
      // so this is semantically free; the visual outcome is preserved while the
      // crossings disappear by construction. Idle leftovers stay in original order.
      if (node.type === 'formation') {
        incomingDrones = optimizeAssignmentMapping(node, incomingDrones, ctx)
      }
      nodeAssignment.set(nodeId, incomingDrones)
    }

    // Distribute drone indices across outgoing edges
    const myDrones = nodeAssignment.get(nodeId) ?? []
    const outgoingEdges = idx.flowOutEdges.get(nodeId) ?? []
    if (outgoingEdges.length === 1 && outgoingEdges[0]) {
      edgeAssignment.set(outgoingEdges[0].id, [...myDrones])
    } else if (outgoingEdges.length > 1) {
      let offset = 0
      for (const edge of outgoingEdges) {
        const slice = myDrones.slice(offset, offset + edge.droneCount)
        edgeAssignment.set(edge.id, slice)
        offset += edge.droneCount
      }
    }

    const assigned = nodeAssignment.get(nodeId) ?? []

    // Bundle 5: respect mute / solo runtime flags (preview-only)
    if (opts?.runtimeFlags) {
      const { mutedIds, soloedIds } = opts.runtimeFlags
      if (mutedIds && mutedIds.has(nodeId)) continue
      if (soloedIds && soloedIds.size > 0
          && (node.type === 'formation' || node.type === 'idle')
          && !soloedIds.has(nodeId)) continue
    }

    // Evaluate incoming edge transitions whose windows have started by t.
    // Drones on these edges get interpolated from their current (upstream-set)
    // position toward the target node's start state. We keep evaluating past
    // edgeTiming.end (clamped to easedT=1) so the upstream node's evaluator
    // doesn't re-claim the drones after they've already arrived at the target.
    // The target node's own evaluator runs AFTER this and overrides for the
    // window where it owns the drones (t >= node.start).
    if (node.type === 'formation' || node.type === 'idle' || node.type === 'land') {
      // Build the target-position map ONCE per target node over the merged drone list,
      // so per-edge transitions use the same slot assignment the target's own evaluator
      // will. Without this, two edges merging into one formation each claim formation
      // point 0 by their within-edge index, causing a position jump (up to ~half the
      // formation's diameter) when control hands off to evaluateFormation.
      const targetByDrone = resolveTargetPositions(node, incomingDrones, ctx, nodeTime.start)
      for (const edge of incomingEdges) {
        const eTime = edgeTiming.get(edge.id)
        if (!eTime || !edge.transition) continue
        if (t < eTime.start) continue
        const edgeDrones = edgeAssignment.get(edge.id) ?? []
        if (edgeDrones.length === 0) continue
        evaluateEdgeTransition(edge, eTime, edgeDrones, targetByDrone, ctx)
      }
    }

    // Skip running the node's own evaluator if it hasn't started yet — the
    // transition (above) has the steering wheel.
    if (t < nodeTime.start) continue

    // Dispatch to per-type evaluator
    switch (node.type) {
      case 'launch':
        evaluateLaunch(node, assigned, ctx)
        break
      case 'formation':
        evaluateFormation(node, assigned, ctx)
        break
      case 'idle':
        evaluateIdle(node, assigned, ctx)
        break
      case 'land':
        evaluateLand(node, nodeTime, assigned, ctx)
        break
    }

    // Effective-owner tracking for 3D selection. Topological order + this
    // last-write means a drone mid-show is attributed to the formation/idle
    // currently displaying it. Only selectable node types are recorded.
    if (opts?.owners && (node.type === 'formation' || node.type === 'idle')) {
      for (const d of assigned) opts.owners[d] = nodeId
    }
  }

  // Slice 1 Step 7: per-frame validation. Populates opts.report with peak velocity and
  // pairwise spacing checks. Preview path can call sparsely (e.g. every 6th frame at 60fps)
  // to stay within budget; bake always calls every sample.
  if (opts?.validate && opts.report && opts.prevStates && opts.prevT != null) {
    const c = opts.constraints
    const dt = t - opts.prevT
    if (dt > 0 && c) {
      let peakV = 0
      for (let i = 0; i < states.length; i++) {
        const prev = opts.prevStates[i]
        const cur = states[i]
        if (!prev || !cur) continue
        const dx = cur.position.x - prev.position.x
        const dy = cur.position.y - prev.position.y
        const dz = cur.position.z - prev.position.z
        const v = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt
        if (v > peakV) peakV = v
        if (v > c.maxVelocity) opts.report.velocityViolations++
      }
      if (peakV > opts.report.maxVelocityAchieved) opts.report.maxVelocityAchieved = peakV
    }
    if (c) {
      const pts = states.map((s) => s.position)
      const { minDist, violations } = computePairwiseMinDist(pts, c.minSpacing)
      if (minDist > 0 && minDist < opts.report.minSpacingAchieved) opts.report.minSpacingAchieved = minDist
      opts.report.spacingViolations += violations
    }
  }

  return states
}
