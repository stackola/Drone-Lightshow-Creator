// ============================================================================
// Graph Validation
// ============================================================================
// Returns diagnostics for: cycles, orphan nodes, flow conservation,
// time ordering, dangling edges, port constraint compliance.
// Partially invalid graphs do NOT poison the entire graph —
// validation is per-diagnostic.
// ============================================================================

import type { ShowGraph, Diagnostic, FormationNodeData, LaunchNodeData, IdleNodeData, LandNodeData } from './types'
import { detectCycles } from './topology'
import { computeFlow } from './flow'
import { computeAllTiming } from './timing'

/**
 * Validate the entire graph. Returns array of diagnostics.
 * An empty array means the graph is valid.
 */
export function validateGraph(graph: ShowGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []

  diagnostics.push(...checkCycles(graph))
  diagnostics.push(...checkDanglingEdges(graph))
  diagnostics.push(...checkDuplicateEdges(graph))
  diagnostics.push(...checkOrphanNodes(graph))
  diagnostics.push(...checkNegativeDurations(graph))
  diagnostics.push(...checkFormationReferences(graph))
  diagnostics.push(...checkFlowConservation(graph))
  diagnostics.push(...checkTimeOrdering(graph))
  diagnostics.push(...checkMissingTransitions(graph))

  return diagnostics
}

function checkCycles(graph: ShowGraph): Diagnostic[] {
  const cycles = detectCycles(graph)
  if (!cycles) return []

  return cycles.map((cycle) => ({
    severity: 'error' as const,
    message: `Cycle detected: ${cycle.join(' → ')}`,
    nodeIds: cycle,
    edgeIds: [],
  }))
}

function checkDanglingEdges(graph: ShowGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const nodeIds = new Set(graph.nodes.map((n) => n.id))

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      diagnostics.push({
        severity: 'error',
        message: `Edge '${edge.id}' references missing source node '${edge.source}'`,
        nodeIds: [],
        edgeIds: [edge.id],
      })
    }
    if (!nodeIds.has(edge.target)) {
      diagnostics.push({
        severity: 'error',
        message: `Edge '${edge.id}' references missing target node '${edge.target}'`,
        nodeIds: [],
        edgeIds: [edge.id],
      })
    }
  }

  return diagnostics
}

function checkOrphanNodes(graph: ShowGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []

  for (const node of graph.nodes) {
    // Launch nodes and group nodes are allowed to have no incoming edges
    if (node.type === 'launch' || node.type === 'group') continue

    const hasIncoming = graph.edges.some(
      (e) => e.target === node.id && e.edgeType === 'flow',
    )

    if (!hasIncoming) {
      diagnostics.push({
        severity: 'warning',
        message: `Node '${node.id}' (${node.type}) has no incoming flow edges`,
        nodeIds: [node.id],
        edgeIds: [],
      })
    }
  }

  return diagnostics
}

function checkFlowConservation(graph: ShowGraph): Diagnostic[] {
  const flowResult = computeFlow(graph)
  return flowResult.diagnostics
}

/**
 * After the transition-as-edge refactor, every flow edge between timed nodes
 * SHOULD carry a transition config. Flag edges that don't.
 */
function checkMissingTransitions(graph: ShowGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []

  for (const edge of graph.edges) {
    if (edge.edgeType !== 'flow') continue
    if (!edge.transition) {
      diagnostics.push({
        severity: 'warning',
        message: `Flow edge '${edge.id}' is missing a transition config — drones will jump instantly between nodes.`,
        nodeIds: [edge.source, edge.target],
        edgeIds: [edge.id],
      })
    }
  }

  return diagnostics
}

function checkDuplicateEdges(graph: ShowGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const seen = new Set<string>()

  for (const edge of graph.edges) {
    if (edge.edgeType !== 'flow') continue
    const key = `${edge.source}->${edge.target}`
    if (seen.has(key)) {
      diagnostics.push({
        severity: 'error',
        message: `Duplicate flow edge from '${edge.source}' to '${edge.target}'`,
        nodeIds: [edge.source, edge.target],
        edgeIds: [edge.id],
      })
    }
    seen.add(key)
  }

  return diagnostics
}

function checkNegativeDurations(graph: ShowGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []

  for (const node of graph.nodes) {
    if (node.type === 'formation') {
      const data = node.data as FormationNodeData
      if (data.duration < 0) {
        diagnostics.push({ severity: 'error', message: `Formation '${node.id}' has negative duration (${data.duration}s)`, nodeIds: [node.id], edgeIds: [] })
      }
      if (data.startTime < 0) {
        diagnostics.push({ severity: 'warning', message: `Formation '${node.id}' has negative start time (${data.startTime}s)`, nodeIds: [node.id], edgeIds: [] })
      }
    } else if (node.type === 'launch') {
      const data = node.data as LaunchNodeData
      if (data.staggerDelay < 0) {
        diagnostics.push({ severity: 'error', message: `Launch '${node.id}' has negative stagger delay`, nodeIds: [node.id], edgeIds: [] })
      }
    } else if (node.type === 'idle') {
      const data = node.data as IdleNodeData
      if (data.duration < 0) {
        diagnostics.push({ severity: 'error', message: `Idle '${node.id}' has negative duration`, nodeIds: [node.id], edgeIds: [] })
      }
    } else if (node.type === 'land') {
      const data = node.data as LandNodeData
      if (data.staggerDelay < 0) {
        diagnostics.push({ severity: 'error', message: `Land '${node.id}' has negative stagger delay`, nodeIds: [node.id], edgeIds: [] })
      }
    }
  }

  return diagnostics
}

function checkFormationReferences(graph: ShowGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  // S4-02: Check that formationId references exist (warned, not errored — falls back to grid)
  // S4-03: Check launch drone count doesn't exceed total drone pool
  // (We can't check against formationStore here since this is a pure graph function,
  //  but we can check for empty formationId references)
  for (const node of graph.nodes) {
    if (node.type === 'formation') {
      const data = node.data as FormationNodeData
      if (data.formationId === '') {
        diagnostics.push({
          severity: 'warning',
          message: `Formation '${node.id}' has empty formationId — will use fallback grid layout`,
          nodeIds: [node.id],
          edgeIds: [],
        })
      }
    }
  }
  return diagnostics
}

function checkTimeOrdering(graph: ShowGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const timing = computeAllTiming(graph)
  const flowEdges = graph.edges.filter((e) => e.edgeType === 'flow')

  for (const edge of flowEdges) {
    const sourceTiming = timing.get(edge.source)
    const targetTiming = timing.get(edge.target)

    if (!sourceTiming || !targetTiming) continue

    // Skip land nodes — their timing is derived from upstream.
    const targetNode = graph.nodes.find((n) => n.id === edge.target)
    if (targetNode && targetNode.type === 'land') continue

    if (sourceTiming.end > targetTiming.start) {
      diagnostics.push({
        severity: 'warning',
        message: `Time overlap: '${edge.source}' ends at ${sourceTiming.end.toFixed(1)}s but '${edge.target}' starts at ${targetTiming.start.toFixed(1)}s`,
        nodeIds: [edge.source, edge.target],
        edgeIds: [edge.id],
      })
    }
  }

  return diagnostics
}
