// ============================================================================
// B-01 — drone-hover indicator. Listens for `drone-hover` window events
// dispatched by DroneCloud's pointer handlers, looks up the hovered drone's
// live position via the shared evaluationStore, and renders a small wireframe
// sphere + altitude label at it. Renders nothing when no drone is hovered.
// ============================================================================

import { useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { peekDroneStates } from '../../stores/evaluationStore'
import type { Vec3 } from '../../graph/types'
import { ACCENT_PRIMARY } from '../../ui/colors'

export function DroneHoverIndicator() {
  const [hoveredIdx, setHoveredIdx] = useState(-1)
  const [pos, setPos] = useState<Vec3 | null>(null)

  useEffect(() => {
    const onHover = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { droneIndex?: number } | undefined
      setHoveredIdx(detail?.droneIndex ?? -1)
    }
    window.addEventListener('drone-hover', onHover)
    return () => window.removeEventListener('drone-hover', onHover)
  }, [])

  // Sample the hovered drone's position every frame from the shared eval
  // store. The store is refreshed at renderPriority=-1 by <EvaluatorTick />,
  // so by the time DroneCloud + this component's default-priority useFrames
  // run, the data is fresh for the current frame.
  useFrame(() => {
    if (hoveredIdx < 0) {
      if (pos !== null) setPos(null)
      return
    }
    const states = peekDroneStates()
    if (!states) return
    const s = states[hoveredIdx]
    if (s) {
      // Only update React state when the position actually changes (cheap
      // dedupe to avoid render storms during scrubbing).
      if (!pos || pos.x !== s.position.x || pos.y !== s.position.y || pos.z !== s.position.z) {
        setPos({ ...s.position })
      }
    }
  })

  if (hoveredIdx < 0 || !pos) return null

  return (
    <group position={[pos.x, pos.y, pos.z]}>
      {/* Wireframe ring around the drone */}
      <mesh>
        <torusGeometry args={[0.55, 0.04, 8, 32]} />
        <meshBasicMaterial color={ACCENT_PRIMARY} transparent opacity={0.85} />
      </mesh>
      {/* Floating label with index + full position */}
      <Html position={[0, 0.9, 0]} center distanceFactor={20}>
        <div className="pointer-events-none whitespace-nowrap rounded bg-surface-raised/90 border border-cyan-500/40 px-1.5 py-0.5 text-micro font-mono text-cyan-200 shadow-xl backdrop-blur-sm">
          <span className="text-cyan-100 font-semibold">#{hoveredIdx}</span>
          <span className="text-white/40 mx-1">·</span>
          <span>x={pos.x.toFixed(1)}</span>
          <span className="text-white/30 mx-0.5">,</span>
          <span>y={pos.y.toFixed(1)}</span>
          <span className="text-white/30 mx-0.5">,</span>
          <span>z={pos.z.toFixed(1)}</span>
          <span className="text-white/40">m</span>
        </div>
      </Html>
    </group>
  )
}
