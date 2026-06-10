// ============================================================================
// autoWire — connect a newly placed node into the show flow.
//
// Build mode places nodes by dropping them onto the 3D stage; without an edge
// they are orphans the timing solver never reaches (droneCount 0, never
// plays). This module picks the most plausible neighbour by *time* — the
// authoring intent in Build mode — and creates the flow edge, which also
// attaches the default transition config (see graphStore.addEdge).
//
// Rules (all guarded by ports.isValidConnection, so type compatibility and
// port direction can never be violated):
// - Node with a flow-in (formation / idle / land): wire from the temporally
//   preceding node, preferring the current tail of the show (a node with no
//   outgoing flow edge) so drops extend the show instead of forking it.
// - Launch node: wire to the earliest node that has a flow-in and no incoming
//   flow edge yet (the orphaned head of the show).
// - No-op (returns null) when the node already has a flow connection or no
//   valid neighbour exists.
// ============================================================================

import { useGraphStore } from '../stores/graphStore'
import { NODE_PORT_DEFS } from './ports'
import type { ShowNode } from './types'

/** Authored start time of a node, falling back to 0 (launch defaults). */
function nodeStart(node: ShowNode): number {
  const data = node.data as { startTime?: number }
  return data.startTime ?? 0
}

function hasPort(node: ShowNode, portId: string): boolean {
  return NODE_PORT_DEFS[node.type].some((p) => p.id === portId)
}

/**
 * Wire `nodeId` into the flow. Returns the created edge id, or null when
 * nothing was wired (already connected / no valid neighbour).
 */
export function wireNodeIntoFlow(nodeId: string): string | null {
  const store = useGraphStore.getState()
  const node = store.getNode(nodeId)
  if (!node || node.type === 'group') return null

  const flowEdges = store.edges.filter((e) => e.edgeType === 'flow')

  if (!hasPort(node, 'flow-in')) {
    // Launch — adopt the orphaned head of the show, if any.
    const head = store.nodes
      .filter(
        (n) =>
          n.id !== nodeId &&
          hasPort(n, 'flow-in') &&
          !flowEdges.some((e) => e.target === n.id),
      )
      .sort((a, b) => nodeStart(a) - nodeStart(b))[0]
    if (!head) return null
    return store.addEdge(nodeId, 'flow-out', head.id, 'flow-in', 'flow')
  }

  // Already part of the flow? Leave the user's wiring alone.
  if (flowEdges.some((e) => e.target === nodeId || e.source === nodeId)) return null

  const timing = store.getCachedTiming()
  const startTime = nodeStart(node)

  const candidates = store.nodes.filter((n) => n.id !== nodeId && hasPort(n, 'flow-out'))
  if (candidates.length === 0) return null

  const scored = candidates
    .map((n) => {
      const range = timing.get(n.id)
      const end = range?.end ?? nodeStart(n)
      const start = range?.start ?? nodeStart(n)
      const isTail = !flowEdges.some((e) => e.source === n.id)
      return { n, end, start, isTail }
    })
    // Only consider nodes that begin before the new node — wiring *from the
    // future* would just trigger a cascade-push of everything downstream.
    .filter((c) => c.start <= startTime)
    .sort((a, b) => {
      // Prefer the show's tail; then the closest preceding end time.
      if (a.isTail !== b.isTail) return a.isTail ? -1 : 1
      return b.end - a.end
    })

  for (const c of scored) {
    const edgeId = store.addEdge(c.n.id, 'flow-out', nodeId, 'flow-in', 'flow')
    if (edgeId) return edgeId // addEdge validates; try the next candidate on rejection
  }
  return null
}
