// ============================================================================
// L2 (2026-05-21) — DirectionHandle: drag an arrow on the XZ plane to set a
// 2D unit vector. Used by drift, cascade, sweep, and similar behaviours that
// take a horizontal direction. Optionally allows the Y component too via a
// modifier.
//
// Visual: a small sphere at the arrow tip, rendered at `anchor + direction *
// length`. Dragging the sphere on the XZ plane updates the direction unit
// vector; Shift snaps to 45° increments. Length is fixed for UI; the
// underlying vector is always unit-magnitude.
// ============================================================================

import { useCallback, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { pushGrabCursor, popGrabCursor, beginManip, endManip, HINT } from '../manipulation/manipulationKit'

export interface DirectionHandleProps {
  /** World-space pivot (the tail of the arrow). */
  anchor: { x: number; y: number; z: number }
  /** Current unit direction. */
  direction: { x: number; y: number; z: number }
  onChange: (next: { x: number; y: number; z: number }) => void
  onCommit?: (next: { x: number; y: number; z: number }) => void
  /** Arrow visual length in world units. */
  length?: number
  color?: string
}

const HANDLE_PX = 14
const SNAP_DEG = 45

export function DirectionHandle({
  anchor,
  direction,
  onChange,
  onCommit,
  length = 3,
  color = '#a855f7',
}: DirectionHandleProps) {
  const { camera, size, gl } = useThree()
  const [hovered, setHovered] = useState(false)
  const dragRef = useRef<{ start: { x: number; y: number; z: number }; lastValid: { x: number; y: number; z: number } } | null>(null)
  const escListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null)

  // Tip position in world space.
  const tip = new Vector3(
    anchor.x + direction.x * length,
    anchor.y + direction.y * length,
    anchor.z + direction.z * length,
  )
  const distance = tip.distanceTo(camera.position)
  const fovRad = (camera as { fov?: number }).fov !== undefined
    ? ((camera as unknown as { fov: number }).fov * Math.PI) / 180
    : Math.PI / 4
  const worldPerPx = (2 * Math.tan(fovRad / 2) * distance) / size.height
  const scale = HANDLE_PX * worldPerPx

  const begin = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { start: { ...direction }, lastValid: { ...direction } }
    beginManip(HINT.direction)
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
  }, [direction, onChange])

  const move = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return
    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
    const ray = new Raycaster()
    ray.setFromCamera(new Vector2(ndcX, ndcY), camera)
    // Drag along XZ plane through the anchor.
    const plane = new Plane(new Vector3(0, 1, 0), -anchor.y)
    const hit = new Vector3()
    if (!ray.ray.intersectPlane(plane, hit)) return
    let dx = hit.x - anchor.x
    let dz = hit.z - anchor.z
    if (dx === 0 && dz === 0) return
    if (e.nativeEvent.shiftKey) {
      // Snap to nearest 45° increment.
      const ang = Math.atan2(dz, dx)
      const snapRad = (Math.PI / 180) * SNAP_DEG
      const snapped = Math.round(ang / snapRad) * snapRad
      dx = Math.cos(snapped)
      dz = Math.sin(snapped)
    } else {
      const mag = Math.hypot(dx, dz)
      dx /= mag
      dz /= mag
    }
    const next = { x: dx, y: 0, z: dz }
    dragRef.current.lastValid = next
    onChange(next)
  }, [anchor.x, anchor.y, anchor.z, camera, gl.domElement, onChange])

  const end = useCallback(() => {
    if (dragRef.current && onCommit) onCommit(dragRef.current.lastValid)
    dragRef.current = null
    endManip()
    if (escListenerRef.current) {
      window.removeEventListener('keydown', escListenerRef.current)
      escListenerRef.current = null
    }
  }, [onCommit])

  // Arrow line + tip group, positioned at the arrow tip.
  const tipColor = hovered || dragRef.current ? '#ffffff' : color
  return (
    <>
      {/* Shaft */}
      <line>
        <bufferGeometry attach="geometry">
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([anchor.x, anchor.y, anchor.z, tip.x, tip.y, tip.z]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial attach="material" color={tipColor} transparent opacity={0.7} />
      </line>
      {/* Tip */}
      <group position={[tip.x, tip.y, tip.z]} scale={[scale, scale, scale]}>
        <mesh
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerOver={() => { setHovered(true); pushGrabCursor() }}
          onPointerOut={() => { setHovered(false); popGrabCursor() }}
        >
          <coneGeometry args={[0.6, 1.2, 8]} />
          <meshBasicMaterial color={tipColor} transparent opacity={0.9} />
        </mesh>
      </group>
    </>
  )
}
