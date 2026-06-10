// ============================================================================
// Slice 3: shared seed primitives for demo show construction.
//
// Replaces hand-typed `store.addNode(...)` boilerplate that was duplicated
// across the old seed files. Each helper returns the new node id (or void)
// and snapshots history-friendly state.
// ============================================================================

import { useGraphStore } from '../../stores/graphStore'
import { useProjectStore } from '../../stores/projectStore'
import { useFormationStore } from '../../stores/formationStore'
import { getLibraryFormations } from '../../registries/formationLibrary'
import type {
  LaunchNodeData, FormationNodeData, IdleNodeData,
  LandNodeData, Transform3D, TransformKeyframe,
  AttachedIdleConfig, IdleBehavior, IdleInherit,
  TransitionConfig,
} from '../../graph/types'
import { DEFAULT_IDLE_INHERIT } from '../../graph/types'
import type { EasingType } from '../../graph/easing'

let X = 0
let Y = 150

/** Clear the graph + project meta, set drone count. Call this first in every demo seed. */
export function resetProject(name: string, droneCount: number): void {
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
  useProjectStore.getState().setDroneCount(droneCount)
  useProjectStore.getState().updateMeta({
    id: `demo-${Date.now()}`,
    name,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  })
  X = 0
  Y = 150
}

/** Step forward in canvas X for the next node. */
function nextX(): number {
  const x = X
  X += 220
  return x
}

export function addLaunch(droneCount: number, staggerDelay = 0.02, startTime = 0): string {
  return useGraphStore.getState().addNode('launch', { x: nextX(), y: Y }, {
    droneCount, startTime, staggerDelay,
  } as LaunchNodeData)
}

export function addLand(staggerDelay = 0.02): string {
  return useGraphStore.getState().addNode('land', { x: nextX(), y: Y }, {
    staggerDelay,
  } as LandNodeData)
}

