// ============================================================================
// Derived Timing for All Nodes (+ per-edge transition timing)
// ============================================================================
// ARCHITECTURAL LAW: Time is read exclusively from node.data fields.
// Transitions are NOT nodes — they're a property of flow edges between timed
// nodes. A flow edge `A → B` defines the window `[A.end, A.end + effective]`
// during which drones move from A's end state to B's start state.
// Land timing is derived. Group timing is derived from children.
// position.x is NEVER read for time.
// ============================================================================

import type {
  ShowGraph, ShowNode, ShowEdge, Vec3,
  LaunchNodeData, FormationNodeData, IdleNodeData, LandNodeData,
  NodeWarning,
} from './types'
import { topologicalSort } from './topology'
import { buildGraphIndex, type GraphIndex } from './graphIndex'
import { getTransition, DEFAULT_TRANSITION_CONSTRAINTS, type TransitionConstraints } from '../registries/transitions'
import { interpolateTransform, applyTransform } from './interpolateTransform'

export interface TimeRange {
  start: number
  end: number
}

export interface TimingResult {
  /** Effective time range for every node, after cascade-push. */
  ranges: Map<string, TimeRange>
  /** Effective time range for every flow edge's transition window. */
  edgeRanges: Map<string, TimeRange>
  /** Warnings emitted during the solve (cascade-push, duration-extended, etc). */
  warnings: NodeWarning[]
  /** Per-edge minimum required duration from strategy.computeMinDuration. */
  minRequired: Map<string, number>
  /** Per-node push delta applied to its authored startTime (downstream nodes). */
  pushDeltas: Map<string, number>
}

export interface TimingOptions {
  /** Formation point clouds for transitions to extract endpoints from. */
  formations?: Map<string, Vec3[]>
  /** Drone home positions, used for launch → first-formation transitions. */
  homePositions?: Vec3[]
  /** Physics constraints for computeMinDuration. Defaults to DEFAULT_TRANSITION_CONSTRAINTS. */
  constraints?: TransitionConstraints
  /**
   * 'cascade-push' (default): when a transition's effective duration overruns a downstream node,
   * push downstream startTimes by the overrun. 'warn-only': don't push, emit warnings instead.
   */
  mode?: 'cascade-push' | 'warn-only'
}

/**
 * Single-pass timing solver. Computes effective ranges for every node and
 * every flow edge's transition window, runs computeMinDuration per edge, and
 * cascade-pushes downstream nodes to keep the show well-formed.
 *
 * When `opts.formations` is not provided, transition `minRequired` is treated
 * as 0 (preview mode); `preferredDuration` alone determines transition
 * duration.
 */
