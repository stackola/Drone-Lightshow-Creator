// ============================================================================
// S14: Auto-Fix & Smart Assistance
// ============================================================================
// Per-violation-type fix options, multi-fix, "Fix All", auto-timing.
// After the transition-as-edge refactor: transition fixes operate on
// edge.transition.preferredDuration (not a transition node).
// ============================================================================

import type { ShowGraph, ShowEdge, Vec3, FormationNodeData } from './types'
import type { Constraints } from '../stores/projectStore'
import type { PhysicsViolation } from './physicsValidator'
import { computeAllTiming } from './timing'
import { getTransition, toTransitionConstraints } from '../registries/transitions'

// --- ViolationFix type with multiple options ---

export type FixImpact = 'minimal' | 'moderate' | 'significant'

export interface ViolationFixOption {
  id: string
  label: string
  description: string
  impact: FixImpact
  /** Apply the fix — returns patches to apply to the graph. */
  computePatches: (graph: ShowGraph) => FixPatch[]
}

export interface FixPatch {
  /** When set, patch is applied to a ShowEdge's `transition` field. */
  edgeId?: string
  /** When set, patch is applied to a ShowNode's `data`. */
  nodeId?: string
  patch: Record<string, unknown>
}

// --- Multi-fix options per violation ---

export function getFixOptionsForViolation(
  violation: PhysicsViolation,
  graph: ShowGraph,
  constraints: Constraints,
  formations: Map<string, Vec3[]>,
): ViolationFixOption[] {
  switch (violation.type) {
    case 'transition-too-short':
      return getTransitionTooShortFixes(violation, graph, constraints, formations)
    case 'keyframe-too-fast':
      return getKeyframeTooFastFixes(violation, graph)
    default:
      return violation.fix
        ? [{
            id: 'extend-duration',
            label: violation.fix.description,
            description: violation.fix.description,
            impact: 'moderate' as FixImpact,
            computePatches: (g: ShowGraph) => {
              const fix = violation.fix!
              const targetNode = g.nodes.find((n) => n.id === fix.nodeId)
              if (!targetNode) return [{ nodeId: fix.nodeId, patch: {} }]
              const data = targetNode.data as { duration: number }
              return [{ nodeId: fix.nodeId, patch: { duration: data.duration + fix.delta } }]
            },
          }]
        : []
  }
}

// --- Transition-too-short fixes (per-edge after refactor) ---

function getTransitionTooShortFixes(
  violation: PhysicsViolation,
  graph: ShowGraph,
  _constraints: Constraints,
  _formations: Map<string, Vec3[]>,
): ViolationFixOption[] {
  const options: ViolationFixOption[] = []
  const edge = violation.edgeId ? graph.edges.find((e) => e.id === violation.edgeId) : null
  if (!edge || !edge.transition) return options
  const cfg = edge.transition

  // Option 1: Extend the edge's preferred transition duration
  if (violation.fix) {
    options.push({
      id: 'extend-transition',
      label: `Extend transition by ${violation.fix.delta.toFixed(1)}s`,
      description: 'Give the transition more time without moving the downstream formation',
      impact: 'moderate',
      computePatches: () => [{
        edgeId: edge.id,
        patch: { preferredDuration: cfg.preferredDuration + violation.fix!.delta },
      }],
    })
  }

  // Option 2: Switch to shortest-path strategy
  options.push({
    id: 'change-strategy',
    label: 'Try "shortest-path" strategy',
    description: 'Different strategies may require less time',
    impact: 'minimal',
    computePatches: () => [{
      edgeId: edge.id,
      patch: { strategyId: 'shortest-path', parameters: {} },
    }],
  })

  return options
}

// --- Keyframe-too-fast fixes ---

