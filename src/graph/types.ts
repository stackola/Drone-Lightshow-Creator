// ============================================================================
// Canonical Graph Types — Source of Truth
// ============================================================================
// ARCHITECTURAL LAW: These types define the authoritative graph model.
// React Flow, 3D viewport, and all UI are derived views of this data.
// No derived state (flow counts, evaluation results) is persisted here.
// Node IDs are stable across edits. ShowGraph is the complete serializable truth.
// ============================================================================

import type { EasingType } from './easing'
import type { Color3 } from './colors'

// --- Enums / Discriminators ---

export type ShowNodeType = 'launch' | 'formation' | 'idle' | 'land' | 'group'

export type EdgeType = 'flow' | 'attachment'

export type AllocationMode =
  | { mode: 'auto' }
  | { mode: 'manual-count'; count: number }
  | { mode: 'manual-percent'; percent: number }

/**
 * Per-edge transition configuration. A flow edge between two timed nodes
 * (launch | formation | idle → formation | land | idle) carries the strategy
 * + parameters used to move drones from the source's end state to the target's
 * start state during the gap `[source.end, target.start]`.
 *
 * Replaces the former standalone TransitionNode. There is no longer a node
 * type for transitions; the edge IS the transition.
 */
export interface TransitionConfig {
  strategyId: string
  parameters: Record<string, unknown>
  /** Author-set duration request. Engine enforces effective = max(preferredDuration, minRequired). */
  preferredDuration: number
  /**
   * When effective duration exceeds preferredDuration, behaviour for the downstream node:
   *   - 'auto' (default): cascade-push downstream startTime so the show stays well-formed.
   *   - 'warn': leave downstream startTime alone and emit a NodeWarning instead.
   */
  pushPolicy?: 'auto' | 'warn'
  /** When true, edge inspector parameter edits are refused. */
  locked?: boolean
}

// --- Vectors ---

export interface Vec3 {
  x: number
  y: number
  z: number
}

// --- Transform ---

