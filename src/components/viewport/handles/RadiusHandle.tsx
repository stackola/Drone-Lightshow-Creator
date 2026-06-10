// ============================================================================
// L2 (2026-05-21) — RadiusHandle: drag-along-axis handle for editing a scalar
// distance from a center point. First handle primitive in the L2 library;
// used by ring/sphere/spiral/circle-based idles to expose `params.radius`
// as a direct-manipulation control instead of a form field.
//
// Design choices:
//  • Screen-constant size at all zoom levels (handles don't disappear when
//    you zoom out, don't dominate when you zoom in).
//  • Drag is projected onto the axis ray — the cursor's motion in screen
//    space is mapped to a delta along the world-space axis.
//  • Hold Shift while dragging to snap to integer metres.
//  • ESC during drag reverts.
//  • Calls onChange continuously during drag; onCommit fires once at end.
// ============================================================================

import { useRef, useCallback, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector2, Vector3, Plane, Raycaster } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { pushGrabCursor, popGrabCursor, beginManip, endManip, HINT } from '../manipulation/manipulationKit'
import { ACCENT_PRIMARY } from '../../../ui/colors'

export interface RadiusHandleProps {
  /** World-space anchor — the centre of the radius. */
  center: { x: number; y: number; z: number }
  /** Unit-length world-space axis the handle slides along. */
  axis: { x: number; y: number; z: number }
  /** Current radius. */
  radius: number
  /** Continuous update during drag. */
  onChange: (radius: number) => void
  /** Optional one-shot at drag end. Use for history snapshots. */
  onCommit?: (radius: number) => void
  /** Optional minimum radius (default 0). */
  min?: number
  /** Optional colour override. */
  color?: string
}

const HANDLE_PX = 14 // target on-screen size in CSS pixels
const SNAP_INTERVAL = 1.0 // shift-snap in metres

export function RadiusHandle({
  center,
  axis,
  radius,
  onChange,
  onCommit,
  min = 0,
  color = ACCENT_PRIMARY,
}: RadiusHandleProps) {
  const { camera, size, gl } = useThree()
  const [hovered, setHovered] = useState(false)
  const dragRef = useRef<{ startRadius: number; lastValid: number } | null>(null)
  const escListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null)

  // Position is computed each render so the handle follows live updates.
  const pos = new Vector3(
    center.x + axis.x * radius,
    center.y + axis.y * radius,
    center.z + axis.z * radius,
  )

  // Map a target screen-space pixel size to a world-space scale that keeps
  // the handle visually constant. Using `position.distanceTo(camera.position)`
  // approximates perspective. Re-evaluated each frame via the JSX scale prop.
  const distance = pos.distanceTo(camera.position)
  const fovRad = (camera as { fov?: number }).fov !== undefined
    ? ((camera as unknown as { fov: number }).fov * Math.PI) / 180
    : Math.PI / 4 // ortho fallback
  const worldPerPx = (2 * Math.tan(fovRad / 2) * distance) / size.height
  const scale = HANDLE_PX * worldPerPx

  const beginDrag = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { startRadius: radius, lastValid: radius }
    beginManip(HINT.radius)
    // ESC reverts.
    const onEsc = (ke: KeyboardEvent): void => {
      if (ke.key === 'Escape' && dragRef.current) {
        onChange(dragRef.current.startRadius)
        dragRef.current = null
        endManip()
        if (escListenerRef.current) window.removeEventListener('keydown', escListenerRef.current)
        escListenerRef.current = null
      }
    }
    escListenerRef.current = onEsc
    window.addEventListener('keydown', onEsc)
  }, [radius, onChange])

  // Project the pointer ray onto the line {center + t·axis}. Solve for t.
  const projectPointerToAxis = useCallback((event: PointerEvent): number | null => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1
    const raycaster = new Raycaster()
    raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera)
    // Define a plane that contains the axis and faces the camera roughly —
    // pick the plane perpendicular to (camera→axis cross axis). Intersection
    // with the pointer ray gives us a point near the axis line.
    const axisV = new Vector3(axis.x, axis.y, axis.z).normalize()
    const centerV = new Vector3(center.x, center.y, center.z)
    const camDir = new Vector3()
    camera.getWorldDirection(camDir)
    const planeNormal = new Vector3().crossVectors(axisV, new Vector3().crossVectors(axisV, camDir)).normalize()
    if (planeNormal.lengthSq() < 1e-6) return null
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, centerV)
    const hit = new Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return null
    // Project (hit - center) onto axisV.
    const t = hit.sub(centerV).dot(axisV)
    return t
  }, [axis, center, camera, gl.domElement])

  const handleMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return
    const t = projectPointerToAxis(e.nativeEvent)
    if (t === null) return
    let next = Math.max(min, t)
    if (e.shiftKey) next = Math.round(next / SNAP_INTERVAL) * SNAP_INTERVAL
    dragRef.current.lastValid = next
    onChange(next)
  }, [min, onChange, projectPointerToAxis])

  const endDrag = useCallback(() => {
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
        onPointerDown={beginDrag}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerOver={() => { setHovered(true); pushGrabCursor() }}
        onPointerOut={() => { setHovered(false); popGrabCursor() }}
      >
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={hovered || dragRef.current ? '#ffffff' : color} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}
