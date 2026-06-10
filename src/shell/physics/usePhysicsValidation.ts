// ============================================================================
// usePhysicsValidation — always-on, debounced, worker-backed show validation
// hoisted to the AppShell level (the legacy version only ran while the
// inspector's Physics tab was mounted). Feeds the StatusStrip badge and the
// PhysicsDrawer.
// ============================================================================

import { useState, useRef, useEffect } from 'react'
import { useGraphStore } from '../../stores/graphStore'
import { useProjectStore } from '../../stores/projectStore'
import { useFormationStore } from '../../stores/formationStore'
import { validateShowPhysicsAsync } from '../../graph/physicsWorkerClient'
import type { PhysicsViolation } from '../../graph/physicsValidator'

export function usePhysicsValidation(): PhysicsViolation[] {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const constraints = useProjectStore((s) => s.constraints)
  const generatedPoints = useFormationStore((s) => s.generatedPoints)

  const [violations, setViolations] = useState<PhysicsViolation[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void validateShowPhysicsAsync({ nodes, edges }, constraints, generatedPoints).then((v) => {
        if (!cancelled) setViolations(v)
      })
    }, 300)
    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [nodes, edges, constraints, generatedPoints])

  return violations
}
