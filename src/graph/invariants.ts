// ============================================================================
// G-01: Canonical Graph Invariants
// ============================================================================
// These invariants are LAWS. Every store operation must preserve them.
// checkInvariants() returns violations — an empty array means the graph is healthy.
// ============================================================================

import type { ShowGraph } from './types'

/**
 * Check all canonical graph invariants. Returns an array of violation descriptions.
 * An empty array means the graph satisfies all invariants.
 */
export function checkInvariants(graph: ShowGraph): string[] {
  const violations: string[] = []

  violations.push(...checkNodeIdStability(graph))
  violations.push(...checkNoDerivedStatePersisted(graph))
  violations.push(...checkEdgeIntegrity(graph))
  violations.push(...checkSerializableCompleteness(graph))

  return violations
}

/**
 * INVARIANT: Node IDs must be unique.
 */
function checkNodeIdStability(graph: ShowGraph): string[] {
  const violations: string[] = []
  const seen = new Set<string>()

  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      violations.push(`Duplicate node ID: '${node.id}'`)
    }
    seen.add(node.id)
  }

  const edgeSeen = new Set<string>()
  for (const edge of graph.edges) {
    if (edgeSeen.has(edge.id)) {
      violations.push(`Duplicate edge ID: '${edge.id}'`)
    }
    edgeSeen.add(edge.id)
  }

  return violations
}

/**
 * INVARIANT: No derived state (flow counts, evaluation results) is persisted
 * into the canonical ShowGraph. droneCount on edges is a computed cache that
 * gets recomputed — but it IS stored for serialization convenience.
 * The key invariant: no evaluation results, no transition timing, no preview
 * data lives in the ShowGraph.
 */
function checkNoDerivedStatePersisted(graph: ShowGraph): string[] {
  const violations: string[] = []

  for (const node of graph.nodes) {
    const data = node.data as unknown as Record<string, unknown>
    // These fields should never exist on node.data — they are derived
    if ('resolvedTiming' in data) {
      violations.push(`Node '${node.id}' has derived 'resolvedTiming' in data`)
    }
    if ('evaluationResult' in data) {
      violations.push(`Node '${node.id}' has derived 'evaluationResult' in data`)
    }
    if ('previewPositions' in data) {
      violations.push(`Node '${node.id}' has derived 'previewPositions' in data`)
    }
  }

  return violations
}

/**
 * INVARIANT: All edges reference existing nodes.
 */
function checkEdgeIntegrity(graph: ShowGraph): string[] {
  const violations: string[] = []
  const nodeIds = new Set(graph.nodes.map((n) => n.id))

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      violations.push(`Edge '${edge.id}' references non-existent source node '${edge.source}'`)
    }
    if (!nodeIds.has(edge.target)) {
      violations.push(`Edge '${edge.id}' references non-existent target node '${edge.target}'`)
    }
  }

  return violations
}

/**
 * INVARIANT: ShowGraph is the complete serializable truth.
 * Every node must have: id, type, position, data, parentId.
 * Every edge must have: id, edgeType, source, sourcePort, target, targetPort.
 */
function checkSerializableCompleteness(graph: ShowGraph): string[] {
  const violations: string[] = []

  for (const node of graph.nodes) {
    const n = node as unknown as Record<string, unknown>
    if (!n.id) violations.push(`Node missing 'id'`)
    if (!n.type) violations.push(`Node '${n.id}' missing 'type'`)
    if (n.position === undefined || n.position === null) {
      violations.push(`Node '${n.id}' missing 'position'`)
    }
    if (n.data === undefined || n.data === null) {
      violations.push(`Node '${n.id}' missing 'data'`)
    }
  }

  for (const edge of graph.edges) {
    if (!edge.id) violations.push(`Edge missing 'id'`)
    if (!edge.edgeType) violations.push(`Edge '${edge.id}' missing 'edgeType'`)
    if (!edge.source) violations.push(`Edge '${edge.id}' missing 'source'`)
    if (!edge.sourcePort) violations.push(`Edge '${edge.id}' missing 'sourcePort'`)
    if (!edge.target) violations.push(`Edge '${edge.id}' missing 'target'`)
    if (!edge.targetPort) violations.push(`Edge '${edge.id}' missing 'targetPort'`)
  }

  return violations
}