function getKeyframeTooFastFixes(
  violation: PhysicsViolation,
  graph: ShowGraph,
): ViolationFixOption[] {
  const options: ViolationFixOption[] = []
  const node = graph.nodes.find((n) => n.id === violation.nodeId)
  if (!node || node.type !== 'formation') return options
  const data = node.data as FormationNodeData

  options.push({
    id: 'extend-formation',
    label: 'Extend formation duration by 2s',
    description: 'More time = slower keyframe movement',
    impact: 'moderate',
    computePatches: () => [{ nodeId: violation.nodeId, patch: { duration: data.duration + 2 } }],
  })

  options.push({
    id: 'reduce-keyframes',
    label: 'Reduce keyframe displacement by 50%',
    description: 'Halve the position change in keyframes',
    impact: 'moderate',
    computePatches: () => {
      const scaledKeyframes = data.keyframes.map((kf) => ({
        ...kf,
        transform: {
          ...kf.transform,
          position: {
            x: data.transform.position.x + (kf.transform.position.x - data.transform.position.x) * 0.5,
            y: data.transform.position.y + (kf.transform.position.y - data.transform.position.y) * 0.5,
            z: data.transform.position.z + (kf.transform.position.z - data.transform.position.z) * 0.5,
          },
        },
      }))
      return [{ nodeId: violation.nodeId, patch: { keyframes: scaledKeyframes } }]
    },
  })

  return options
}

// --- "Fix All" with smart ordering ---

export function computeFixAllPatches(
  violations: PhysicsViolation[],
  graph: ShowGraph,
  constraints: Constraints,
  formations: Map<string, Vec3[]>,
): FixPatch[] {
  const allPatches: FixPatch[] = []

  // Sort violations: upstream nodes first (by topological order approximation via startTime)
  const timing = computeAllTiming(graph)
  const sorted = [...violations].sort((a, b) => {
    const ta = timing.get(a.nodeId)?.start ?? 0
    const tb = timing.get(b.nodeId)?.start ?? 0
    return ta - tb
  })

  for (const violation of sorted) {
    const options = getFixOptionsForViolation(violation, graph, constraints, formations)
    const best = options.sort((a, b) => impactOrder(a.impact) - impactOrder(b.impact))[0]
    if (best) {
      allPatches.push(...best.computePatches(graph))
    }
  }

  return allPatches
}

function impactOrder(impact: FixImpact): number {
  switch (impact) {
    case 'minimal': return 0
    case 'moderate': return 1
    case 'significant': return 2
  }
}

// --- Auto-timing — recompute every flow edge's preferredDuration ---

/**
 * Compute optimal flow-edge transition durations based on physics constraints + distances.
 */
export function computeAutoTiming(
  graph: ShowGraph,
  constraints: Constraints,
  formations: Map<string, Vec3[]>,
): FixPatch[] {
  const patches: FixPatch[] = []
  const tc = toTransitionConstraints(constraints)

  for (const edge of graph.edges) {
    if (edge.edgeType !== 'flow' || !edge.transition) continue
    const cfg = edge.transition
    const transition = getTransition(cfg.strategyId)
    if (!transition?.computeMinDuration) continue

    const sourceNode = graph.nodes.find((n) => n.id === edge.source)
    const targetNode = graph.nodes.find((n) => n.id === edge.target)
    if (!sourceNode || !targetNode) continue

    const sourceFormId = sourceNode.type === 'formation' ? (sourceNode.data as FormationNodeData).formationId : null
    const targetFormId = targetNode.type === 'formation' ? (targetNode.data as FormationNodeData).formationId : null
    if (!sourceFormId || !targetFormId) continue

    const sourcePoints = formations.get(sourceFormId) ?? []
    const targetPoints = formations.get(targetFormId) ?? []
    if (sourcePoints.length === 0 || targetPoints.length === 0) continue

    const mapping = transition.mapPoints(sourcePoints, targetPoints, [], [])
    const minDuration = transition.computeMinDuration(mapping, sourcePoints, targetPoints, cfg.parameters, tc)

    if (minDuration > cfg.preferredDuration) {
      patches.push({
        edgeId: edge.id,
        patch: { preferredDuration: Math.ceil(minDuration * 10) / 10 + 0.5 },
      })
    }
  }

  return patches
}

/**
 * Helper for callers that need to know whether a fix patch applies to a node or edge.
 */
export function isEdgePatch(patch: FixPatch): patch is FixPatch & { edgeId: string } {
  return typeof patch.edgeId === 'string'
}

// re-export for type discrimination; some legacy callers expect ShowEdge here.
export type { ShowEdge }
