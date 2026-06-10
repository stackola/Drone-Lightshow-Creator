// ============================================================================
// AI Write Tools — Physics & Show-Admin Domain (6 tools)
// Extracted from `aiWriteTools.ts` (2026-05-21) as wave 4a of the god-module split.
// Side-effect import — registers tools at module load.
// ============================================================================

import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { registerTool } from './aiToolEngine'
import { computeAutoTiming } from '../graph/autoFix'
import { validateShowPhysics } from '../graph/physicsValidator'

// ── fix_all_violations ──────────────────────────────────────────────────────

registerTool({
  name: 'fix_all_violations',
  description: 'Automatically fix all physics violations using recommended (minimal impact) fixes. Always call this after building or modifying a show.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: true,
  execute: () => {
    const { constraints, dronePool } = useProjectStore.getState()
    const { generatedPoints } = useFormationStore.getState()

    const initialViolations = validateShowPhysics(
      { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges },
      constraints, generatedPoints, dronePool.homePositions,
    )
    if (initialViolations.length === 0) return { success: true, data: { fixedCount: 0, remainingCount: 0 } }

    // Iterative fix loop — re-read state after each pass, up to 5 rounds
    let prevCount = initialViolations.length
    for (let round = 0; round < 5; round++) {
      const graph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
      const violations = validateShowPhysics(graph, constraints, generatedPoints, dronePool.homePositions)
      if (violations.length === 0) break

      // Auto-timing first (adjusts edge transition durations to meet physics)
      const timingPatches = computeAutoTiming(graph, constraints, generatedPoints)
      for (const patch of timingPatches) {
        if (patch.edgeId) {
          useGraphStore.getState().updateEdgeTransition(patch.edgeId, patch.patch as Record<string, unknown>)
        } else if (patch.nodeId) {
          useGraphStore.getState().updateNodeData(patch.nodeId, patch.patch as Record<string, unknown>)
        }
      }

      // Re-read graph after timing changes, then apply standard fixes
      const graph2 = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
      const violations2 = validateShowPhysics(graph2, constraints, generatedPoints, dronePool.homePositions)
      const fixable = violations2.filter((v) => v.fix)
      if (fixable.length > 0) {
        useGraphStore.getState().applyViolationFixes(
          fixable.map((v) => ({ type: v.fix!.type, nodeId: v.fix!.nodeId, edgeId: v.fix!.edgeId, delta: v.fix!.delta })),
        )
      }

      // Stop if no progress was made (avoid infinite loop)
      const remaining = validateShowPhysics(
        { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges },
        constraints, generatedPoints, dronePool.homePositions,
      )
      if (remaining.length >= prevCount) break
      prevCount = remaining.length
      if (remaining.length === 0) break
    }

    const finalRemaining = validateShowPhysics(
      { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges },
      constraints, generatedPoints, dronePool.homePositions,
    )
    return { success: true, data: { fixedCount: initialViolations.length - finalRemaining.length, remainingCount: finalRemaining.length } }
  },
})

// ── auto_time_show ──────────────────────────────────────────────────────────

registerTool({
  name: 'auto_time_show',
  description: 'Automatically compute optimal transition durations based on physics constraints and distances.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: true,
  execute: () => {
    const { nodes, edges } = useGraphStore.getState()
    const { constraints } = useProjectStore.getState()
    const { generatedPoints } = useFormationStore.getState()
    const patches = computeAutoTiming({ nodes, edges }, constraints, generatedPoints)
    for (const patch of patches) {
      if (patch.edgeId) {
        useGraphStore.getState().updateEdgeTransition(patch.edgeId, patch.patch as Record<string, unknown>)
      } else if (patch.nodeId) {
        useGraphStore.getState().updateNodeData(patch.nodeId, patch.patch as Record<string, unknown>)
      }
    }
    return { success: true, data: { adjustedNodeCount: patches.length } }
  },
})

// ── push_timing ─────────────────────────────────────────────────────────────

registerTool({
  name: 'push_timing',
  description: 'Shift all downstream nodes later by a given number of seconds. Useful to make room for a longer transition.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node ID to push from' },
      deltaSeconds: { type: 'number', description: 'Seconds to push downstream (positive = later)' },
    },
    required: ['nodeId', 'deltaSeconds'],
  },
  isWriteTool: true,
  execute: (params) => {
    useGraphStore.getState().pushDownstreamTiming(params.nodeId as string, params.deltaSeconds as number)
    return { success: true, data: { nodeId: params.nodeId, delta: params.deltaSeconds } }
  },
})

// ── set_drone_count ─────────────────────────────────────────────────────────

registerTool({
  name: 'set_drone_count',
  description: 'Change the total number of drones in the show. Regenerates home positions.',
  inputSchema: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'New drone count (1 to 10000)' },
    },
    required: ['count'],
  },
  isWriteTool: true,
  execute: (params) => {
    useProjectStore.getState().setDroneCount(params.count as number)
    const pool = useProjectStore.getState().dronePool
    return { success: true, data: { droneCount: pool.droneCount, homePositionCount: pool.homePositions.length } }
  },
})

// ── update_constraints ──────────────────────────────────────────────────────

registerTool({
  name: 'update_constraints',
  description: 'Update physics constraints (velocity, acceleration, spacing, altitude, geofence, wind, etc.).',
  inputSchema: {
    type: 'object',
    properties: {
      maxVelocity: { type: 'number', description: 'Max velocity m/s' },
      maxAcceleration: { type: 'number', description: 'Max acceleration m/s²' },
      minDroneDistance: { type: 'number', description: 'Min distance between drones in meters' },
      altitudeMin: { type: 'number', description: 'Min altitude meters' },
      altitudeMax: { type: 'number', description: 'Max altitude meters' },
      geofenceRadius: { type: 'number', description: 'Geofence radius meters' },
      maxFlightTime: { type: 'number', description: 'Max flight time seconds' },
      windSpeed: { type: 'number', description: 'Wind speed m/s' },
    },
    required: [],
  },
  isWriteTool: true,
  execute: (params) => {
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) patch[key] = value
    }
    useProjectStore.getState().updateConstraints(patch as Partial<import('../stores/projectStore').Constraints>)
    return { success: true, data: useProjectStore.getState().constraints }
  },
})

// ── clear_graph ─────────────────────────────────────────────────────────────

registerTool({
  name: 'clear_graph',
  description: 'Clear the entire show — remove all nodes, edges, and formations. Start fresh.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: true,
  execute: () => {
    useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
    useFormationStore.getState().loadFormations([], new Map())
    return { success: true, data: { cleared: true } }
  },
})
