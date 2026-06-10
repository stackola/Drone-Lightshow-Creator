// ============================================================================
// Formation Gizmo — PivotControls for translate/rotate/scale formations
// ============================================================================
// Renders a PivotControls gizmo at the selected formation's transform.
//
// Keyframe strategy (Blender-like):
//   - No keyframes → drag edits base transform directly
//   - Has keyframes, playhead exactly on a keyframe time → edits that keyframe
//   - Has keyframes, playhead at localTime ≤ 0 → edits base transform
//   - Has keyframes, playhead between keyframes → gizmo disabled (read-only)
//
// The gizmo position always reflects the interpolated transform at the
// current playhead time so the user sees where the formation actually is.
//
// Drag fix: PivotControls source does `ref.current.matrix = matrix` every
// frame in useFrame. If we pass the SAME Matrix4 object, the drag handler's
// `ref.current.matrix.copy(mL)` mutates our object, and the next frame's
// reference assignment is a no-op. We only rebuild the matrix from the store
// when not dragging, preventing feedback loops.
// ============================================================================

import { useRef, useCallback } from 'react'
import { PivotControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGraphStore } from '../../stores/graphStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useViewStore } from '../../stores/viewStore'
import type { GizmoMode } from '../../stores/viewStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { useHistoryStore } from '../../stores/historyStore'
import { usePlanesStore } from '../../stores/planesStore'
import { interpolateTransform } from '../../graph/interpolateTransform'
import { worldToPlaneSurface, planeSurfaceToWorld } from '../../graph/buildPlane'
import { beginManip, endManip, HINT } from './manipulation/manipulationKit'
import { computeSnapGuides } from '../../graph/snapGuides'
import { publishSnapGuides, clearSnapGuides } from './SmartGuides'
import type { FormationNodeData, Transform3D } from '../../graph/types'

/** Epsilon for matching playhead to keyframe time (seconds) */
const KF_EPSILON = 0.05

// Reusable temp objects for decompose (avoid allocation during drag)
const _dPos = new THREE.Vector3()
const _dQuat = new THREE.Quaternion()
const _dScl = new THREE.Vector3()
const _dEuler = new THREE.Euler()

/** Decompose a THREE.Matrix4 into our Transform3D format */
function decomposeMatrix(matrix: THREE.Matrix4): Transform3D {
  matrix.decompose(_dPos, _dQuat, _dScl)
  _dEuler.setFromQuaternion(_dQuat, 'XYZ')
  return {
    position: { x: _dPos.x, y: _dPos.y, z: _dPos.z },
    rotation: { x: _dEuler.x, y: _dEuler.y, z: _dEuler.z },
    scale: { x: _dScl.x, y: _dScl.y, z: _dScl.z },
  }
}

/** Build a THREE.Matrix4 from our Transform3D format (mutates target) */
function writeMatrix(target: THREE.Matrix4, transform: Transform3D): void {
  const pos = _v1.set(transform.position.x, transform.position.y, transform.position.z)
  const euler = _e1.set(transform.rotation.x, transform.rotation.y, transform.rotation.z, 'XYZ')
  const quat = _q1.setFromEuler(euler)
  const scl = _v2.set(transform.scale.x, transform.scale.y, transform.scale.z)
  target.compose(pos, quat, scl)
}

// Reusable temp objects to avoid allocations
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _e1 = new THREE.Euler()
const _q1 = new THREE.Quaternion()

/**
 * Given a formation's data and the current playhead time, determine:
 *   - editTarget: 'base' | keyframe index | 'disabled'
 *   - displayTransform: the interpolated transform to show the gizmo at
 */
export function resolveGizmoTarget(
  data: FormationNodeData,
  currentTime: number,
): { editTarget: 'base' | 'disabled' | number; displayTransform: Transform3D } {
  const localTime = currentTime - data.startTime
  const displayTransform = interpolateTransform(data.transform, data.keyframes, Math.max(0, localTime))

  // No keyframes → always edit base
  if (data.keyframes.length === 0) {
    return { editTarget: 'base', displayTransform }
  }

  // At or before formation start → edit base transform
  if (localTime <= KF_EPSILON) {
    return { editTarget: 'base', displayTransform }
  }

  // Check if playhead is exactly on a keyframe
  for (let i = 0; i < data.keyframes.length; i++) {
    const kf = data.keyframes[i]!
    if (Math.abs(localTime - kf.time) <= KF_EPSILON) {
      return { editTarget: i, displayTransform }
    }
  }

  // Between keyframes → disabled (Blender behavior: changes would be lost)
  return { editTarget: 'disabled', displayTransform }
}

