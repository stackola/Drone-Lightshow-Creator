// ============================================================================
// G-02: Time Authority Rule
// ============================================================================
// ARCHITECTURAL LAW: Domain time fields in node.data are authoritative.
// Canvas X is a projection derived from domain time. position.x is NEVER
// read to determine when something happens.
//
// The drag contract:
// 1. React Flow reports new position.x via onNodesChange
// 2. Handler calls deriveTimeFromCanvasX(newX) to compute new startTime
// 3. Handler calls graphStore.updateNodeData(id, { startTime }) — authoritative mutation
// 4. On next render, deriveCanvasX(data.startTime) re-derives position for React Flow
// 5. position.x in the store is updated to match, but is NEVER read to determine time
// ============================================================================

import type { ShowNode, LaunchNodeData, FormationNodeData, IdleNodeData } from './types'

export interface NodeTimeRange {
  start: number
  end: number
}

/**
 * Get the time range for a node, reading EXCLUSIVELY from node.data fields.
 * Returns null for nodes without explicit time (transitions, land, groups).
 */
export function getNodeTimeRange(node: ShowNode): NodeTimeRange | null {
  switch (node.type) {
    case 'launch': {
      const data = node.data as LaunchNodeData
      return { start: data.startTime, end: data.startTime + data.droneCount * data.staggerDelay }
    }
    case 'formation': {
      const data = node.data as FormationNodeData
      return { start: data.startTime, end: data.startTime + data.duration }
    }
    case 'idle': {
      const data = node.data as IdleNodeData
      return { start: data.startTime, end: data.startTime + data.duration }
    }
    default:
      return null
  }
}

/**
 * Return an updated node with new startTime in data. Does NOT touch position.
 */
export function setNodeTime(node: ShowNode, startTime: number): ShowNode {
  switch (node.type) {
    case 'launch':
      return { ...node, data: { ...(node.data as LaunchNodeData), startTime } }
    case 'formation':
      return { ...node, data: { ...(node.data as FormationNodeData), startTime } }
    case 'idle':
      return { ...node, data: { ...(node.data as IdleNodeData), startTime } }
    default:
      return node
  }
}

/**
 * Pure function: the ONLY way to derive canvas X from domain time.
 */
export function deriveCanvasX(startTime: number, pxPerSecond: number): number {
  return startTime * pxPerSecond
}

/**
 * Pure function: the ONLY way to derive domain time from canvas X.
 */
export function deriveTimeFromCanvasX(canvasX: number, pxPerSecond: number): number {
  return canvasX / pxPerSecond
}