export function computeTiming(graph: ShowGraph, opts?: TimingOptions, index?: GraphIndex): TimingResult {
  const ranges = new Map<string, TimeRange>()
  const edgeRanges = new Map<string, TimeRange>()
  const warnings: NodeWarning[] = []
  const minRequiredMap = new Map<string, number>()
  const pushDeltas = new Map<string, number>()
  const idx = index ?? buildGraphIndex(graph)
  const constraints = opts?.constraints ?? DEFAULT_TRANSITION_CONSTRAINTS
  const mode = opts?.mode ?? 'cascade-push'

  let sortedIds: string[]
  try {
    sortedIds = topologicalSort(graph, idx)
  } catch {
    return { ranges, edgeRanges, warnings, minRequired: minRequiredMap, pushDeltas }
  }

  // pushOffset accumulates over the solve; effective startTime = authored startTime + pushOffset.
  const pushOffset = new Map<string, number>()
  const getPush = (id: string) => pushOffset.get(id) ?? 0

  for (const nodeId of sortedIds) {
    const node = idx.nodeById.get(nodeId)
    if (!node) continue

    // Resolve incoming flow edges first so we can compute their transition windows
    // and decide whether to cascade-push this node.
    const incomingFlowEdges = idx.flowInEdges.get(nodeId) ?? []
    let maxIncomingEdgeEnd = 0
    let anyWarnPolicy = false
    for (const edge of incomingFlowEdges) {
      const srcRange = ranges.get(edge.source)
      if (!srcRange) continue
      const cfg = edge.transition
      const preferred = cfg?.preferredDuration ?? 0

      let minRequired = 0
      if (opts?.formations && cfg) {
        minRequired = computeEdgeTransitionMinRequired(edge, idx, opts.formations, opts.homePositions ?? [], constraints)
        minRequiredMap.set(edge.id, minRequired)
      }

      const effective = Math.max(preferred, minRequired)
      const edgeStart = srcRange.end
      const edgeEnd = edgeStart + effective
      edgeRanges.set(edge.id, { start: edgeStart, end: edgeEnd })
      if (edgeEnd > maxIncomingEdgeEnd) maxIncomingEdgeEnd = edgeEnd

      if (cfg && effective > preferred + 1e-6) {
        warnings.push({
          nodeId: edge.target,
          kind: 'duration-extended',
          delta: effective - preferred,
          message: `Transition on edge ${edge.id} needs ${effective.toFixed(1)}s (preferred ${preferred.toFixed(1)}s)`,
        })
      }

      if (cfg?.pushPolicy === 'warn') anyWarnPolicy = true
    }

    // Cascade-push the downstream node (this one) if an incoming transition window
    // overruns its authored start.
    if (incomingFlowEdges.length > 0 && (node.type === 'formation' || node.type === 'idle')) {
      const data = node.data as FormationNodeData | IdleNodeData
      const effectiveStart = data.startTime + getPush(nodeId)
      const overrun = maxIncomingEdgeEnd - effectiveStart
      if (overrun > 1e-6) {
        const isFormation = node.type === 'formation'
        const locked = isFormation && (data as FormationNodeData).staggerLock === true
        if (locked || anyWarnPolicy || mode === 'warn-only') {
          warnings.push({
            nodeId,
            kind: 'min-not-met',
            delta: overrun,
            message: `Upstream transition(s) need +${overrun.toFixed(1)}s but ${nodeId} is locked or push disabled`,
          })
        } else {
          addPush(pushOffset, nodeId, overrun, pushDeltas, warnings)
          // Re-extend incoming edge windows so their end matches the pushed start (no gap).
          for (const edge of incomingFlowEdges) {
            const er = edgeRanges.get(edge.id)
            if (!er) continue
            const newEnd = data.startTime + getPush(nodeId)
            if (newEnd > er.end) {
              edgeRanges.set(edge.id, { start: er.start, end: newEnd })
            }
          }
        }
      }
    }

    const range = solveNodeTiming(node, idx, ranges, edgeRanges, pushOffset)
    if (!range) continue
    ranges.set(nodeId, range)
  }

  // Derive group timing from children's post-push ranges.
  const groupNodes = graph.nodes.filter((n) => n.type === 'group')
  for (const group of groupNodes) {
    const children = graph.nodes.filter((n) => n.parentId === group.id)
    if (children.length === 0) continue
    let minStart = Infinity
    let maxEnd = -Infinity
    for (const child of children) {
      const childRange = ranges.get(child.id)
      if (childRange) {
        minStart = Math.min(minStart, childRange.start)
        maxEnd = Math.max(maxEnd, childRange.end)
      }
    }
    if (minStart !== Infinity && maxEnd !== -Infinity) {
      ranges.set(group.id, { start: minStart, end: maxEnd })
    }
  }

  return { ranges, edgeRanges, warnings, minRequired: minRequiredMap, pushDeltas }
}

function addPush(
  pushOffset: Map<string, number>,
  nodeId: string,
  delta: number,
  pushDeltas: Map<string, number>,
  warnings: NodeWarning[],
): void {
  const existing = pushOffset.get(nodeId) ?? 0
  const total = existing + delta
  pushOffset.set(nodeId, total)
  pushDeltas.set(nodeId, total)
  warnings.push({
    nodeId,
    kind: 'cascade-push',
    delta,
    message: `Pushed by ${delta.toFixed(1)}s to make room for upstream transition`,
  })
}