export function FormationGizmo() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const nodes = useGraphStore((s) => s.nodes)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const updateKeyframe = useGraphStore((s) => s.updateKeyframe)
  const gizmoMode = useViewStore((s) => s.gizmoMode)
  const setDraggingGizmo = useViewStore((s) => s.setDraggingGizmo)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const isPlaying = usePlayheadStore((s) => s.isPlaying)

  // Stable matrix — single instance, mutated in place.
  // PivotControls does `ref.current.matrix = matrix` every frame (reference assignment).
  // During drag, PivotControls mutates this object via .copy(). Since we pass the
  // same ref, the next frame's assignment is a no-op — no conflict.
  const stableMatrix = useRef(new THREE.Matrix4())
  const isDraggingRef = useRef(false)

  // Refs for latest values in stable callbacks
  const editTargetRef = useRef<'base' | 'disabled' | number>('base')
  const nodeIdRef = useRef<string | null>(null)
  const gizmoModeRef = useRef<GizmoMode>('translate')
  // Esc-revert support: snapshot the transform at drag start, freeze the drag
  // once cancelled so PivotControls' continuing move events are ignored.
  const startTransformRef = useRef<Transform3D | null>(null)
  const escCancelledRef = useRef(false)
  const escListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null)

  // Get the selected formation node
  const nodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0]! : null
  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined
  const isFormation = node?.type === 'formation'
  const data = isFormation ? (node!.data as FormationNodeData) : null

  // Resolve gizmo target from playhead position
  const resolved = data ? resolveGizmoTarget(data, currentTime) : null
  // O-04: locked formations show the gizmo greyed-out and refuse drag input.
  const isLocked = !!data?.locked
  const editTarget = resolved?.editTarget ?? 'disabled'
  const displayTransform = resolved?.displayTransform ?? null
  const isEditable = editTarget !== 'disabled' && !isLocked

  // Keep refs up to date for callbacks
  nodeIdRef.current = nodeId
  editTargetRef.current = editTarget
  gizmoModeRef.current = gizmoMode

  // Sync stable matrix from display transform every frame (only when not dragging)
  useFrame(() => {
    if (!isDraggingRef.current && displayTransform) {
      writeMatrix(stableMatrix.current, displayTransform)
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDragStart = useCallback((_props: any) => {
    snapshot('Move Formation')
    isDraggingRef.current = true
    escCancelledRef.current = false
    setDraggingGizmo(true)
    beginManip(HINT.gizmo)
    // Capture the transform we're about to edit so Esc can restore it.
    const nid = nodeIdRef.current
    const target = editTargetRef.current
    const node = nid ? useGraphStore.getState().getNode(nid) : undefined
    if (node?.type === 'formation') {
      const d = node.data as FormationNodeData
      const t = typeof target === 'number' ? d.keyframes[target]?.transform : d.transform
      startTransformRef.current = t ? structuredClone(t) : null
    }
    const onEsc = (ke: KeyboardEvent): void => {
      if (ke.key !== 'Escape' || !isDraggingRef.current) return
      escCancelledRef.current = true
      const start = startTransformRef.current
      const id = nodeIdRef.current
      const tgt = editTargetRef.current
      if (start && id) {
        if (typeof tgt === 'number') updateKeyframe(id, tgt, { transform: start })
        else updateNodeData(id, { transform: start } as Partial<FormationNodeData>)
      }
    }
    escListenerRef.current = onEsc
    window.addEventListener('keydown', onEsc)
  }, [snapshot, setDraggingGizmo, updateKeyframe, updateNodeData])

  const handleDrag = useCallback((
    local: THREE.Matrix4,
    _deltaL: THREE.Matrix4,
    _world: THREE.Matrix4,
    _deltaW: THREE.Matrix4,
  ) => {
    const nid = nodeIdRef.current
    const target = editTargetRef.current
    if (!nid || target === 'disabled' || escCancelledRef.current) return

    // Update stable matrix so PivotControls visually moves
    // (autoTransform=false means PivotControls won't do this itself)
    stableMatrix.current.copy(local)

    const newTransform = decomposeMatrix(local)

    if (typeof target === 'number') {
      updateKeyframe(nid, target, { transform: newTransform })
      return
    }

    // target === 'base'. If this formation is bound to a LOCKED build plane,
    // constrain the base-transform translation to the plane surface: project
    // the proposed world position onto the surface (u,v) and snap the gizmo
    // back to that point so it can't leave the plane.
    const node = useGraphStore.getState().getNode(nid)
    const binding = node?.type === 'formation' ? (node.data as FormationNodeData).planeBinding : undefined
    const plane = binding ? usePlanesStore.getState().getPlane(binding.planeId) : undefined
    if (binding && plane && plane.locked) {
      const { u, v } = worldToPlaneSurface(newTransform.position, plane)
      const onSurface = planeSurfaceToWorld({ u, v }, plane)
      newTransform.position = onSurface
      stableMatrix.current.setPosition(onSurface.x, onSurface.y, onSurface.z)
      updateNodeData(nid, {
        transform: newTransform,
        planeBinding: { planeId: plane.id, u, v },
      } as Partial<FormationNodeData>)
      return
    }

    // Smart-guide alignment: snap the dragged center to peer formation centers
    // per axis (Figma-style), drawing guide lines for the snapped axes. Only in
    // translate mode (rotate/scale don't move the anchor meaningfully here).
    if (gizmoModeRef.current === 'translate') {
      const peers = useGraphStore.getState().nodes
        .filter((n) => n.type === 'formation' && n.id !== nid)
        .map((n) => ({ id: n.id, position: (n.data as FormationNodeData).transform.position }))
      const snap = computeSnapGuides(newTransform.position, peers)
      newTransform.position = snap.position
      stableMatrix.current.setPosition(snap.position.x, snap.position.y, snap.position.z)
      publishSnapGuides(snap.guides)
    }

    updateNodeData(nid, { transform: newTransform } as Partial<FormationNodeData>)
  }, [updateKeyframe, updateNodeData])

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false
    escCancelledRef.current = false
    setDraggingGizmo(false)
    endManip()
    clearSnapGuides()
    if (escListenerRef.current) {
      window.removeEventListener('keydown', escListenerRef.current)
      escListenerRef.current = null
    }
  }, [setDraggingGizmo])

  // Hide gizmo during playback to prevent janky enabled/disabled flashing
  if (isPlaying) return null
  if (!isFormation || !displayTransform || !nodeId) return null

  return (
    <PivotControls
      key={nodeId}
      matrix={stableMatrix.current}
      autoTransform={false}
      enabled={isEditable}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      scale={75}
      fixed
      lineWidth={2}
      depthTest={false}
      axisColors={isEditable ? ['#ff4060', '#40ff60', '#4060ff'] : ['#555', '#555', '#555']}
      hoveredColor="#ffff40"
      disableAxes={gizmoMode !== 'translate'}
      disableSliders={gizmoMode !== 'translate'}
      disableRotations={gizmoMode !== 'rotate'}
      disableScaling={gizmoMode !== 'scale'}
      annotations={isEditable}
      opacity={isEditable ? 1 : 0.25}
    >
      {/* Wireframe marker at the formation center */}
      <mesh>
        <sphereGeometry args={[0.5, 12, 12]} />
        <meshBasicMaterial
          color={isEditable ? '#ffff40' : '#666666'}
          wireframe
          transparent
          opacity={isEditable ? 0.3 : 0.15}
        />
      </mesh>
    </PivotControls>
  )
}

