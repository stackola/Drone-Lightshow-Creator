// ============================================================================
// Slice 2 Step 6: Auto-layout — time-ordered horizontal lanes.
// ============================================================================
// Walks topological order, assigns each node an x derived from its start time
// and a y based on a greedy first-fit lane assignment. Nodes whose time ranges
// overlap with an ancestor get their own lane; otherwise they reuse one.
// ============================================================================

import type { ShowGraph } from '../../graph/types'
import { computeAllTiming, type TimeRange } from '../../graph/timing'
import { topologicalSort } from '../../graph/topology'
import { buildGraphIndex } from '../../graph/graphIndex'

export interface LayoutPosition {
  id: string
  position: { x: number; y: number }
}

const LANE_HEIGHT = 120
const LEFT_PADDING_PX = 80
const TOP_PADDING_PX = 100

export function autoLayout(graph: ShowGraph, pxPerSecond: number): LayoutPosition[] {
  const idx = buildGraphIndex(graph)
  const timing = computeAllTiming(graph, idx)

  let sortedIds: string[]
  try {
    sortedIds = topologicalSort(graph, idx)
  } catch {
    return []
  }

  // Lane assignment via first-fit: a lane is "in use" until lastEnd.
  const laneLastEnd: number[] = []
  const assignedLane = new Map<string, number>()

  for (const nodeId of sortedIds) {
    const node = idx.nodeById.get(nodeId)
    if (!node || node.type === 'group') continue
    // A-15: respect groups. Nodes inside a group are positioned relative to
    // their parent (React Flow `parentId`); overwriting them with global
    // lane positions would yank them out of the group's visual bounds.
    if (node.parentId) continue
    const range = timing.get(nodeId)
    if (!range) continue

    let lane = -1
    for (let i = 0; i < laneLastEnd.length; i++) {
      if (laneLastEnd[i]! <= range.start + 1e-6) {
        lane = i
        break
      }
    }
    if (lane === -1) {
      lane = laneLastEnd.length
      laneLastEnd.push(0)
    }
    laneLastEnd[lane] = range.end
    assignedLane.set(nodeId, lane)
  }

  // Build positions. Center vertically around middle lane.
  const totalLanes = laneLastEnd.length
  const result: LayoutPosition[] = []
  for (const [nodeId, lane] of assignedLane) {
    const range = timing.get(nodeId) as TimeRange
    result.push({
      id: nodeId,
      position: {
        x: LEFT_PADDING_PX + range.start * pxPerSecond,
        y: TOP_PADDING_PX + (lane - (totalLanes - 1) / 2) * LANE_HEIGHT,
      },
    })
  }
  return result
}
