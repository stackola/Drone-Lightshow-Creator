// ============================================================================
// S30: Show Outline Builder — ShowOutline → complete graph
// ============================================================================
// The `create_show_from_outline` tool calls buildShowFromOutline() which:
//   1. Creates all formations from generators/text
//   2. Builds the graph (launch → formations → transitions → land)
//   3. Connects everything with edges
//   4. Lays out nodes on the canvas
//   5. Applies keyframes, color programs, idle behaviors
//   6. Runs auto-timing + physics validation + auto-fix
//   7. Returns a human-readable summary
// ============================================================================

import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { useViewStore } from '../stores/viewStore'
import { computeAutoTiming } from '../graph/autoFix'
import { validateShowPhysics } from '../graph/physicsValidator'
import { computeAllTiming } from '../graph/timing'
import { textToFormation } from './formationImport'
import type {
  LaunchNodeData,
  FormationNodeData,
  TransitionConfig,
  LandNodeData,
  IdleBehavior,
} from '../graph/types'
import type { EasingType } from '../graph/easing'

// ── S30-01: ShowOutline ─────────────────────────────────────────────────────

export interface ShowOutline {
  name: string
  droneCount: number
  acts: ShowAct[]
}

// ── S30-02: ShowAct ─────────────────────────────────────────────────────────

export interface ShowAct {
  label: string
  formations: ActFormation[]
  transition?: {
    strategyId: string
    parameters?: Record<string, unknown>
    duration?: number
  }
}

// ── S30-03: ActFormation ────────────────────────────────────────────────────

export interface ActFormation {
  name: string
  generator: {
    type: string    // generatorId ('ring', 'grid', etc.) or 'text'
    params: Record<string, unknown>
  }
  duration: number
  altitude: number
  colorProgramId?: string
  keyframes?: {
    time: number
    position?: { x?: number; y?: number; z?: number }
    rotation?: { x?: number; y?: number; z?: number }
    scale?: { x?: number; y?: number; z?: number }
    easing?: string
  }[]
  idleBehavior?: {
    behavior: string
    radius: number
    speed: number
  }
}

// ── S30-04: Build result ────────────────────────────────────────────────────

export interface BuildResult {
  nodeIds: Map<string, string>       // label → nodeId
  formationIds: Map<string, string>  // formation name → formationId
  edgeIds: string[]
  duration: number
  violations: number
  summary: string
}

// ── S30-04 to S30-14: Main builder ──────────────────────────────────────────

