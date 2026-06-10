// ============================================================================
// Bundle 6: Drone Motion Trails
// ============================================================================
// For each drone (capped to a max for perf), sample positions over a window
// around the playhead and render them as line strips. Lets the author SEE the
// motion ahead of and behind the current frame.
// ============================================================================

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useViewStore } from '../../stores/viewStore'
import { useGraphStore } from '../../stores/graphStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { useProjectStore } from '../../stores/projectStore'
import { useFormationStore } from '../../stores/formationStore'
import { evaluateAtTime } from '../../graph/evaluate'
import { toTransitionConstraints } from '../../registries/transitions'
import type { Vec3 } from '../../graph/types'

const MAX_DRONES = 64

export function DroneTrails() {
  const enabled = useViewStore((s) => s.trails.enabled)
  if (!enabled) return null
  return <DroneTrailsInner />
}

function DroneTrailsInner() {
  const groupRef = useRef<THREE.Group>(null)
  const lineRefs = useRef<THREE.Line[]>([])
  const linesInitialized = useRef(false)
  const droneCount = useProjectStore((s) => s.dronePool.droneCount)
  const trails = useViewStore((s) => s.trails)

  const drawnCount = Math.min(droneCount, MAX_DRONES)
  const points = useMemo(() => trails.samples, [trails.samples])

  // Allocate Line objects + geometry once per drawnCount / samples
  if (!linesInitialized.current && groupRef.current) {
    const grp = groupRef.current
    while (grp.children.length > 0) {
      const c = grp.children[0]!
      grp.remove(c)
      if ((c as THREE.Line).geometry) (c as THREE.Line).geometry.dispose()
    }
    lineRefs.current = []
    for (let i = 0; i < drawnCount; i++) {
      const geom = new THREE.BufferGeometry()
      const positions = new Float32Array(points * 3)
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const mat = new THREE.LineBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.35,
      })
      const line = new THREE.Line(geom, mat)
      grp.add(line)
      lineRefs.current.push(line)
    }
    linesInitialized.current = true
  }

  useFrame(() => {
    if (lineRefs.current.length === 0) return
    const { nodes, edges } = useGraphStore.getState()
    const { currentTime } = usePlayheadStore.getState()
    const { generatedPoints, animatedDefs } = useFormationStore.getState()
    const homePositions = useProjectStore.getState().dronePool.homePositions
    const projectConstraints = useProjectStore.getState().constraints
    const graph = { nodes, edges }

    const formationsMap = new Map<string, Vec3[]>()
    generatedPoints.forEach((pts, id) => formationsMap.set(id, pts))

    const window = trails.windowSec
    const N = points
    const start = currentTime - window / 2
    const dt = window / Math.max(1, N - 1)

    // Sample for each step
    const sampled: number[][] = []
    for (let s = 0; s < N; s++) {
      const t = Math.max(0, start + s * dt)
      const states = evaluateAtTime(graph, formationsMap, t, homePositions, animatedDefs, {
        constraints: toTransitionConstraints(projectConstraints),
      })
      const frame: number[] = []
      for (let i = 0; i < drawnCount; i++) {
        const st = states[i]
        if (st) {
          frame.push(st.position.x, st.position.y, st.position.z)
        } else {
          frame.push(0, -1000, 0)
        }
      }
      sampled.push(frame)
    }

    for (let i = 0; i < drawnCount; i++) {
      const line = lineRefs.current[i]
      if (!line) continue
      const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      for (let s = 0; s < N; s++) {
        const f = sampled[s]
        if (!f) continue
        arr[s * 3] = f[i * 3]!
        arr[s * 3 + 1] = f[i * 3 + 1]!
        arr[s * 3 + 2] = f[i * 3 + 2]!
      }
      pos.needsUpdate = true
    }
  })

  return <group ref={groupRef} />
}
