// ============================================================================
// Plane Drop Controller — drops a Formation from the asset panel onto the
// active build plane via raycast. Lives inside the Canvas so it can read the
// live camera; the DOM onDrop dispatches a `plane-drop` window event.
// ============================================================================

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { usePlanesStore } from '../../stores/planesStore'
import { useGraphStore } from '../../stores/graphStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useHistoryStore } from '../../stores/historyStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { useViewStore } from '../../stores/viewStore'
import { raycastClientToPlane } from './raycastToPlane'
import { wireNodeIntoFlow } from '../../graph/autoWire'
import { toast } from '../Toast'
import type { FormationNodeData } from '../../graph/types'

interface PlaneDropDetail {
  clientX: number
  clientY: number
  formationId: string
}

export function PlaneDropController() {
  const { camera, gl, raycaster } = useThree()

  useEffect(() => {
    function onDrop(e: Event) {
      const { clientX, clientY, formationId } = (e as CustomEvent<PlaneDropDetail>).detail
      if (!formationId) return
      const plane = usePlanesStore.getState().getActivePlane()
      if (!plane) return

      const hit = raycastClientToPlane(clientX, clientY, camera, gl.domElement, raycaster, plane)
      if (!hit) return
      const { world: pos, u, v } = hit

      const startTime = usePlayheadStore.getState().currentTime
      const pxPerSecond = useViewStore.getState().pxPerSecond

      useHistoryStore.getState().snapshot('Drop formation on plane')
      const id = useGraphStore.getState().addNode(
        'formation',
        { x: Math.max(0, startTime * pxPerSecond), y: 0 },
        {
          formationId,
          startTime: Math.max(0, startTime),
          duration: 5,
          transform: { position: pos, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [],
          colorProgramId: null,
          idleConfigs: [],
          planeBinding: { planeId: plane.id, u, v },
        } as FormationNodeData,
      )
      useSelectionStore.getState().setSelection([id], [])
      // Wire the new formation into the show flow so it actually plays.
      const wired = wireNodeIntoFlow(id)
      toast.success(wired ? 'Formation placed and wired into the show' : 'Formation placed')
    }

    window.addEventListener('plane-drop', onDrop as EventListener)
    return () => window.removeEventListener('plane-drop', onDrop as EventListener)
  }, [camera, gl, raycaster])

  return null
}
