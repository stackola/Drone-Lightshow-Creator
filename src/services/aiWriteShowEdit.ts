// ============================================================================
// AI Write Tools — Show-Edit Domain (7 tools)
// Extracted from `aiWriteTools.ts` (2026-05-21) as wave 3 of the god-module split.
// Side-effect import — registers tools at module load.
// ============================================================================

import { useGraphStore } from '../stores/graphStore'
import { registerTool } from './aiToolEngine'
import { mergeVec3 } from './aiWriteShared'
import type { FormationNodeData, IdleBehavior } from '../graph/types'
import type { EasingType } from '../graph/easing'

// ── update_node_timing ──────────────────────────────────────────────────────

registerTool({
  name: 'update_node_timing',
  description: 'Update timing (startTime and/or duration) on a launch, formation, or idle node.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node ID' },
      startTime: { type: 'number', description: 'New start time in seconds' },
      duration: { type: 'number', description: 'New duration in seconds (formation/idle only)' },
    },
    required: ['nodeId'],
  },
  isWriteTool: true,
  execute: (params) => {
    const node = useGraphStore.getState().getNode(params.nodeId as string)
    if (!node) return { success: false, error: `Node not found: ${params.nodeId}` }
    const patch: Record<string, unknown> = {}
    if (params.startTime !== undefined) patch.startTime = Math.max(0, params.startTime as number)
    if (params.duration !== undefined) patch.duration = Math.max(0.1, params.duration as number)
    useGraphStore.getState().updateNodeData(params.nodeId as string, patch)
    return { success: true, data: { nodeId: params.nodeId, updated: Object.keys(patch) } }
  },
})

// ── update_node_transform ───────────────────────────────────────────────────

registerTool({
  name: 'update_node_transform',
  description: 'Update the base 3D transform (position, rotation, scale) on a formation node.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Formation node ID' },
      position: { type: 'object', description: '{x, y, z} in meters', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
      rotation: { type: 'object', description: '{x, y, z} in radians', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
      scale: { type: 'object', description: '{x, y, z} multipliers', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
    },
    required: ['nodeId'],
  },
  isWriteTool: true,
  execute: (params) => {
    const node = useGraphStore.getState().getNode(params.nodeId as string)
    if (!node || node.type !== 'formation') return { success: false, error: 'Node not found or not a formation node' }
    const data = node.data as FormationNodeData
    const newTransform = {
      position: mergeVec3(data.transform.position, params.position as Record<string, unknown> | undefined),
      rotation: mergeVec3(data.transform.rotation, params.rotation as Record<string, unknown> | undefined),
      scale: mergeVec3(data.transform.scale, params.scale as Record<string, unknown> | undefined),
    }
    useGraphStore.getState().updateNodeData(params.nodeId as string, { transform: newTransform })
    return { success: true, data: { nodeId: params.nodeId, transform: newTransform } }
  },
})

// ── add_keyframe ────────────────────────────────────────────────────────────

registerTool({
  name: 'add_keyframe',
  description: 'Add an animation keyframe to a formation node. Keyframes animate position, rotation, and scale over the formation\'s duration.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Formation node ID' },
      time: { type: 'number', description: 'Time within the formation duration (0 to duration)' },
      position: { type: 'object', description: '{x, y, z} target position', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
      rotation: { type: 'object', description: '{x, y, z} target rotation in radians', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
      scale: { type: 'object', description: '{x, y, z} target scale', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
      easing: { type: 'string', description: 'Easing function (default ease-in-out)' },
    },
    required: ['nodeId', 'time'],
  },
  isWriteTool: true,
  execute: (params) => {
    const node = useGraphStore.getState().getNode(params.nodeId as string)
    if (!node || node.type !== 'formation') return { success: false, error: 'Node not found or not a formation node' }
    const data = node.data as FormationNodeData
    const transform = {
      position: mergeVec3(data.transform.position, params.position as Record<string, unknown> | undefined),
      rotation: mergeVec3(data.transform.rotation, params.rotation as Record<string, unknown> | undefined),
      scale: mergeVec3(data.transform.scale, params.scale as Record<string, unknown> | undefined),
    }
    const easing = ((params.easing as string) ?? 'ease-in-out') as EasingType
    useGraphStore.getState().addKeyframe(params.nodeId as string, params.time as number, transform, easing)
    return { success: true, data: { nodeId: params.nodeId, keyframeTime: params.time } }
  },
})