const IDENTITY_TRANSFORM: Transform3D = {
  position: { x: 0, y: 14, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
}

export interface AddFormationOpts {
  label: string
  formationId: string
  startTime: number
  duration: number
  altitude?: number
  colorProgramId?: string | null
  keyframes?: TransformKeyframe[]
  idleConfigs?: AttachedIdleConfig[]
  transform?: Partial<Transform3D>
  staggerLock?: boolean
}

export function addFormation(opts: AddFormationOpts): string {
  const transform: Transform3D = {
    position: { ...IDENTITY_TRANSFORM.position, y: opts.altitude ?? 14, ...(opts.transform?.position ?? {}) },
    rotation: { ...IDENTITY_TRANSFORM.rotation, ...(opts.transform?.rotation ?? {}) },
    scale: { ...IDENTITY_TRANSFORM.scale, ...(opts.transform?.scale ?? {}) },
  }
  return useGraphStore.getState().addNode('formation', { x: nextX(), y: Y }, {
    formationId: opts.formationId,
    startTime: opts.startTime,
    duration: opts.duration,
    transform,
    keyframes: opts.keyframes ?? [],
    colorProgramId: opts.colorProgramId ?? null,
    idleConfigs: opts.idleConfigs ?? [],
    label: opts.label,
    ...(opts.staggerLock ? { staggerLock: true } : {}),
  } as FormationNodeData & { label: string })
}

export interface AddTransitionOpts {
  strategyId: string
  preferredDuration: number
  parameters?: Record<string, unknown>
}

/**
 * Build a TransitionConfig for use as the optional argument to wireFlow / addEdge.
 * Replaces the old `addTransition` helper that created a transition node.
 */
export function transitionConfig(opts: AddTransitionOpts): TransitionConfig {
  return {
    strategyId: opts.strategyId,
    parameters: opts.parameters ?? {},
    preferredDuration: opts.preferredDuration,
    pushPolicy: 'auto',
    locked: false,
  }
}

/** Wire two nodes with a specific transition config. */
export function wireFlow(source: string, target: string, transition?: AddTransitionOpts): void {
  useGraphStore.getState().addEdge(
    source, 'flow-out', target, 'flow-in', 'flow',
    undefined,
    transition ? transitionConfig(transition) : undefined,
  )
}

export interface AddIdleOpts {
  behavior: IdleBehavior
  startTime: number
  duration: number
  radius?: number
  speed?: number
  altitude?: number
  centerX?: number
  centerZ?: number
  colorProgramId?: string | null
}

export function addIdle(opts: AddIdleOpts): string {
  return useGraphStore.getState().addNode('idle', { x: nextX(), y: Y + 100 }, {
    behavior: opts.behavior,
    startTime: opts.startTime,
    duration: opts.duration,
    center: { x: opts.centerX ?? 0, y: 0, z: opts.centerZ ?? 0 },
    radius: opts.radius ?? 4,
    speed: opts.speed ?? 0.5,
    altitude: opts.altitude ?? 14,
    colorProgramId: opts.colorProgramId ?? null,
  } as IdleNodeData)
}

/** Wire a chain of nodes via flow edges in order: chain[i] → chain[i+1]. No transitions. */
export function linearWire(chain: string[]): void {
  const store = useGraphStore.getState()
  for (let i = 0; i < chain.length - 1; i++) {
    store.addEdge(chain[i]!, 'flow-out', chain[i + 1]!, 'flow-in', 'flow')
  }
}

/**
 * From `source`, split into N branches. Each branch may carry its own transition
 * config. Pass either a bare node id (no transition) or `[head, transitionOpts]`
 * to attach a transition config to that split edge.
 */
export function splitWire(
  source: string,
  branches: Array<string | [string, AddTransitionOpts]>,
): void {
  const store = useGraphStore.getState()
  for (const branch of branches) {
    const [head, tOpts] = Array.isArray(branch) ? branch : [branch, undefined]
    store.addEdge(
      source, 'flow-out', head, 'flow-in', 'flow',
      undefined,
      tOpts ? transitionConfig(tOpts) : undefined,
    )
  }
}

/**
 * Merge N branches into a single `target`. Each incoming edge may carry its own
 * transition config. Pass either a bare node id (no transition) or
 * `[tail, transitionOpts]` to attach a transition config to that merge edge.
 */
export function mergeWire(
  branchTails: Array<string | [string, AddTransitionOpts]>,
  target: string,
): void {
  const store = useGraphStore.getState()
  for (const tail of branchTails) {
    const [src, tOpts] = Array.isArray(tail) ? tail : [tail, undefined]
    store.addEdge(
      src, 'flow-out', target, 'flow-in', 'flow',
      undefined,
      tOpts ? transitionConfig(tOpts) : undefined,
    )
  }
}

/** Build an AttachedIdleConfig for a formation's idleConfigs. */
export function idleConfig(behavior: IdleBehavior, opts: {
  radius?: number
  speed?: number
  altitude?: number
  colorProgramId?: string | null
  inherit?: Partial<IdleInherit>
} = {}): AttachedIdleConfig {
  return {
    id: `idle-${Math.random().toString(36).slice(2, 9)}`,
    behavior,
    radius: opts.radius ?? 4,
    speed: opts.speed ?? 0.5,
    altitude: opts.altitude ?? 14,
    colorProgramId: opts.colorProgramId ?? null,
    inherit: { ...DEFAULT_IDLE_INHERIT, ...(opts.inherit ?? {}) },
  }
}

/** Build a TransformKeyframe shorthand. */
export function kf(
  time: number,
  position?: Partial<Transform3D['position']>,
  rotation?: Partial<Transform3D['rotation']>,
  scale?: Partial<Transform3D['scale']>,
  easing: EasingType = 'ease-in-out',
): TransformKeyframe {
  return {
    time,
    transform: {
      position: { x: 0, y: 0, z: 0, ...position },
      rotation: { x: 0, y: 0, z: 0, ...rotation },
      scale: { x: 1, y: 1, z: 1, ...scale },
    },
    easing,
  }
}

/** Quickly register a generated formation in the formation store, return its id. */
export function makeFormation(name: string, generatorId: string, params: Record<string, number>): string {
  return useFormationStore.getState().addFormation(name, generatorId, params)
}

/** Register an animated library formation by id. Returns the formation store id. */
export function makeAnimatedFormation(libraryId: string): string {
  const entry = getLibraryFormations().find((e) => e.id === libraryId)
  if (!entry) throw new Error(`Library formation not found: ${libraryId}`)
  return useFormationStore.getState().addAnimatedFormation(entry.name, entry.build(), entry.tags)
}
