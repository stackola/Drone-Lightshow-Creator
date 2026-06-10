// ============================================================================
// trackDerivation — assign every timed node to a timeline track by walking
// the flow topology. A track is a chain through flow edges: the first
// outgoing edge continues the current track; additional outgoing edges
// (splits) spawn new tracks; merge targets stay with whichever track claimed
// them first. Unwired timed nodes collect into a trailing "Unwired" track.
// Pure — consumed by the shell's TimelineDock.
// ============================================================================

import { buildGraphIndex } from '../../graph/graphIndex'
import type { ShowGraph, ShowNode } from '../../graph/types'

export interface TimelineTrack {
  id: string
  /** 'flow' tracks come from chains; 'unwired' collects orphans. */
  kind: 'flow' | 'unwired'
  /** Node ids in flow order (chains) or time order (unwired). */
  nodeIds: string[]
}

function nodeStart(node: ShowNode | undefined): number {
  const data = node?.data as { startTime?: number } | undefined
  return data?.startTime ?? 0
}

/** Timed node types that belong on the timeline. */
function isTimed(node: ShowNode): boolean {
  return node.type === 'launch' || node.type === 'formation' || node.type === 'idle' || node.type === 'land'
}

export function deriveTracks(graph: ShowGraph): TimelineTrack[] {
  const index = buildGraphIndex(graph)
  const assigned = new Set<string>()
  const tracks: TimelineTrack[] = []

  // Roots: timed nodes with no incoming flow edge that DO participate in
  // the flow (outgoing edges), earliest first so the primary chain
  // (launch → …) becomes track 1. Fully unconnected nodes are "unwired".
  const roots = graph.nodes
    .filter(
      (n) =>
        isTimed(n) &&
        (index.flowReverseAdjacency.get(n.id) ?? []).length === 0 &&
        (index.flowAdjacency.get(n.id) ?? []).length > 0,
    )
    .sort((a, b) => nodeStart(a) - nodeStart(b))

  // Splits discovered while walking — start new tracks from these targets.
  const pendingStarts: string[] = []

  const walkChain = (startId: string) => {
    if (assigned.has(startId)) return
    const nodeIds: string[] = []
    let current: string | undefined = startId
    while (current && !assigned.has(current)) {
      assigned.add(current)
      nodeIds.push(current)
      const targets: string[] = index.flowAdjacency.get(current) ?? []
      // First target continues this track; the rest spawn new tracks.
      for (let i = 1; i < targets.length; i++) {
        const t = targets[i]!
        if (!assigned.has(t)) pendingStarts.push(t)
      }
      current = targets[0]
    }
    if (nodeIds.length > 0) {
      tracks.push({ id: `track-${tracks.length}`, kind: 'flow', nodeIds })
    }
  }

  for (const root of roots) {
    walkChain(root.id)
    while (pendingStarts.length > 0) walkChain(pendingStarts.shift()!)
  }
  // Cycles or chains only reachable mid-graph (shouldn't happen, but be safe).
  for (const n of graph.nodes) {
    if (isTimed(n) && !assigned.has(n.id)) {
      const hasFlow =
        (index.flowAdjacency.get(n.id) ?? []).length > 0 ||
        (index.flowReverseAdjacency.get(n.id) ?? []).length > 0
      if (hasFlow) {
        walkChain(n.id)
        while (pendingStarts.length > 0) walkChain(pendingStarts.shift()!)
      }
    }
  }

  // Orphans (no flow edges at all) — one shared track, time-ordered.
  const orphans = graph.nodes
    .filter((n) => isTimed(n) && !assigned.has(n.id))
    .sort((a, b) => nodeStart(a) - nodeStart(b))
  if (orphans.length > 0) {
    tracks.push({ id: 'track-unwired', kind: 'unwired', nodeIds: orphans.map((n) => n.id) })
  }

  return tracks
}
