// ============================================================================
// Audience Edit Layer — mounted inside the audience Canvas. Renders nothing in
// presentation mode. In edit mode it reuses the (camera-agnostic) FormationGizmo
// so a selected formation can be moved from the audience POV, handles DnD/
// click placement onto the resolved surface, and shows a ghost plane for
// free-depth placement.
// ============================================================================

import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FormationGizmo, MultiSelectGizmo } from '../FormationGizmo'
import { useAudienceEditStore } from '../../../stores/audienceEditStore'
import { usePlayheadStore } from '../../../stores/playheadStore'
import { useViewStore } from '../../../stores/viewStore'
import { useGraphStore } from '../../../stores/graphStore'
import { useHistoryStore } from '../../../stores/historyStore'
import { useSelectionStore } from '../../../stores/selectionStore'
import { screenToPlacementPoint } from './audiencePlane'
import type { FormationNodeData } from '../../../graph/types'
import { ACCENT_PRIMARY } from '../../../ui/colors'

interface DropDetail {
  clientX: number
  clientY: number
  formationId: string
}

const _ndc = new THREE.Vector2()

/** Listens for audience DnD drops and places a formation on the resolved surface. */
function AudiencePlacementController() {
  const { camera, gl, raycaster } = useThree()
  useEffect(() => {
    function onDrop(e: Event) {
      const { clientX, clientY, formationId } = (e as CustomEvent<DropDetail>).detail
      if (!formationId) return
      const rect = gl.domElement.getBoundingClientRect()
      _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      const result = screenToPlacementPoint(_ndc, camera, raycaster)
      if (!result) return

      const startTime = usePlayheadStore.getState().currentTime
      const pxPerSecond = useViewStore.getState().pxPerSecond
      useHistoryStore.getState().snapshot('Place in audience view')
      const id = useGraphStore.getState().addNode(
        'formation',
        { x: Math.max(0, startTime * pxPerSecond), y: 0 },
        {
          formationId,
          startTime: Math.max(0, startTime),
          duration: 5,
          transform: { position: result.point, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [],
          colorProgramId: null,
          idleConfigs: [],
          ...(result.binding ? { planeBinding: result.binding } : {}),
        } as FormationNodeData,
      )
      useSelectionStore.getState().setSelection([id], [])
    }
    window.addEventListener('audience-plane-drop', onDrop as EventListener)
    return () => window.removeEventListener('audience-plane-drop', onDrop as EventListener)
  }, [camera, gl, raycaster])
  return null
}

/** Faint camera-facing quad showing the free-placement depth plane. */
function GhostPlaneViz() {
  const surface = useAudienceEditStore((s) => s.surface)
  const meshRef = useRef<THREE.Mesh>(null)
  useFrame(({ camera }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const depth = useAudienceEditStore.getState().placementDepth
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    mesh.position.copy(camera.position).addScaledVector(dir, depth)
    mesh.quaternion.copy(camera.quaternion)
  })
  if (surface !== 'free') return null
  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[60, 40]} />
      <meshBasicMaterial color={ACCENT_PRIMARY} transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

export function AudienceEditLayer() {
  const editing = useAudienceEditStore((s) => s.editing)
  if (!editing) return null
  return (
    <>
      <FormationGizmo />
      <MultiSelectGizmo />
      <AudiencePlacementController />
      <GhostPlaneViz />
    </>
  )
}