export function buildShowFromOutline(outline: ShowOutline): BuildResult {
  const graphStore = useGraphStore.getState()
  const projectStore = useProjectStore.getState()
  const formationStore = useFormationStore.getState()

  // Clear existing show
  graphStore.loadGraph({ nodes: [], edges: [] })
  formationStore.loadFormations([], new Map())

  // Set drone count
  projectStore.setDroneCount(outline.droneCount)
  projectStore.updateMeta({ name: outline.name, modifiedAt: new Date().toISOString() })

  const nodeIds = new Map<string, string>()
  const formationIds = new Map<string, string>()
  const edgeIds: string[] = []
  const PX_PER_SECOND = useViewStore.getState().pxPerSecond

  // ── S30-05: Formation creation pass ─────────────────────────────────
  for (const act of outline.acts) {
    for (const af of act.formations) {
      let fId: string

      if (af.generator.type === 'text') {
        // Text formation — requires DOM, may fail in tests
        try {
          const result = textToFormation({
            text: (af.generator.params.text as string) ?? af.name,
            fontFamily: 'sans-serif',
            fontSize: (af.generator.params.fontSize as number) ?? 48,
            fontWeight: 'bold',
            alignment: 'center',
            targetDroneCount: outline.droneCount,
            scale: (af.generator.params.scale as number) ?? 30,
            plane: 'xy',
            perCharacterGrouping: false,
          })
          fId = formationStore.addFormation(af.name, 'grid', { count: result.points.length, cols: 1, spacing: 1 })
          useFormationStore.setState((s) => {
            s.generatedPoints.set(fId, result.points)
            const f = s.formations.find((f) => f.id === fId)
            if (f) f.pointCount = result.points.length
          })
        } catch {
          // Fallback to grid if Canvas not available
          fId = formationStore.addFormation(af.name, 'grid', { cols: Math.ceil(Math.sqrt(outline.droneCount)), rows: Math.ceil(Math.sqrt(outline.droneCount)), spacing: 2 })
        }
      } else {
        // Standard generator
        const params = { ...af.generator.params } as Record<string, number>
        // Ensure count param matches drone count if not specified
        if (!params.count && !params.cols) params.count = outline.droneCount
        fId = formationStore.addFormation(af.name, af.generator.type, params)
      }

      formationIds.set(af.name, fId)
    }
  }

  // ── S30-06: Graph structure pass ────────────────────────────────────
  // Launch node
  let timeAccum = 0
  const launchId = graphStore.addNode('launch', { x: 0, y: 150 }, {
    droneCount: outline.droneCount,
    startTime: 0,
    staggerDelay: 0.02,
  } as LaunchNodeData)
  nodeIds.set('launch', launchId)
  timeAccum += 2 // launch takes ~2s

  // Formation nodes only — transitions are properties of the connecting flow edges.
  const actNodeIds: string[] = [] // formation node IDs in order
  // Carry the transition config from the previous act forward; applied to the
  // edge between prev formation and the next formation.
  const transitionByActIndex = new Map<number, TransitionConfig>()
  let pendingTransition: TransitionConfig | null = null

  for (let actIdx = 0; actIdx < outline.acts.length; actIdx++) {
    const act = outline.acts[actIdx]!
    const af = act.formations[0] // Primary formation per act
    if (!af) continue

    const fId = formationIds.get(af.name)
    if (!fId) continue

    const startTime = timeAccum
    const canvasX = startTime * PX_PER_SECOND

    const formNodeId = graphStore.addNode('formation', { x: canvasX, y: 150 }, {
      formationId: fId,
      startTime,
      duration: af.duration,
      transform: {
        position: { x: 0, y: af.altitude, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      keyframes: [],
      colorProgramId: af.colorProgramId ?? null,
      idleConfigs: [],
    } as FormationNodeData)

    nodeIds.set(act.label, formNodeId)
    actNodeIds.push(formNodeId)
    if (pendingTransition) {
      transitionByActIndex.set(actNodeIds.length - 1, pendingTransition)
      pendingTransition = null
    }
    timeAccum += af.duration

    // ── S30-09: Keyframe application pass ─────────────────────────────
    if (af.keyframes && af.keyframes.length > 0) {
      for (const kf of af.keyframes) {
        const transform = {
          position: { x: kf.position?.x ?? 0, y: kf.position?.y ?? af.altitude, z: kf.position?.z ?? 0 },
          rotation: { x: kf.rotation?.x ?? 0, y: kf.rotation?.y ?? 0, z: kf.rotation?.z ?? 0 },
          scale: { x: kf.scale?.x ?? 1, y: kf.scale?.y ?? 1, z: kf.scale?.z ?? 1 },
        }
        graphStore.addKeyframe(formNodeId, kf.time, transform, (kf.easing ?? 'ease-in-out') as EasingType)
      }
    }

    // ── S30-11: Idle behavior attachment pass ──────────────────────────
    if (af.idleBehavior) {
      graphStore.addAttachedIdle(formNodeId, {
        behavior: af.idleBehavior.behavior as IdleBehavior,
        radius: af.idleBehavior.radius,
        speed: af.idleBehavior.speed,
        altitude: af.altitude,
        colorProgramId: null,
      })
    }

    // Track the upcoming transition config so the next act's incoming edge gets it.
    if (actIdx < outline.acts.length - 1 && act.transition) {
      const transDuration = act.transition.duration ?? 3
      pendingTransition = {
        strategyId: act.transition.strategyId,
        parameters: act.transition.parameters ?? {},
        preferredDuration: transDuration,
        pushPolicy: 'auto',
        locked: false,
      }
      timeAccum += transDuration
    } else {
      pendingTransition = null
    }
  }

  // Land node
  const landCanvasX = timeAccum * PX_PER_SECOND
  const landId = graphStore.addNode('land', { x: landCanvasX, y: 150 }, {
    staggerDelay: 0.02,
  } as LandNodeData)
  nodeIds.set('land', landId)

  // ── Edge connection pass — each flow edge carries the act's transition cfg ──
  if (actNodeIds.length > 0) {
    const firstId = actNodeIds[0]
    if (firstId) {
      const eid = graphStore.addEdge(launchId, 'flow-out', firstId, 'flow-in', 'flow')
      if (eid) edgeIds.push(eid)
    }
  }

  for (let i = 0; i < actNodeIds.length - 1; i++) {
    const src = actNodeIds[i]
    const tgt = actNodeIds[i + 1]
    if (!src || !tgt) continue
    const cfg = transitionByActIndex.get(i + 1)
    const eid = graphStore.addEdge(src, 'flow-out', tgt, 'flow-in', 'flow', undefined, cfg)
    if (eid) edgeIds.push(eid)
  }

  if (actNodeIds.length > 0) {
    const lastId = actNodeIds[actNodeIds.length - 1]
    if (lastId) {
      const eid = graphStore.addEdge(lastId, 'flow-out', landId, 'flow-in', 'flow')
      if (eid) edgeIds.push(eid)
    }
  } else {
    const eid = graphStore.addEdge(launchId, 'flow-out', landId, 'flow-in', 'flow')
    if (eid) edgeIds.push(eid)
  }

  // ── S30-12 + S30-13: Iterative auto-timing + validation + fix ────────
  const constraints = useProjectStore.getState().constraints
  const homePositions = useProjectStore.getState().dronePool.homePositions

  for (let round = 0; round < 5; round++) {
    const g = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const gp = useFormationStore.getState().generatedPoints

    // Auto-timing
    const timingPatches = computeAutoTiming(g, constraints, gp)
    for (const patch of timingPatches) {
      if (patch.edgeId) {
        useGraphStore.getState().updateEdgeTransition(patch.edgeId, patch.patch as Record<string, unknown>)
      } else if (patch.nodeId) {
        useGraphStore.getState().updateNodeData(patch.nodeId, patch.patch as Record<string, unknown>)
      }
    }

    // Re-read and fix
    const g2 = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const violations = validateShowPhysics(g2, constraints, gp, homePositions)
    if (violations.length === 0) break

    const fixable = violations.filter((v) => v.fix)
    if (fixable.length > 0) {
      useGraphStore.getState().applyViolationFixes(
        fixable.map((v) => ({ type: v.fix!.type, nodeId: v.fix!.nodeId, edgeId: v.fix!.edgeId, delta: v.fix!.delta })),
      )
    }

    // Check if we made progress
    const remaining = validateShowPhysics(
      { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges },
      constraints, gp, homePositions,
    )
    if (remaining.length >= violations.length) break // no progress
  }

  // ── S30-14: Summary generation ──────────────────────────────────────
  const finalGraph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
  const finalTiming = computeAllTiming(finalGraph)
  let maxEnd = 0
  finalTiming.forEach((r) => { if (r.end > maxEnd) maxEnd = r.end })
  const finalViolations = validateShowPhysics(finalGraph, constraints, useFormationStore.getState().generatedPoints, homePositions)

  const formCount = outline.acts.reduce((sum, a) => sum + a.formations.length, 0)
  const transCount = outline.acts.filter((a) => a.transition).length
  const dMin = Math.floor(maxEnd / 60)
  const dSec = Math.round(maxEnd % 60)

  const summary = `Created "${outline.name}": ${formCount} formations, ${transCount} transitions, ${outline.droneCount} drones, duration ${dMin}m ${dSec.toString().padStart(2, '0')}s, ${finalViolations.length} violations remaining.`

  return {
    nodeIds,
    formationIds,
    edgeIds,
    duration: maxEnd,
    violations: finalViolations.length,
    summary,
  }
}
