// ============================================================================
// L2 (2026-05-21) — CenterHandle: translate a 3D point with axis-locked drag.
// Used by orbit/breathe/swarm/etc. to position the centre of their motion in
// world space without leaving the viewport.
//
// Implementation: project the cursor ray onto a plane through the current
// position, perpendicular to whichever world axis is most camera-facing. The
// drag delta is decomposed into the two axes orthogonal to that one.
// Shift = snap to integer metres. Ctrl/Cmd = constrain to XZ (ground plane).
// Alt = constrain to Y (vertical). ESC reverts.
// ============================================================================

import { useCallback, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { pushGrabCursor, popGrabCursor, beginManip, endManip, HINT } from '../manipulation/manipulationKit'

export interface CenterHandleProps {
  /** Current world-space position. */
  position: { x: number; y: number; z: number }
  onChange: (next: { x: number; y: number; z: number }) => void
  onCommit?: (next: { x: number; y: number; z: number }) => void
  color?: string
}

const HANDLE_PX = 16
const SNAP_INTERVAL = 1.0

export function CenterHandle({ position, onChange, onCommit, color = '#facc15' }: CenterHandleProps) {
  const { camera, size, gl } = useThree()
  const [hovered, setHovered] = useState(false)
  const dragRef = useRef<{ start: { x: number; y: number; z: number }; lastValid: { x: number; y: number; z: number }; plane: Plane; offset: Vector3 } | null>(null)
  const escListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null)

  const pos = new Vector3(position.x, position.y, position.z)
  const distance = pos.distanceTo(camera.position)
  const fovRad = (camera as { fov?: number }).fov !== undefined
    ? ((camera as unknown as { fov: number }).fov * Math.PI) / 180
    : Math.PI / 4
  const worldPerPx = (2 * Math.tan(fovRad / 2) * distance) / size.height
  const scale = HANDLE_PX * worldPerPx

  const begin = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)

    // Plane through `position`, oriented to be most facing the camera.
    const camDir = new Vector3()
    camera.getWorldDirection(camDir)
    const plane = new Plane().setFromNormalAndCoplanarPoint(camDir, pos)

    // Offset = pointer-intersect − pos (so subsequent moves preserve the
    // grab point under the cursor).
    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
    const ray = new Raycaster()
    ray.setFromCamera(new Vector2(ndcX, ndcY), camera)
    const hit = new Vector3()
    if (!ray.ray.intersectPlane(plane, hit)) return
    const offset = hit.clone().sub(pos)

    dragRef.current = {
      start: { ...position },
      lastValid: { ...position },
      plane,
      offset,
    }
    beginManip(HINT.center)

    const onEsc = (ke: KeyboardEvent): void => {
      if (ke.key === 'Escape' && dragRef.current) {
        onChange(dragRef.current.start)
        dragRef.current = null
        endManip()
        if (escListenerRef.current) window.removeEventListener('keydown', escListenerRef.current)
        escListenerRef.current = null
      }
    }
    escListenerRef.current = onEsc
    window.addEventListener('keydown', onEsc)
  }, [camera, gl.domElement, onChange, pos, position])

  const move = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return
    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
    const ray = new Raycaster()
    ray.setFromCamera(new Vector2(ndcX, ndcY), camera)
    const hit = new Vector3()
    if (!ray.ray.intersectPlane(dragRef.current.plane, hit)) return
    const candidate = hit.sub(dragRef.current.offset)

    let next = { x: candidate.x, y: candidate.y, z: candidate.z }

    // Constraint modifiers: Ctrl/Cmd = XZ only (lock Y to start.y).
    if (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) {
      next = { ...next, y: dragRef.current.start.y }
    }
    // Alt = Y only (lock X,Z).
    if (e.nativeEvent.altKey) {
      next = { x: dragRef.current.start.x, y: next.y, z: dragRef.current.start.z }
    }
    // Shift = snap each component to integer metres.
    if (e.nativeEvent.shiftKey) {
      next = {
        x: Math.round(next.x / SNAP_INTERVAL) * SNAP_INTERVAL,
        y: Math.round(next.y / SNAP_INTERVAL) * SNAP_INTERVAL,
        z: Math.round(next.z / SNAP_INTERVAL) * SNAP_INTERVAL,
      }
    }

    dragRef.current.lastValid = next
    onChange(next)
  }, [camera, gl.domElement, onChange])

  const end = useCallback(() => {
    if (dragRef.current && onCommit) onCommit(dragRef.current.lastValid)
    dragRef.current = null
    endManip()
    if (escListenerRef.current) {
      window.removeEventListener('keydown', escListenerRef.current)
      escListenerRef.current = null
    }
  }, [onCommit])

  return (
    <group position={[pos.x, pos.y, pos.z]} scale={[scale, scale, scale]}>
      <mesh
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerOver={() => { setHovered(true); pushGrabCursor() }}
        onPointerOut={() => { setHovered(false); popGrabCursor() }}
      >
        <boxGeometry args={[1.4, 1.4, 1.4]} />
        <meshBasicMaterial color={hovered || dragRef.current ? '#ffffff' : color} transparent opacity={0.85} />
      </mesh>
    </group>
  )
}
