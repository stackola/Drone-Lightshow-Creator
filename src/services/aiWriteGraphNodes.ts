// ============================================================================
// AI Write Tools — Graph-Node Domain (8 tools)
// Extracted from `aiWriteTools.ts` (2026-05-21) as wave 2 of the god-module split.
// Side-effect import — registers tools at module load.
// ============================================================================

import { useGraphStore } from '../stores/graphStore'
import { useViewStore } from '../stores/viewStore'
import { registerTool } from './aiToolEngine'
import type {
  LaunchNodeData,
  FormationNodeData,
  IdleNodeData,
  LandNodeData,
  IdleBehavior,
} from '../graph/types'

// ── add_launch_node ─────────────────────────────────────────────────────────

registerTool({
  name: 'add_launch_node',
  description: 'Add a launch node that sends drones into the air.',
  inputSchema: {
    type: 'object',
    properties: {
      droneCount: { type: 'number', description: 'Number of drones to launch' },
      startTime: { type: 'number', description: 'Start time in seconds (default 0)' },
      staggerDelay: { type: 'number', description: 'Delay between each drone launch in seconds (default 0.02)' },
      positionX: { type: 'number', description: 'Canvas X position (optional, auto-computed from startTime)' },
      positionY: { type: 'number', description: 'Canvas Y position (default 150)' },
    },
    required: ['droneCount'],
  },
  isWriteTool: true,
  execute: (params) => {
    const startTime = (params.startTime as number) ?? 0
    const pxPerSecond = useViewStore.getState().pxPerSecond
    const pos = { x: params.positionX != null ? params.positionX as number : startTime * pxPerSecond, y: (params.positionY as number) ?? 150 }
    const nodeId = useGraphStore.getState().addNode('launch', pos, {
      droneCount: params.droneCount as number,
      startTime,
      staggerDelay: (params.staggerDelay as number) ?? 0.02,
    } as LaunchNodeData)
    return { success: true, data: { nodeId } }
  },
})

// ── add_formation_node ──────────────────────────────────────────────────────

