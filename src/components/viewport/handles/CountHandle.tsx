// ============================================================================
// L2 (2026-05-21) — CountHandle: +N / −N pip used for drone-count controls.
// Sits at a fixed position relative to the formation; clicking pip-up/down
// nudges the count and fires onChange. Visually distinct from RadiusHandle
// (uses cube geometry + two stacked carets instead of a draggable sphere).
// ============================================================================

import { useCallback, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { ACCENT_PRIMARY } from '../../../ui/colors'

export interface CountHandleProps {
  /** World-space anchor — the formation's transform position. */
  anchor: { x: number; y: number; z: number }
  /** Current count. */
  count: number
  /** Minimum count (default 1). */
  min?: number
  /** Maximum count (default 10_000). */
  max?: number
  /** Step per nudge (default 1; shift-click multiplies by 10). */
  step?: number
  /** Continuous update during scrub. */
  onChange: (next: number) => void
  /** Optional one-shot at the end of a scrub for history snapshots. */
  onCommit?: (next: number) => void
  /** Optional offset from the anchor (e.g. above the formation). */
  offset?: { x: number; y: number; z: number }
  /** Optional violation flag — turns the pip red when count is too high
   *  for current spacing. */
  violation?: boolean
}

const HANDLE_PX = 18

export function CountHandle({
  anchor,
  count,
  min = 1,
  max = 10_000,
  step = 1,
  onChange,
  onCommit,
  offset = { x: 0, y: 4, z: 0 },
  violation = false,
}: CountHandleProps) {
  const { camera, size } = useThree()
  const [hovered, setHovered] = useState<'up' | 'down' | null>(null)
  const pos = new Vector3(anchor.x + offset.x, anchor.y + offset.y, anchor.z + offset.z)
  const distance = pos.distanceTo(camera.position)
  const fovRad = (camera as { fov?: number }).fov !== undefined
    ? ((camera as unknown as { fov: number }).fov * Math.PI) / 180
    : Math.PI / 4
  const worldPerPx = (2 * Math.tan(fovRad / 2) * distance) / size.height
  const scale = HANDLE_PX * worldPerPx

  const nudge = useCallback((direction: 1 | -1, e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const k = e.shiftKey ? 10 : 1
    const next = Math.max(min, Math.min(max, count + direction * step * k))
    if (next !== count) {
      onChange(next)
      if (onCommit) onCommit(next)
    }
  }, [count, min, max, step, onChange, onCommit])

  const bodyColor = violation ? '#f87171' : ACCENT_PRIMARY

  return (
    <group position={[pos.x, pos.y, pos.z]} scale={[scale, scale, scale]}>
      {/* Up pip */}
      <mesh
        position={[0, 0.7, 0]}
        onClick={(e) => nudge(1, e)}
        onPointerOver={(e) => { e.stopPropagation(); setHovered('up'); if (document?.body) document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHovered((s) => (s === 'up' ? null : s)); if (document?.body) document.body.style.cursor = '' }}
      >
        <coneGeometry args={[0.55, 0.55, 3]} />
        <meshBasicMaterial color={hovered === 'up' ? '#ffffff' : bodyColor} transparent opacity={0.9} />
      </mesh>
      {/* Down pip */}
      <mesh
        position={[0, -0.7, 0]}
        rotation={[Math.PI, 0, 0]}
        onClick={(e) => nudge(-1, e)}
        onPointerOver={(e) => { e.stopPropagation(); setHovered('down'); if (document?.body) document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHovered((s) => (s === 'down' ? null : s)); if (document?.body) document.body.style.cursor = '' }}
      >
        <coneGeometry args={[0.55, 0.55, 3]} />
        <meshBasicMaterial color={hovered === 'down' ? '#ffffff' : bodyColor} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}