// ── remove_keyframe ─────────────────────────────────────────────────────────

registerTool({
  name: 'remove_keyframe',
  description: 'Remove a keyframe from a formation node by index.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Formation node ID' },
      keyframeIndex: { type: 'number', description: 'Index of keyframe to remove (0-based)' },
    },
    required: ['nodeId', 'keyframeIndex'],
  },
  isWriteTool: true,
  execute: (params) => {
    useGraphStore.getState().removeKeyframe(params.nodeId as string, params.keyframeIndex as number)
    return { success: true, data: { nodeId: params.nodeId, removedIndex: params.keyframeIndex } }
  },
})

// ── set_color_program ───────────────────────────────────────────────────────

registerTool({
  name: 'set_color_program',
  description: 'Assign a color program to a formation or idle node. Use get_available_color_programs to see options.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Formation or idle node ID' },
      colorProgramId: { type: 'string', description: 'Color program ID (e.g., "rainbow", "solid-red", "pulse-white"). Use null or empty string to clear.' },
    },
    required: ['nodeId', 'colorProgramId'],
  },
  isWriteTool: true,
  execute: (params) => {
    const cpId = params.colorProgramId as string
    useGraphStore.getState().updateNodeData(params.nodeId as string, { colorProgramId: cpId || null })
    return { success: true, data: { nodeId: params.nodeId, colorProgramId: cpId || null } }
  },
})

// ── set_transition_strategy ─────────────────────────────────────────────────

registerTool({
  name: 'set_transition_strategy',
  description: 'Change the strategy and parameters on a transition node.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Transition node ID' },
      strategyId: { type: 'string', description: 'New strategy: shortest-path, ant-walk, stagger, spiral, explosion, implosion, cascade, morph, color-sweep, bounce' },
      parameters: { type: 'object', description: 'Strategy-specific parameters (optional)' },
    },
    required: ['nodeId', 'strategyId'],
  },
  isWriteTool: true,
  execute: (params) => {
    const patch: Record<string, unknown> = { strategyId: params.strategyId }
    if (params.parameters) patch.parameters = params.parameters
    else patch.parameters = {}
    useGraphStore.getState().updateNodeData(params.nodeId as string, patch)
    return { success: true, data: { nodeId: params.nodeId, strategyId: params.strategyId } }
  },
})

// ── add_attached_idle ───────────────────────────────────────────────────────

registerTool({
  name: 'add_attached_idle',
  description: 'Add an idle behavior to leftover drones in a formation (drones that exceed the formation point count).',
  inputSchema: {
    type: 'object',
    properties: {
      formationNodeId: { type: 'string', description: 'Formation node ID to attach idle to' },
      behavior: { type: 'string', description: 'hover, orbit, figure8, breathe, swarm, sparkle, pulse, wave, spin, drift' },
      radius: { type: 'number', description: 'Behavior radius (default 5)' },
      speed: { type: 'number', description: 'Animation speed (default 1)' },
      altitude: { type: 'number', description: 'Altitude (default 10)' },
      colorProgramId: { type: 'string', description: 'Color program (optional)' },
    },
    required: ['formationNodeId', 'behavior'],
  },
  isWriteTool: true,
  execute: (params) => {
    const idleId = useGraphStore.getState().addAttachedIdle(params.formationNodeId as string, {
      behavior: params.behavior as IdleBehavior,
      radius: (params.radius as number) ?? 5,
      speed: (params.speed as number) ?? 1,
      altitude: (params.altitude as number) ?? 10,
      colorProgramId: (params.colorProgramId as string) ?? null,
    })
    return { success: true, data: { idleConfigId: idleId, formationNodeId: params.formationNodeId } }
  },
})
