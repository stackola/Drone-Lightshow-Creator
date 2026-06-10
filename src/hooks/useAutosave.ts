// ============================================================================
// S8-03: Autosave hook — subscribes to store mutations, triggers debounced save
// S8-08: Tracks unsaved changes state
// ============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { scheduleAutosave, cancelPendingAutosave, addRecentProject } from '../services/autosave'

/**
 * Hook that auto-saves the project to IndexedDB on any store mutation (debounced 2s).
 * Also tracks whether there are unsaved changes since last explicit save/load.
 */
export function useAutosave() {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const lastSaveHash = useRef<string>('')

  // Compute a lightweight hash of current state (includes graph + formations + project)
  const computeHash = useCallback(() => {
    const { nodes, edges } = useGraphStore.getState()
    const { meta, dronePool, constraints } = useProjectStore.getState()
    const { formations } = useFormationStore.getState()
    const graphHash = JSON.stringify(nodes.map((n) => n.data)).length
    const formHash = formations.length + formations.reduce((s, f) => s + f.pointCount, 0)
    return `${meta.id}-${meta.name}-${nodes.length}-${edges.length}-${graphHash}-${formHash}-${dronePool.droneCount}-${constraints.maxVelocity}`
  }, [])

  // Mark as saved (called after explicit save or load)
  const markSaved = useCallback(() => {
    lastSaveHash.current = computeHash()
    setHasUnsavedChanges(false)
  }, [computeHash])

  // Subscribe to graph store changes
  useEffect(() => {
    const unsubGraph = useGraphStore.subscribe(() => {
      const { meta, dronePool } = useProjectStore.getState()
      scheduleAutosave(meta.id, meta.name, dronePool.droneCount)
      setHasUnsavedChanges(computeHash() !== lastSaveHash.current)
    })

    const unsubProject = useProjectStore.subscribe(() => {
      const { meta, dronePool } = useProjectStore.getState()
      scheduleAutosave(meta.id, meta.name, dronePool.droneCount)
      setHasUnsavedChanges(computeHash() !== lastSaveHash.current)
    })

    const unsubFormation = useFormationStore.subscribe(() => {
      const { meta, dronePool } = useProjectStore.getState()
      scheduleAutosave(meta.id, meta.name, dronePool.droneCount)
      setHasUnsavedChanges(computeHash() !== lastSaveHash.current)
    })

    return () => {
      unsubGraph()
      unsubProject()
      unsubFormation()
      cancelPendingAutosave()
    }
  }, [computeHash])

  // Update recent projects list on project load/save
  useEffect(() => {
    const unsub = useProjectStore.subscribe((state) => {
      const timing = useGraphStore.getState().getCachedTiming()
      let maxEnd = 0
      timing.forEach((range) => {
        if (range.end > maxEnd) maxEnd = range.end
      })

      addRecentProject({
        id: state.meta.id,
        name: state.meta.name,
        lastOpened: Date.now(),
        droneCount: state.dronePool.droneCount,
        duration: maxEnd,
      }).catch(() => {})
    })
    return unsub
  }, [])

  // Set up beforeunload warning (S8-08)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = '' // Required for Chrome/Edge to show confirmation dialog
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // Initialize hash on mount
  useEffect(() => {
    lastSaveHash.current = computeHash()
  }, [computeHash])

  return { hasUnsavedChanges, markSaved }
}
