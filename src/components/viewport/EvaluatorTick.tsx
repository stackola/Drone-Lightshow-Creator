// ============================================================================
// S1 — Single `useFrame` writer for the evaluationStore.
// ============================================================================
// Mount once inside any Canvas that wants live drone-state evaluation.
// Runs at `renderPriority = -1` so all default-priority consumers (DroneCloud,
// DroneHoverIndicator, etc.) read the freshest result during their own
// useFrame in the same tick.
//
// Renders nothing — purely a tick scheduler.
// ============================================================================

import { useFrame } from '@react-three/fiber'
import { useEvaluationStore } from '../../stores/evaluationStore'

export function EvaluatorTick() {
  useFrame(() => {
    useEvaluationStore.getState().refresh()
  }, -1)
  return null
}
