import { useRef, useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import { useFormationStore } from '../stores/formationStore'
import { interpolateDroneAt, interpolateColorAt } from '../services/validator'
import { Play, Pause } from 'lucide-react'

function DroneCloud() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const colorObj = useMemo(() => new THREE.Color(), [])
  const timeRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [frame, setFrame] = useState(0)

  // Subscribe to store for reactive updates
  const drones = useFormationStore((s) => s.drones)
  const totalFrames = useFormationStore((s) => s.totalFrames)

  useFrame((_, delta) => {
    if (!meshRef.current || drones.length === 0) return

    if (playing) {
      timeRef.current += delta * 24 // advance in frames
      if (timeRef.current > totalFrames) timeRef.current = 0
      setFrame(Math.floor(timeRef.current))
    }

    const currentFrame = playing ? Math.floor(timeRef.current) : frame

    for (let i = 0; i < drones.length; i++) {
      const d = drones[i]!
      const pos = interpolateDroneAt(d.positionKeyframes, currentFrame)
      if (pos) {
        // ENU → Three.js: X→X, Y→Z, Z→Y (Three.js is Y-up, ENU is Z-up)
        dummy.position.set(pos.x, pos.z, -pos.y)
        dummy.scale.setScalar(0.25)
      } else {
        dummy.position.set(0, -100, 0)
        dummy.scale.setScalar(0)
      }
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)

      // Color: RGBW → RGB for display (W adds to all channels)
      const col = interpolateColorAt(d.colorKeyframes, currentFrame)
      const r = Math.min(1, (col.r + col.w) / 255)
      const g = Math.min(1, (col.g + col.w) / 255)
      const b = Math.min(1, (col.b + col.w) / 255)
      meshRef.current.setColorAt(i, colorObj.setRGB(r, g, b))
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  })

  // Expose play/pause and scrubber via a portal div
  return (
    <>
      <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, drones.length)]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshStandardMaterial />
      </instancedMesh>

      {/* HUD overlay rendered via drei Html would be complex, so we use a separate React portal — see Timeline component */}
      <PlaybackController playing={playing} setPlaying={setPlaying} frame={frame} setFrame={(f) => { setFrame(f); timeRef.current = f }} totalFrames={totalFrames} />
    </>
  )
}

// This is a no-op Three.js component that syncs playback state to a global for the Timeline UI
function PlaybackController({ playing, setPlaying, frame, setFrame, totalFrames }: {
  playing: boolean; setPlaying: (v: boolean) => void; frame: number; setFrame: (f: number) => void; totalFrames: number
}) {
  // Store in a global so Timeline component can read/write
  ;(window as unknown as Record<string, unknown>).__playback = { playing, setPlaying, frame, setFrame, totalFrames }
  return null
}

export function Preview3D() {
  const droneCount = useFormationStore((s) => s.drones.length)
  const violations = useFormationStore((s) => s.violations)

  return (
    <div className="h-full w-full relative">
      <Canvas>
        <PerspectiveCamera makeDefault position={[0, 20, 30]} fov={50} />
        <OrbitControls target={[0, 5, 0]} enableDamping dampingFactor={0.1} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[20, 30, 10]} intensity={0.8} />
        <hemisphereLight args={['#b1e1ff', '#b97a20', 0.3]} />
        <Grid args={[100, 100]} cellSize={2} cellThickness={0.5} cellColor="#1e293b" sectionSize={10} sectionThickness={1} sectionColor="#334155" fadeDistance={80} infiniteGrid />
        <DroneCloud />
      </Canvas>

      {/* Status overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-slate-900/80 border-t border-white/10 px-3 py-1.5 flex items-center gap-4 text-[10px] text-white/40">
        <span>{droneCount} drones</span>
        <span>{(useFormationStore.getState().totalFrames / 24).toFixed(1)}s</span>
        {violations.length > 0
          ? <span className="text-red-400">{violations.length} violation{violations.length !== 1 ? 's' : ''}</span>
          : droneCount > 0 && <span className="text-green-400">Valid</span>
        }
        <div className="flex-1" />
        <Timeline />
      </div>
    </div>
  )
}

function Timeline() {
  const pb = (window as unknown as Record<string, unknown>).__playback as {
    playing: boolean; setPlaying: (v: boolean) => void; frame: number; setFrame: (f: number) => void; totalFrames: number
  } | undefined

  if (!pb || pb.totalFrames <= 0) return null

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => pb.setPlaying(!pb.playing)} className="text-white/50 hover:text-white/80">
        {pb.playing ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <input type="range" min={0} max={pb.totalFrames} value={pb.frame}
        onChange={(e) => { pb.setPlaying(false); pb.setFrame(Number(e.target.value)) }}
        className="w-32 h-1 accent-blue-500" />
      <span className="text-[9px] text-white/30 w-10">{(pb.frame / 24).toFixed(1)}s</span>
    </div>
  )
}