// O-06: when 2+ formations are selected, render an amber translate-only
// PivotControls at the selection centroid. Dragging applies the world-space
// delta to each eligible formation's edit target (keyframe at the playhead,
// or base transform). Formations between keyframes ("disabled" target) are
// skipped — they'd otherwise see edits silently discarded by the eval. Only
// translate is exposed; rotate/scale around a moving centroid is a separate
// design question and not part of this iteration.
type MultiDragTarget = {
  nodeId: string
  target: 'base' | number
  startTransform: Transform3D
}

const _dragCenterStart = new THREE.Vector3()
const _dragCenterCur = new THREE.Vector3()
const _dragQuat = new THREE.Quaternion()
const _dragScl = new THREE.Vector3()

export function MultiSelectGizmo() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const nodes = useGraphStore((s) => s.nodes)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const updateKeyframe = useGraphStore((s) => s.updateKeyframe)
  const setDraggingGizmo = useViewStore((s) => s.setDraggingGizmo)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const isPlaying = usePlayheadStore((s) => s.isPlaying)

  const stableMatrix = useRef(new THREE.Matrix4())
  const isDraggingRef = useRef(false)
  const dragTargetsRef = useRef<MultiDragTarget[]>([])
  const dragStartCentroidRef = useRef<{ x: number; y: number; z: number } | null>(null)
  const eligibleRef = useRef<Array<{ nodeId: string; data: FormationNodeData; target: 'base' | number; displayTransform: Transform3D }>>([])

  // Recompute eligibility every render (cheap — bounded by selection size).
  // O-04: locked formations are excluded so the centroid + drag delta only
  // accounts for unlocked targets.
  const eligible: typeof eligibleRef.current = []
  for (const id of selectedNodeIds) {
    const n = nodes.find((x) => x.id === id)
    if (!n || n.type !== 'formation') continue
    const d = n.data as FormationNodeData
    if (d.locked) continue
    const r = resolveGizmoTarget(d, currentTime)
    if (r.editTarget === 'disabled') continue
    eligible.push({ nodeId: id, data: d, target: r.editTarget, displayTransform: r.displayTransform })
  }
  eligibleRef.current = eligible

  // Sync the gizmo matrix to the centroid every frame (only when not dragging).
  useFrame(() => {
    if (isDraggingRef.current) return
    const arr = eligibleRef.current
    if (arr.length < 2) return
    let cx = 0, cy = 0, cz = 0
    for (const e of arr) {
      cx += e.displayTransform.position.x
      cy += e.displayTransform.position.y
      cz += e.displayTransform.position.z
    }
    cx /= arr.length
    cy /= arr.length
    cz /= arr.length
    stableMatrix.current.identity()
    stableMatrix.current.setPosition(cx, cy, cz)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDragStart = useCallback((_props: any) => {
    const arr = eligibleRef.current
    if (arr.length < 2) return
    snapshot(`Move ${arr.length} formations`)
    isDraggingRef.current = true
    setDraggingGizmo(true)
    beginManip(`Move ${arr.length} formations`)
    // Capture centroid + each target's start transform so we can apply a
    // shared delta on each drag tick without re-deriving from a moving matrix.
    let cx = 0, cy = 0, cz = 0
    const targets: MultiDragTarget[] = []
    for (const e of arr) {
      cx += e.displayTransform.position.x
      cy += e.displayTransform.position.y
      cz += e.displayTransform.position.z
      const startTransform = e.target === 'base'
        ? e.data.transform
        : e.data.keyframes[e.target]!.transform
      targets.push({ nodeId: e.nodeId, target: e.target, startTransform })
    }
    dragStartCentroidRef.current = { x: cx / arr.length, y: cy / arr.length, z: cz / arr.length }
    dragTargetsRef.current = targets
  }, [snapshot, setDraggingGizmo])

  const handleDrag = useCallback((local: THREE.Matrix4) => {
    const start = dragStartCentroidRef.current
    if (!start) return
    stableMatrix.current.copy(local)
    local.decompose(_dragCenterCur, _dragQuat, _dragScl)
    const dx = _dragCenterCur.x - start.x
    const dy = _dragCenterCur.y - start.y
    const dz = _dragCenterCur.z - start.z
    for (const t of dragTargetsRef.current) {
      const newTransform: Transform3D = {
        ...t.startTransform,
        position: {
          x: t.startTransform.position.x + dx,
          y: t.startTransform.position.y + dy,
          z: t.startTransform.position.z + dz,
        },
      }
      if (t.target === 'base') {
        updateNodeData(t.nodeId, { transform: newTransform } as Partial<FormationNodeData>)
      } else {
        updateKeyframe(t.nodeId, t.target, { transform: newTransform })
      }
    }
  }, [updateKeyframe, updateNodeData])

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false
    setDraggingGizmo(false)
    endManip()
    dragStartCentroidRef.current = null
    dragTargetsRef.current = []
  }, [setDraggingGizmo])

  // Touch unused refs to keep ESLint happy in non-dev builds
  void _dragCenterStart

  if (isPlaying) return null
  if (eligible.length < 2) return null

  return (
    <PivotControls
      matrix={stableMatrix.current}
      autoTransform={false}
      enabled
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      scale={90}
      fixed
      lineWidth={2.5}
      depthTest={false}
      axisColors={['#fbbf24', '#fcd34d', '#fde68a']}
      hoveredColor="#ffff80"
      disableRotations
      disableScaling
      annotations
    >
      <mesh>
        <sphereGeometry args={[0.7, 16, 16]} />
        <meshBasicMaterial color="#fbbf24" wireframe transparent opacity={0.35} />
      </mesh>
    </PivotControls>
  )
}
