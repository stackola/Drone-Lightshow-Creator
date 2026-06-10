// ============================================================================
// S1 — Live-preview evaluation as a derived signal.
// ============================================================================
// Single source of truth for evaluated drone states. A `<EvaluatorTick />`
// component runs once per frame at renderPriority -1 and calls `refresh()`;
// every other live-preview consumer reads `peek()` or subscribes via Zustand.
//
// Architectural shift: previously each viewport consumer (DroneCloud,
// DroneHoverIndicator, …) ran its own `useFrame` + `evaluateAtTime` and
// stashed results in a module-level cache (`_evalCache`). The cache was
// signature-keyed, so identical reads coalesced — but every consumer still
// had to be inside `useFrame` to opt in, and React subscribers had no way to
// observe the result. With this store:
//
//   • One useFrame call drives eval. Multiple viewports share the result.
//   • Non-3D consumers (inspectors, panels) can subscribe to the version
//     counter and re-render only when a real change happens (NOT once per
//     frame; eval skips when the signature matches the previous one).
//   • Bake worker / aiToolEngine / physicsValidator still call evaluateAtTime
//     directly — they need bespoke time inputs and run outside React.
// ============================================================================

import { create } from 'zustand'
import { evaluateAtTime } from '../graph/evaluate'
import { useGraphStore, getGraphMutationVersion } from './graphStore'
import { useFormationStore, getFormationMutationVersion } from './formationStore'
import { useProjectStore, getProjectMutationVersion } from './projectStore'
import { usePlayheadStore } from './playheadStore'
import { toTransitionConstraints } from '../registries/transitions'
import type { DroneState } from '../graph/types'

interface EvaluationStoreState {
  /** Latest successfully-evaluated drone states, or null before the first
   *  tick. Mutating in place rather than replacing the array (to avoid
   *  triggering React re-renders every frame) — bump `version` for
   *  change-detection. */
  states: DroneState[] | null
  /** Parallel to `states`: the formation/idle node id that owns each drone at
   *  the current time (or null). Lets the 3D viewport map a clicked/hovered
   *  drone to its formation for selection. */
  owners: (string | null)[] | null
  /** Cache signature: graph/formation/project mutation versions + currentTime
   *  rounded to 4dp. Bumps on any input change. */
  sig: string
  /** Bumps on every successful eval whose `sig` differs from the previous.
   *  Subscribers that care about live data can listen to this. */
  version: number
  /** Signature of the last failed eval. Suppresses repeated console.error
   *  spam for the same broken input. */
  errorSig: string
  /** Imperative recompute. Called by `<EvaluatorTick />` per frame. */
  refresh: () => void
}

export const useEvaluationStore = create<EvaluationStoreState>()((set, get) => ({
  states: null,
  owners: null,
  sig: '',
  version: 0,
  errorSig: '',

  refresh() {
    const { nodes, edges } = useGraphStore.getState()
    const { currentTime } = usePlayheadStore.getState()
    const { generatedPoints, animatedDefs } = useFormationStore.getState()
    const homePositions = useProjectStore.getState().dronePool.homePositions
    if (!nodes || !edges || !homePositions) return

    const gv = getGraphMutationVersion()
    const fv = getFormationMutationVersion()
    const pv = getProjectMutationVersion()
    const sig = `${gv}/${fv}/${pv}/${currentTime.toFixed(4)}`

    const prev = get()
    if (sig === prev.sig && prev.states) return

    try {
      const graph = { nodes, edges }
      const formationsMap = new Map(generatedPoints)
      const projectConstraints = useProjectStore.getState().constraints
      const mutedIds = new Set<string>()
      const soloedIds = new Set<string>()
      for (const n of nodes) {
        if (n.type !== 'formation' && n.type !== 'idle') continue
        const d = n.data as { muted?: boolean; soloed?: boolean }
        if (d.muted) mutedIds.add(n.id)
        if (d.soloed) soloedIds.add(n.id)
      }
      const owners: (string | null)[] = new Array(homePositions.length).fill(null)
      const states = evaluateAtTime(graph, formationsMap, currentTime, homePositions, animatedDefs, {
        constraints: toTransitionConstraints(projectConstraints),
        runtimeFlags: { mutedIds, soloedIds },
        owners,
      })
      set({ states, owners, sig, version: prev.version + 1 })
    } catch (err) {
      if (sig !== prev.errorSig) {
        console.error('[evaluationStore] eval failed at sig', sig, err)
        set({ errorSig: sig })
      }
      // Keep `prev.states` so consumers continue rendering the last good frame.
    }
  },
}))

/**
 * Imperative peek at the most recently evaluated drone states. Returns null
 * before the first successful eval. Safe to call inside `useFrame` — no
 * subscription overhead.
 */
export function peekDroneStates(): DroneState[] | null {
  return useEvaluationStore.getState().states
}

/**
 * Imperative peek at the owner node id of each drone at the current time.
 * `owners[droneId]` is the formation/idle node displaying that drone, or null.
 */
export function peekDroneOwners(): (string | null)[] | null {
  return useEvaluationStore.getState().owners
}
