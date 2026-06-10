// ============================================================================
// Derive React Flow elements from graphStore
// ============================================================================
// Pure functions that convert ShowNode[]/ShowEdge[] into React Flow format.
// Extracted from GraphCanvas.tsx for maintainability.
// ============================================================================

import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react'
import type { ShowNode, ShowEdge, Diagnostic } from '../../graph/types'
import type { TimeRange } from '../../graph/timing'
import { timeToCanvasX } from '../../stores/viewStore'

/** Derive React Flow nodes from graphStore state */
export function deriveRFNodes(
  nodes: ShowNode[],
  pxPerSecond: number,
  edges: ShowEdge[],
  diagnostics: Diagnostic[],
  currentTime: number,
  selectedNodeIds: string[],
  timingMap?: Map<string, TimeRange>,
): RFNode[] {
  // Build per-node diagnostic lookup
  const nodeDiagMap = new Map<string, Diagnostic[]>()
  for (const d of diagnostics) {
    for (const nid of d.nodeIds) {
      const existing = nodeDiagMap.get(nid)
      if (existing) existing.push(d)
      else nodeDiagMap.set(nid, [d])
    }
  }

  return nodes.map((node) => {
    // For timed nodes, derive position.x from data.startTime
    let posX = node.position.x
    if (node.type === 'launch' || node.type === 'formation' || node.type === 'idle') {
      posX = timeToCanvasX(node.data.startTime, pxPerSecond)
    }

    // Compute incoming drone count for display
    let incomingDrones: number | undefined
    if (node.type === 'formation' || node.type === 'idle') {
      const inEdges = edges.filter((e) => e.edgeType === 'flow' && e.target === node.id)
      incomingDrones = inEdges.reduce((sum, e) => sum + e.droneCount, 0)
    }

    // Compute outgoing drone count and unallocated count
    const outEdges = edges.filter((e) => e.edgeType === 'flow' && e.source === node.id)
    const outgoingDrones = outEdges.reduce((sum, e) => sum + e.droneCount, 0)

    // Flow diagnostics for this node
    const nodeDiags = nodeDiagMap.get(node.id) ?? []
    const hasOverAllocation = nodeDiags.some((d) => d.severity === 'error' && d.message.includes('over-alloc'))
    const hasUnderAllocation = nodeDiags.some((d) => d.severity === 'warning' && d.message.includes('under-alloc'))
    const unallocatedCount = incomingDrones != null ? Math.max(0, (incomingDrones ?? 0) - outgoingDrones) : 0

    // Active at playhead time?
    const timing = timingMap?.get(node.id)
    const isActiveAtPlayhead = timing ? (currentTime >= timing.start && currentTime <= timing.end) : false

    const data = {
      ...node.data,
      incomingDrones,
      hasOverAllocation,
      hasUnderAllocation,
      unallocatedCount,
      isActiveAtPlayhead,
    } as Record<string, unknown>

    return {
      id: node.id,
      type: node.type,
      position: { x: posX, y: node.position.y },
      data,
      parentId: node.parentId ?? undefined,
      draggable: true,
      selectable: true,
      selected: selectedNodeIds.includes(node.id),
      deletable: node.type !== 'launch' && node.type !== 'land',
    } satisfies RFNode
  })
}

/** Derive React Flow edges from graphStore state */
export function deriveRFEdges(edges: ShowEdge[]): RFEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourcePort,
    target: edge.target,
    targetHandle: edge.targetPort,
    type: edge.edgeType,
    label: edge.edgeType === 'flow' && edge.droneCount > 0 ? String(edge.droneCount) : undefined,
    data: { allocation: edge.allocation, transition: edge.transition },
  }))
}