function solveNodeTiming(
  node: ShowNode,
  idx: GraphIndex,
  _ranges: Map<string, TimeRange>,
  edgeRanges: Map<string, TimeRange>,
  pushOffset: Map<string, number>,
): TimeRange | null {
  const push = pushOffset.get(node.id) ?? 0
  switch (node.type) {
    case 'launch': {
      const data = node.data as LaunchNodeData
      const staggerTime = data.droneCount * data.staggerDelay
      const riseDuration = Math.max(1.5, 8 / 4) // 2.0s — matches nodeEvaluators.ts
      const start = data.startTime + push
      return { start, end: start + staggerTime + riseDuration }
    }
    case 'formation': {
      const data = node.data as FormationNodeData
      const start = data.startTime + push
      return { start, end: start + data.duration }
    }
    case 'idle': {
      const data = node.data as IdleNodeData
      const start = data.startTime + push
      return { start, end: start + data.duration }
    }
    case 'land': {
      const data = node.data as LandNodeData
      const incomingFlowEdges = idx.flowInEdges.get(node.id) ?? []
      let maxEnd = 0
      let incomingDroneCount = 0
      for (const edge of incomingFlowEdges) {
        const er = edgeRanges.get(edge.id)
        if (er) maxEnd = Math.max(maxEnd, er.end)
        incomingDroneCount += edge.droneCount
      }
      const descentDuration = Math.max(1.5, 8 / 4)
      const estimatedDrones = Math.max(1, incomingDroneCount)
      const landDuration = Math.max(3, data.staggerDelay * estimatedDrones + descentDuration)
      return { start: maxEnd, end: maxEnd + landDuration }
    }
    case 'group':
      return null
    default:
      return null
  }
}

/**
 * Compute the minimum required transition duration for a single flow edge,
 * given the source/target node positions. Replaces the former per-transition-node
 * variant that scanned multiple upstream/downstream edges.
 */
export function computeEdgeTransitionMinRequired(
  edge: ShowEdge,
  idx: GraphIndex,
  formations: Map<string, Vec3[]>,
  homePositions: Vec3[],
  constraints: TransitionConstraints,
): number {
  const cfg = edge.transition
  if (!cfg) return 0
  const strategy = getTransition(cfg.strategyId)
  if (!strategy) return 0

  const srcNode = idx.nodeById.get(edge.source)
  const tgtNode = idx.nodeById.get(edge.target)
  if (!srcNode || !tgtNode) return 0

  const fromPoints: Vec3[] = []
  if (srcNode.type === 'formation') {
    const fd = srcNode.data as FormationNodeData
    if (fd.formationId) {
      const pts = formations.get(fd.formationId)
      if (pts && pts.length > 0) {
        const transform = interpolateTransform(fd.transform, fd.keyframes, fd.duration)
        fromPoints.push(...pts.map((p) => applyTransform(p, transform)))
      }
    }
  } else if (srcNode.type === 'launch' && homePositions.length > 0) {
    const riseHeight = 8
    const launchData = srcNode.data as LaunchNodeData
    const sampleCount = Math.min(20, launchData.droneCount, homePositions.length)
    for (let i = 0; i < sampleCount; i++) {
      const h = homePositions[i]!
      fromPoints.push({ x: h.x, y: riseHeight, z: h.z })
    }
  }
  if (fromPoints.length === 0) return 0

  const toPoints: Vec3[] = []
  if (tgtNode.type === 'formation') {
    const fd = tgtNode.data as FormationNodeData
    if (fd.formationId) {
      const pts = formations.get(fd.formationId)
      if (pts && pts.length > 0) {
        const transform = interpolateTransform(fd.transform, fd.keyframes, 0)
        toPoints.push(...pts.map((p) => applyTransform(p, transform)))
      }
    }
  }
  if (toPoints.length === 0) return 0

  const mapping = strategy.mapPoints(fromPoints, toPoints, [], [])
  return strategy.computeMinDuration(mapping, fromPoints, toPoints, cfg.parameters, constraints)
}

/**
 * Backward-compat wrapper. Returns just the ranges Map for callers that don't need diagnostics.
 */
export function computeAllTiming(graph: ShowGraph, index?: GraphIndex): Map<string, TimeRange> {
  return computeTiming(graph, undefined, index).ranges
}

/**
 * Get the total duration of the entire show graph.
 */
export function getTotalDuration(graph: ShowGraph): number {
  const timing = computeAllTiming(graph)
  let maxEnd = 0
  for (const range of timing.values()) {
    maxEnd = Math.max(maxEnd, range.end)
  }
  return maxEnd
}
