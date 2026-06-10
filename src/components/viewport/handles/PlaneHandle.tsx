// ============================================================================
// L2 (2026-05-21) — PlaneHandle: drag a flat ring/disc to tilt a normal vector.
// Used by ring/line/arc-style formations to angle their reference plane in 3D.
// The handle is a translucent disc; dragging the rim rotates the plane around
// an in-plane tangent axis chosen perpendicular to the drag direction.
// ============================================================================

import { useCallback, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { ThreeEvent } from '@react-three/fiber'

export interface PlaneHandleProps {
  /** Anchor in world space — centre of the disc. */
  anchor: { x: number; y: number; z: number }
  /** Current unit normal of the plane. */
  normal: { x: number; y: number; z: number }
  onChange: (next: { x: number; y: number; z: number }) => void
  onCommit?: (next: { x: number; y: number; z: number }) => void
  /** Disc radius in world units. */
  radius?: number
  color?: string
}

export function PlaneHandle({
  anchor,
  normal,
  onChange,
  onCommit,
  radius = 2,
  color = '#34d399',
}: PlaneHandleProps) {
  const { camera, gl } = useThree()
  const [hovered, setHovered] = useState(false)
  const dragRef = useRef<{ start: { x: number; y: number; z: number }; lastValid: { x: number; y: number; z: number } } | null>(null)
  const escListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null)

  const n = new Vector3(normal.x, normal.y, normal.z).normalize()

  const begin = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { start: { ...normal }, lastValid: { ...normal } }
    const onEsc = (ke: KeyboardEvent): void => {
      if (ke.key === 'Escape' && dragRef.current) {
        onChange(dragRef.current.start)
        dragRef.current = null
        if (escListenerRef.current) window.removeEventListener('keydown', escListenerRef.current)
        escListenerRef.current = null
      }
    }
    escListenerRef.current = onEsc
    window.addEventListener('keydown', onEsc)
  }, [normal, onChange])

  // Drag: project the pointer ray to a camera-facing plane through `anchor`,
  // measure the projected vector from anchor. The new normal is set to that
  // vector normalised — i.e. the surface "tips toward" wherever you dragged.
  const move = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return
    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
    const ray = new Raycaster()
    ray.setFromCamera(new Vector2(ndcX, ndcY), camera)
    const camDir = new Vector3()
    camera.getWorldDirection(camDir)
    const plane = new Plane().setFromNormalAndCoplanarPoint(camDir, new Vector3(anchor.x, anchor.y, anchor.z))
    const hit = new Vector3()
    if (!ray.ray.intersectPlane(plane, hit)) return
    const delta = hit.sub(new Vector3(anchor.x, anchor.y, anchor.z))
    const len = delta.length()
    if (len < 1e-3) return
    // Bias toward up-vector when delta is short, to keep behaviour stable.
    const upBias = Math.max(0.1, 1 - len / (radius * 2))
    const tipped = new Vector3(delta.x, len + upBias * radius, delta.z).normalize()
    const next = { x: tipped.x, y: tipped.y, z: tipped.z }
    dragRef.current.lastValid = next
    onChange(next)
  }, [anchor.x, anchor.y, anchor.z, camera, gl.domElement, onChange, radius])

  const end = useCallback(() => {
    if (dragRef.current && onCommit) onCommit(dragRef.current.lastValid)
    dragRef.current = null
    if (escListenerRef.current) {
      window.removeEventListener('keydown', escListenerRef.current)
      escListenerRef.current = null
    }
  }, [onCommit])

  // Orient the disc so its local +Z aligns with `n`. Quaternion from (0,0,1)
  // to `n`. We use the rotation via lookAt by setting object's up. Three.js
  // doesn't expose quaternion directly here — compute via Euler from the
  // angle between up Y and the normal.
  // Use a hack: align via two rotations around X (pitch) and Z (yaw).
  const pitch = Math.acos(Math.max(-1, Math.min(1, n.y))) // angle from world Y
  const yaw = Math.atan2(n.x, n.z) // around Y

  const baseColor = hovered || dragRef.current ? '#ffffff' : color

  return (
    <group position={[anchor.x, anchor.y, anchor.z]} rotation={[pitch, yaw, 0]}>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true) }}
        onPointerOut={() => setHovered(false)}
      >
        <ringGeometry args={[radius * 0.85, radius, 48]} />
        <meshBasicMaterial color={baseColor} transparent opacity={0.45} side={2} />
      </mesh>
      {/* Subtle filled disc for hit testing on the centre, very translucent. */}
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
      >
        <circleGeometry args={[radius * 0.85, 48]} />
        <meshBasicMaterial color={baseColor} transparent opacity={hovered || dragRef.current ? 0.15 : 0.05} side={2} />
      </mesh>
    </group>
  )
}
