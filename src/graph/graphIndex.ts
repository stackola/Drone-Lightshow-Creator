// ============================================================================
// GraphIndex — O(1) Lookups for Graph Traversal
// ============================================================================
// Build once at the start of any graph-wide operation (evaluate, timing,
// flow, topology, validation). Pass through instead of raw ShowGraph.
//
// Eliminates O(n) linear scans that appear 30+ times across the codebase.
// Also provides the shared flow adjacency structure that topology functions
// previously rebuilt independently (#11).
// ============================================================================

import type { ShowGraph, ShowNode, ShowEdge } from './types'

export interface GraphIndex {
  graph: ShowGraph
  nodeById: Map<string, ShowNode>
  edgeById: Map<string, ShowEdge>
  outEdges: Map<string, ShowEdge[]>
  inEdges: Map<string, ShowEdge[]>
  flowOutEdges: Map<string, ShowEdge[]>
  flowInEdges: Map<string, ShowEdge[]>
  /** Flow-only forward adjacency (nodeId → target nodeIds) */
  flowAdjacency: Map<string, string[]>
  /** Flow-only reverse adjacency (nodeId → source nodeIds) */
  flowReverseAdjacency: Map<string, string[]>
}

export function buildGraphIndex(graph: ShowGraph): GraphIndex {
  const nodeById = new Map<string, ShowNode>()
  const edgeById = new Map<string, ShowEdge>()
  const outEdges = new Map<string, ShowEdge[]>()
  const inEdges = new Map<string, ShowEdge[]>()
  const flowOutEdges = new Map<string, ShowEdge[]>()
  const flowInEdges = new Map<string, ShowEdge[]>()
  const flowAdjacency = new Map<string, string[]>()
  const flowReverseAdjacency = new Map<string, string[]>()

  for (const node of graph.nodes) {
    nodeById.set(node.id, node)
    outEdges.set(node.id, [])
    inEdges.set(node.id, [])
    flowOutEdges.set(node.id, [])
    flowInEdges.set(node.id, [])
    flowAdjacency.set(node.id, [])
    flowReverseAdjacency.set(node.id, [])
  }

  for (const edge of graph.edges) {
    edgeById.set(edge.id, edge)
    outEdges.get(edge.source)?.push(edge)
    inEdges.get(edge.target)?.push(edge)
    if (edge.edgeType === 'flow') {
      flowOutEdges.get(edge.source)?.push(edge)
      flowInEdges.get(edge.target)?.push(edge)
      flowAdjacency.get(edge.source)?.push(edge.target)
      flowReverseAdjacency.get(edge.target)?.push(edge.source)
    }
  }

  return {
    graph,
    nodeById,
    edgeById,
    outEdges,
    inEdges,
    flowOutEdges,
    flowInEdges,
    flowAdjacency,
    flowReverseAdjacency,
  }
}
