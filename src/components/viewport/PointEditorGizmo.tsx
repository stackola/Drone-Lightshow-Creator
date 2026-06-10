// ============================================================================
// Item 5 (2026-05-22): direct-manipulation point editing in 3D.
// ============================================================================
// When point-edit mode is active AND points are selected, render a
// PivotControls gizmo anchored at the selection centroid in world space.
// Dragging the gizmo calls `moveSelected(delta)` on the point-editor store —
// the snap-plane + symmetry-aware math already lives there. One history
// snapshot per drag for clean undo.
//
// Wires through:
//   1. usePointEditorStore.isActive + selectedIndices
//   2. formationStore.getPoints(formationId) → centroid
//   3. graphStore.nodes → find which formation-node hosts this formation, so
//      we can apply the node's transform to map local point coords → world.
// ============================================================================

import { useRef, useCallback, useMemo, useEffect } from 'react'
import { PivotControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useFormationStore } from '../../stores/formationStore'
import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useViewStore } from '../../stores/viewStore'
import { usePointEditorStore } from './PointEditor'
import type { FormationNodeData } from '../../graph/types'
import { ACCENT_PRIMARY } from '../../ui/colors'

// Reusable temp objects.
const _matIdentity = new THREE.Matrix4()
const _vCenter = new THREE.Vector3()
const _vDecomposePos = new THREE.Vector3()
const _qDecompose = new THREE.Quaternion()
const _sDecompose = new THREE.Vector3()

export function PointEditorGizmo() {
  const isActive = usePointEditorStore((s) => s.isActive)
  const formationId = usePointEditorStore((s) => s.formationId)
  const selectedIndices = usePointEditorStore((s) => s.selectedIndices)
  const setDraggingGizmo = useViewStore((s) => s.setDraggingGizmo)
  const snapshot = useHistoryStore((s) => s.snapshot)

  const stableMatrix = useRef(new THREE.Matrix4())
  const isDraggingRef = useRef(false)
  const dragStartCenterRef = useRef<{ x: number; y: number; z: number } | null>(null)

  // While point-edit mode is active, intercept drone-click events fired by
  // DroneCloud and route them into the point editor's selectPoint action.
  // Shift-click is additive; bare click replaces.
  useEffect(() => {
    if (!isActive) return
    const onDroneClick = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { droneIndex?: number; shiftKey?: boolean } | undefined
      if (detail?.droneIndex == null || detail.droneIndex < 0) return
      usePointEditorStore.getState().selectPoint(detail.droneIndex, !!detail.shiftKey)
    }
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') usePointEditorStore.getState().exitEditMode()
      else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'a') {
        ev.preventDefault()
        usePointEditorStore.getState().selectAll()
      }
    }
    window.addEventListener('drone-click', onDroneClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('drone-click', onDroneClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isActive])

  // Find the formation node hosting this formationId (we use its base transform
  // to translate point centroid from local to world space). Use the first
  // match — point edits are stored in the formation's `generatedPoints` Map,
  // which is shared across all referencing nodes.
  const hostNode = useMemo(() => {
    if (!formationId) return null
    const nodes = useGraphStore.getState().nodes
    return nodes.find((n) => n.type === 'formation' && (n.data as FormationNodeData).formationId === formationId) ?? null
  }, [formationId])

  // Recompute the world-space selection centroid every frame (the formation's
  // base transform position may change while the gizmo is mounted).
  useFrame(() => {
    if (isDraggingRef.current) return
    if (!formationId || !hostNode || selectedIndices.size === 0) return
    const points = useFormationStore.getState().getPoints(formationId)
    if (!points || points.length === 0) return
    const data = hostNode.data as FormationNodeData
    const t = data.transform
    let cx = 0, cy = 0, cz = 0
    let count = 0
    selectedIndices.forEach((i) => {
      const p = points[i]
      if (!p) return
      cx += p.x * t.scale.x + t.position.x
      cy += p.y * t.scale.y + t.position.y
      cz += p.z * t.scale.z + t.position.z
      count++
    })
    if (count === 0) return
    _vCenter.set(cx / count, cy / count, cz / count)
    stableMatrix.current.identity()
    stableMatrix.current.setPosition(_vCenter)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDragStart = useCallback((_props: any) => {
    isDraggingRef.current = true
    setDraggingGizmo(true)
    snapshot(`Move ${selectedIndices.size} drone${selectedIndices.size === 1 ? '' : 's'}`)
    stableMatrix.current.decompose(_vDecomposePos, _qDecompose, _sDecompose)
    dragStartCenterRef.current = { x: _vDecomposePos.x, y: _vDecomposePos.y, z: _vDecomposePos.z }
  }, [selectedIndices, snapshot, setDraggingGizmo])

  const handleDrag = useCallback((local: THREE.Matrix4) => {
    const start = dragStartCenterRef.current
    if (!start || !hostNode) return
    stableMatrix.current.copy(local)
    local.decompose(_vDecomposePos, _qDecompose, _sDecompose)
    // Convert world-space delta back to formation-local-space delta.
    const data = hostNode.data as FormationNodeData
    const dxW = _vDecomposePos.x - start.x
    const dyW = _vDecomposePos.y - start.y
    const dzW = _vDecomposePos.z - start.z
    const delta = {
      x: dxW / Math.max(0.001, data.transform.scale.x),
      y: dyW / Math.max(0.001, data.transform.scale.y),
      z: dzW / Math.max(0.001, data.transform.scale.z),
    }
    // Apply incremental delta from drag-start position. Since moveSelected
    // adds to the current point positions, we need to track the running delta
    // we've already applied. Simpler: reset drag-start each tick so we apply
    // the incremental motion.
    usePointEditorStore.getState().moveSelected(delta)
    dragStartCenterRef.current = { x: _vDecomposePos.x, y: _vDecomposePos.y, z: _vDecomposePos.z }
  }, [hostNode])

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false
    setDraggingGizmo(false)
    dragStartCenterRef.current = null
  }, [setDraggingGizmo])

  if (!isActive || !formationId || selectedIndices.size === 0 || !hostNode) return null
  // Touch unused refs to keep ESLint happy.
  void _matIdentity

  return (
    <PivotControls
      matrix={stableMatrix.current}
      autoTransform={false}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      scale={70}
      fixed
      lineWidth={2}
      depthTest={false}
      axisColors={['#ff4060', '#40ff60', '#4060ff']}
      hoveredColor="#ffff40"
      disableRotations
      disableScaling
      annotations
    >
      <mesh>
        <sphereGeometry args={[0.4, 12, 12]} />
        <meshBasicMaterial color={ACCENT_PRIMARY} wireframe transparent opacity={0.45} />
      </mesh>
    </PivotControls>
  )
}