export interface Transform3D {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export interface TransformKeyframe {
  /** Stable unique ID for React keys and addressing. Auto-generated if omitted. */
  id?: string
  time: number
  transform: Transform3D
  easing: EasingType
  /**
   * Control-point quadruple {x1, y1, x2, y2} used when `easing === 'cubic-bezier'`.
   * Ignored for all other easing types. Defaults to CSS `ease` when omitted.
   */
  bezierConfig?: { x1: number; y1: number; x2: number; y2: number }
}

// --- Color keyframes & per-drone overrides ---

export interface ColorProgramKeyframe {
  id?: string
  /** Formation-local seconds (relative to FormationNodeData.startTime). */
  time: number
  colorProgramId: string
  easing?: EasingType
  /** Control-point quadruple used when `easing === 'cubic-bezier'`. */
  bezierConfig?: { x1: number; y1: number; x2: number; y2: number }
}

export interface ColorOverrideGroup {
  id: string
  name: string
  pointIndices: number[]
  color: Color3
}

// --- Live symmetry constraint ---

export interface SymmetryConfig {
  /** Local-space mirror axis (formation point coordinates). */
  axis: 'x' | 'y' | 'z'
  /** Origin on the mirror plane in formation-local space; usually {0,0,0}. */
  plane: Vec3
  /** Index map: tuple of 2 = paired, tuple of 1 = locked to the plane. */
  pairs: number[][]
  /** Distance below which a point counts as on-plane (used at build time). */
  epsilon: number
}

// --- Attached Idle ---

export type IdleBehavior = 'hover' | 'orbit' | 'breathe' | 'random-walk' | 'figure8' | 'swarm' | 'sparkle' | 'pulse' | 'wave' | 'spin' | 'drift'

/** Per-axis flags controlling which parent keyframe transform channels idle drones inherit. */
export interface IdleInherit {
  translateX: boolean
  translateY: boolean
  translateZ: boolean
  rotateX: boolean
  rotateY: boolean
  rotateZ: boolean
  scaleX: boolean
  scaleY: boolean
  scaleZ: boolean
}

export const DEFAULT_IDLE_INHERIT: IdleInherit = {
  translateX: true, translateY: true, translateZ: true,
  rotateX: false, rotateY: false, rotateZ: false,
  scaleX: false, scaleY: false, scaleZ: false,
}

export interface AttachedIdleConfig {
  id: string
  behavior: IdleBehavior
  radius: number
  speed: number
  altitude: number
  colorProgramId: string | null
  inherit?: IdleInherit
}

// --- Node Data Interfaces ---

export interface LaunchNodeData {
  droneCount: number
  startTime: number
  staggerDelay: number
}

export interface FormationNodeData {
  formationId: string | null
  startTime: number
  duration: number
  transform: Transform3D
  keyframes: TransformKeyframe[]
  colorProgramId: string | null
  idleConfigs: AttachedIdleConfig[]
  /**
   * When true, the timing solver refuses to cascade-push this formation's startTime
   * (e.g. for clock-cue formations that must stay pinned). Emits a NodeWarning if an
   * upstream transition would otherwise force a push.
   */
  staggerLock?: boolean
  /** Bundle 4: keyframes that blend between color programs over the formation's life. */
  colorKeyframes?: ColorProgramKeyframe[]
  /** Bundle 4: per-drone color overrides applied after the program. */
  colorOverrides?: ColorOverrideGroup[]
  /** Bundle 3: live mirror constraint. When set, point edits propagate to paired points. */
  symmetry?: SymmetryConfig | null
  /** Bundle 5: when true the evaluator skips this node entirely (preview-only). */
  muted?: boolean
  /** Bundle 5: when true and any soloed node exists, only soloed nodes render. */
  soloed?: boolean
  /** Bundle 8: free-form annotations pinned to the node. */
  annotations?: NodeAnnotation[]
  /** O-04: when true, the gizmo + handle drags + inspector edits are refused.
   *  Selection still works, so locked nodes can still be inspected, but their
   *  transform/keyframes/parameters can't be changed until unlocked. */
  locked?: boolean
  /**
   * Build Planes: when set, this formation is "placed on" a BuildPlane.
   * `transform.position` stays the canonical eval source; (u,v) are the
   * authoring intent (where on the surface it sits). On any plane edit the
   * position is recomputed from (u,v). Drag onto a *locked* plane is
   * constrained to the surface. Absent for shows authored without planes.
   */
  planeBinding?: { planeId: string; u: number; v: number }
}

export interface NodeAnnotation {
  id: string
  text: string
  createdAt: number
  /** Optional formation-local time the annotation refers to. */
  t?: number
}

export interface IdleNodeData {
  behavior: IdleBehavior
  center: Vec3
  radius: number
  speed: number
  altitude: number
  startTime: number
  duration: number
  colorProgramId: string | null
  /** Optional drift / sweep direction. Consumed by `drift` behavior; ignored
   *  by others. Unit vector recommended but not enforced. Added 2026-05-21
   *  for L2 DirectionHandle adoption — old saved shows lack this field and
   *  the drift behaviour falls back to its previous hard-coded heading. */
  direction?: Vec3
  /** O-04: when true, inspector edits + drag handles refuse to mutate. */
  locked?: boolean
}

export interface LandNodeData {
  staggerDelay: number
}

export interface GroupNodeData {
  label: string
  color: string
  collapsed: boolean
  showInternalEdges: boolean
}

// --- Node Data Union ---

export type ShowNodeData =
  | LaunchNodeData
  | FormationNodeData
  | IdleNodeData
  | LandNodeData
  | GroupNodeData

// --- Port Definitions ---

export type PortDirection = 'input' | 'output'

export interface PortDef {
  id: string
  direction: PortDirection
  label: string
  edgeType: EdgeType
  maxConnections: number
  accepts: ShowNodeType[]
}

// --- Core Graph Structures (Discriminated Union) ---

interface ShowNodeBase {
  id: string
  position: { x: number; y: number }
  parentId: string | null
}

export interface LaunchNode extends ShowNodeBase { type: 'launch'; data: LaunchNodeData }
export interface FormationNode extends ShowNodeBase { type: 'formation'; data: FormationNodeData }
export interface IdleNode extends ShowNodeBase { type: 'idle'; data: IdleNodeData }
export interface LandNode extends ShowNodeBase { type: 'land'; data: LandNodeData }
export interface GroupNode extends ShowNodeBase { type: 'group'; data: GroupNodeData }

export type ShowNode = LaunchNode | FormationNode | IdleNode | LandNode | GroupNode

export interface ShowEdge {
  id: string
  edgeType: EdgeType
  source: string
  sourcePort: string
  target: string
  targetPort: string
  droneCount: number
  allocation: AllocationMode
  /**
   * Present on every 'flow' edge between two timed nodes. Drives the
   * transition that runs during `[source.end, target.start]`. Absent on
   * attachment edges and (transitionally) on flow edges that haven't been
   * given a config yet.
   */
  transition?: TransitionConfig
}

export interface ShowGraph {
  nodes: ShowNode[]
  edges: ShowEdge[]
}

// --- Evaluation Types ---

export interface DroneState {
  droneId: number
  position: Vec3
  color: { r: number; g: number; b: number }
}

// --- Diagnostics ---

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  severity: DiagnosticSeverity
  message: string
  nodeIds: string[]
  edgeIds: string[]
}

// --- Type Guards (still useful for filter callbacks) ---

export function isLaunchNode(node: ShowNode): node is LaunchNode {
  return node.type === 'launch'
}

export function isFormationNode(node: ShowNode): node is FormationNode {
  return node.type === 'formation'
}

export function isIdleNode(node: ShowNode): node is IdleNode {
  return node.type === 'idle'
}

export function isLandNode(node: ShowNode): node is LandNode {
  return node.type === 'land'
}

export function isGroupNode(node: ShowNode): node is GroupNode {
  return node.type === 'group'
}

export function isTimedNode(node: ShowNode): node is LaunchNode | FormationNode | IdleNode {
  return node.type === 'launch' || node.type === 'formation' || node.type === 'idle'
}

// --- Timing-solver diagnostics ---

export type NodeWarningKind =
  | 'cascade-push'         // downstream pushed because upstream transition needed more time
  | 'duration-extended'    // transition effective > preferred (silent extension)
  | 'velocity-clamped'     // idle behaviour speed clamped by physics
  | 'spacing-violation'    // drone-pair spacing dipped below minSpacing
  | 'min-not-met'          // staggerLock or 'warn' policy prevented a needed push

export interface NodeWarning {
  nodeId: string
  kind: NodeWarningKind
  message: string
  delta?: number
}
