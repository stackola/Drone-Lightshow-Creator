// Shared test utilities for building test graphs

import type { ShowGraph, ShowEdge, AllocationMode, TransitionConfig, LaunchNode, FormationNode, IdleNode, LandNode, GroupNode } from './types'

let _nextId = 1
export function resetIdCounter() {
  _nextId = 1
}
export function nextId(prefix = 'node'): string {
  return `${prefix}-${_nextId++}`
}

export function makeLaunchNode(overrides: Partial<LaunchNode> & { id: string }): LaunchNode {
  return {
    type: 'launch',
    position: { x: 0, y: 0 },
    parentId: null,
    data: {
      droneCount: 100,
      startTime: 0,
      staggerDelay: 0.02,
    },
    ...overrides,
  } as LaunchNode
}

export function makeFormationNode(overrides: Partial<FormationNode> & { id: string }): FormationNode {
  return {
    type: 'formation',
    position: { x: 200, y: 0 },
    parentId: null,
    data: {
      formationId: null,
      startTime: 3,
      duration: 5,
      transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [],
      colorProgramId: null,
      idleConfigs: [],
    },
    ...overrides,
  } as FormationNode
}

export function makeIdleNode(overrides: Partial<IdleNode> & { id: string }): IdleNode {
  return {
    type: 'idle',
    position: { x: 200, y: 100 },
    parentId: null,
    data: {
      behavior: 'hover' as const,
      center: { x: 0, y: 0, z: 0 },
      radius: 5,
      speed: 1,
      altitude: 10,
      startTime: 3,
      duration: 5,
      colorProgramId: null,
    },
    ...overrides,
  } as IdleNode
}

export function makeLandNode(overrides: Partial<LandNode> & { id: string }): LandNode {
  return {
    type: 'land',
    position: { x: 600, y: 0 },
    parentId: null,
    data: {
      staggerDelay: 0.02,
    },
    ...overrides,
  } as LandNode
}

export function makeGroupNode(overrides: Partial<GroupNode> & { id: string }): GroupNode {
  return {
    type: 'group',
    position: { x: 0, y: 0 },
    parentId: null,
    data: {
      label: 'Group',
      color: '#3b82f6',
      collapsed: false,
      showInternalEdges: true,
    },
    ...overrides,
  } as GroupNode
}

export const DEFAULT_TRANSITION: TransitionConfig = {
  strategyId: 'shortest-path',
  parameters: {},
  preferredDuration: 2,
  pushPolicy: 'auto',
  locked: false,
}

export function makeFlowEdge(
  id: string,
  source: string,
  target: string,
  allocation: AllocationMode = { mode: 'auto' },
  sourcePort = 'flow-out',
  targetPort = 'flow-in',
  // Pass `null` to explicitly omit the transition (mirrors pre-default behaviour).
  // Pass `undefined` (or omit) to get the default 2s transition.
  transition: TransitionConfig | null | undefined = { ...DEFAULT_TRANSITION },
): ShowEdge {
  return {
    id,
    edgeType: 'flow',
    source,
    sourcePort,
    target,
    targetPort,
    droneCount: 0,
    allocation,
    ...(transition ? { transition } : {}),
  }
}

export function makeAttachmentEdge(
  id: string,
  source: string,
  target: string,
): ShowEdge {
  return {
    id,
    edgeType: 'attachment',
    source,
    sourcePort: 'attach-out',
    target,
    targetPort: 'idle-attach',
    droneCount: 0,
    allocation: { mode: 'auto' },
  }
}

/**
 * Build a simple linear demo graph:
 * Launch → Formation1 → Formation2 → Land
 * Each flow edge carries a default transition (shortest-path · 2s).
 */
export function makeLinearDemoGraph(): ShowGraph {
  return {
    nodes: [
      makeLaunchNode({ id: 'launch-1' }),
      makeFormationNode({ id: 'form-1', data: { formationId: 'ring-1', startTime: 5, duration: 5, transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      makeFormationNode({ id: 'form-2', data: { formationId: 'grid-1', startTime: 12, duration: 5, transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      makeLandNode({ id: 'land-1' }),
    ],
    edges: [
      makeFlowEdge('e0', 'launch-1', 'form-1'),
      makeFlowEdge('e1', 'form-1', 'form-2'),
      makeFlowEdge('e2', 'form-2', 'land-1'),
    ],
  }
}