registerTool({
  name: 'add_formation_node',
  description: 'Add a formation node that positions drones in a shape. Requires a formationId created via create_formation.',
  inputSchema: {
    type: 'object',
    properties: {
      formationId: { type: 'string', description: 'ID of the formation definition to use' },
      startTime: { type: 'number', description: 'Start time in seconds' },
      duration: { type: 'number', description: 'Duration in seconds' },
      altitude: { type: 'number', description: 'Y position in meters (default 15)' },
      positionX: { type: 'number', description: 'World X offset (default 0)' },
      positionZ: { type: 'number', description: 'World Z offset (default 0)' },
      colorProgramId: { type: 'string', description: 'Color program ID (optional)' },
      canvasX: { type: 'number', description: 'Canvas X position (optional)' },
      canvasY: { type: 'number', description: 'Canvas Y position (default 150)' },
    },
    required: ['formationId', 'startTime', 'duration'],
  },
  isWriteTool: true,
  execute: (params) => {
    const startTime = params.startTime as number
    const pxPerSecond = 30
    const canvasPos = {
      x: params.canvasX != null ? params.canvasX as number : startTime * pxPerSecond,
      y: (params.canvasY as number) ?? 150,
    }
    const transform = {
      position: { x: (params.positionX as number) ?? 0, y: (params.altitude as number) ?? 15, z: (params.positionZ as number) ?? 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }
    const nodeId = useGraphStore.getState().addNode('formation', canvasPos, {
      formationId: params.formationId as string,
      startTime,
      duration: params.duration as number,
      transform,
      keyframes: [],
      colorProgramId: (params.colorProgramId as string) ?? null,
      idleConfigs: [],
    } as FormationNodeData)
    return { success: true, data: { nodeId } }
  },
})

// ── set_edge_transition ─────────────────────────────────────────────────────

registerTool({
  name: 'set_edge_transition',
  description: 'Configure the transition on a flow edge. Replaces the old add_transition_node tool — transitions are now properties on flow edges between timed nodes.',
  inputSchema: {
    type: 'object',
    properties: {
      edgeId: { type: 'string', description: 'ID of the flow edge to configure' },
      strategyId: { type: 'string', description: 'Transition strategy: shortest-path, ant-walk, stagger, spiral, explosion, implosion, cascade, morph, color-sweep, bounce' },
      duration: { type: 'number', description: 'preferredDuration in seconds' },
      parameters: { type: 'object', description: 'Strategy-specific params (optional)' },
    },
    required: ['edgeId'],
  },
  isWriteTool: true,
  execute: (params) => {
    const patch: Record<string, unknown> = {}
    if (params.strategyId) patch.strategyId = params.strategyId
    if (params.duration != null) patch.preferredDuration = params.duration
    if (params.parameters) patch.parameters = params.parameters
    useGraphStore.getState().updateEdgeTransition(params.edgeId as string, patch)
    return { success: true, data: { edgeId: params.edgeId } }
  },
})

// ── add_idle_node ───────────────────────────────────────────────────────────

registerTool({
  name: 'add_idle_node',
  description: 'Add a standalone idle node where drones perform ambient behaviors (orbit, sparkle, wave, etc.).',
  inputSchema: {
    type: 'object',
    properties: {
      behavior: { type: 'string', description: 'hover, orbit, figure8, breathe, swarm, sparkle, pulse, wave, spin, drift' },
      radius: { type: 'number', description: 'Behavior radius in meters (default 5)' },
      speed: { type: 'number', description: 'Animation speed (default 1)' },
      altitude: { type: 'number', description: 'Altitude in meters (default 15)' },
      startTime: { type: 'number', description: 'Start time in seconds' },
      duration: { type: 'number', description: 'Duration in seconds' },
      centerX: { type: 'number', description: 'Center X (default 0)' },
      centerZ: { type: 'number', description: 'Center Z (default 0)' },
    },
    required: ['behavior', 'startTime', 'duration'],
  },
  isWriteTool: true,
  execute: (params) => {
    const startTime = params.startTime as number
    const pos = { x: startTime * 30, y: 150 }
    const nodeId = useGraphStore.getState().addNode('idle', pos, {
      behavior: params.behavior as IdleBehavior,
      center: { x: (params.centerX as number) ?? 0, y: 0, z: (params.centerZ as number) ?? 0 },
      radius: (params.radius as number) ?? 5,
      speed: (params.speed as number) ?? 1,
      altitude: (params.altitude as number) ?? 15,
      startTime,
      duration: params.duration as number,
      colorProgramId: null,
    } as IdleNodeData)
    return { success: true, data: { nodeId } }
  },
})

// ── add_land_node ───────────────────────────────────────────────────────────

registerTool({
  name: 'add_land_node',
  description: 'Add a land node that brings drones back to the ground.',
  inputSchema: {
    type: 'object',
    properties: {
      staggerDelay: { type: 'number', description: 'Delay between each drone landing (default 0.02)' },
      canvasX: { type: 'number', description: 'Canvas X position (optional)' },
      canvasY: { type: 'number', description: 'Canvas Y position (default 150)' },
    },
    required: [],
  },
  isWriteTool: true,
  execute: (params) => {
    const pos = { x: (params.canvasX as number) ?? 900, y: (params.canvasY as number) ?? 150 }
    const nodeId = useGraphStore.getState().addNode('land', pos, {
      staggerDelay: (params.staggerDelay as number) ?? 0.02,
    } as LandNodeData)
    return { success: true, data: { nodeId } }
  },
})

// ── connect_nodes ───────────────────────────────────────────────────────────

registerTool({
  name: 'connect_nodes',
  description: 'Connect two nodes with a flow edge. The source\'s output port connects to the target\'s input port.',
  inputSchema: {
    type: 'object',
    properties: {
      sourceId: { type: 'string', description: 'Source node ID' },
      targetId: { type: 'string', description: 'Target node ID' },
      edgeType: { type: 'string', description: 'flow (default) or attachment', enum: ['flow', 'attachment'] },
    },
    required: ['sourceId', 'targetId'],
  },
  isWriteTool: true,
  execute: (params) => {
    const edgeType = ((params.edgeType as string) ?? 'flow') as 'flow' | 'attachment'
    const sourcePort = edgeType === 'flow' ? 'flow-out' : 'flow-out'
    const targetPort = edgeType === 'flow' ? 'flow-in' : 'idle-attach'
    const edgeId = useGraphStore.getState().addEdge(
      params.sourceId as string, sourcePort,
      params.targetId as string, targetPort,
      edgeType,
    )
    if (!edgeId) return { success: false, error: 'Invalid connection — check node types and ports' }
    return { success: true, data: { edgeId } }
  },
})

// ── remove_node ─────────────────────────────────────────────────────────────

registerTool({
  name: 'remove_node',
  description: 'Remove a node and all its connected edges.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node ID to remove' },
    },
    required: ['nodeId'],
  },
  isWriteTool: true,
  execute: (params) => {
    const id = params.nodeId as string
    if (!useGraphStore.getState().getNode(id)) return { success: false, error: `Node not found: ${id}` }
    useGraphStore.getState().removeNode(id)
    return { success: true, data: { removed: id } }
  },
})

// ── remove_edge ─────────────────────────────────────────────────────────────

registerTool({
  name: 'remove_edge',
  description: 'Remove an edge between two nodes.',
  inputSchema: {
    type: 'object',
    properties: {
      edgeId: { type: 'string', description: 'Edge ID to remove' },
    },
    required: ['edgeId'],
  },
  isWriteTool: true,
  execute: (params) => {
    useGraphStore.getState().removeEdge(params.edgeId as string)
    return { success: true, data: { removed: params.edgeId } }
  },
})
