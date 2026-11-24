import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { evaluate } from '@/core/evaluate'
import { getState, useStore } from '@/state/store'
import { simPositions } from '@/state/sim'
import { sceneAt, sceneIdOfDroneAt } from '@/core/evaluate'
import type { ThreeEvent } from '@react-three/fiber'
import { gizmoJustUsed } from './Manipulator'

/** Click a drone: select the formation it belongs to at the playhead. */
function pickDrone(e: ThreeEvent<MouseEvent>) {
  if (e.delta > 4 || gizmoJustUsed()) return
  const s = getState()
  const c = s.compiled
  if (!c) return
  e.stopPropagation()
  const at = sceneAt(c, s.time)
  // During a split, each group is on its own formation: pick the clicked drone's.
  const own = at.phase === 'groups' && typeof e.index === 'number' ? sceneIdOfDroneAt(c, s.time, e.index) : null
  const scene = at.scene >= 0 ? s.doc.scenes[at.scene] : null
  if (own) s.select({ kind: 'scene', id: own })
  else if (scene) s.select({ kind: 'scene', id: scene.id })
  else s.select({ kind: at.phase === 'takeoff' ? 'takeoff' : 'landing' })
}

/** Latest drone positions (shared with overlays such as issue markers). */
export const frame = { positions: new Float32Array(0) }

const vertex = /* glsl */ `
  attribute vec3 color;
  uniform float uSize;
  uniform float uScale;
  uniform float uShowDark;
  varying vec3 vColor;
  varying float vDark;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float lum = max(color.r, max(color.g, color.b));
    vDark = (1.0 - smoothstep(0.0, 0.04, lum)) * uShowDark;
    vColor = color;
    gl_PointSize = clamp(uSize * uScale / -mv.z, 2.2, 64.0);
  }
`

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vDark;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float core = smoothstep(0.16, 0.0, d);
    float glow = exp(-d * 5.0) * 0.55;
    vec3 c = vColor * (core * 1.6 + glow) + core * 0.35 * vColor;
    // Lights-off drones: a faint grey dot while editing so they stay findable.
    c += vec3(0.28, 0.31, 0.38) * vDark * smoothstep(0.25, 0.0, d);
    gl_FragColor = vec4(c, 1.0);
  }
`

export function Drones({ present }: { present: boolean }) {
  const n = useStore((s) => s.compiled?.n ?? 0)
  const geoRef = useRef<THREE.BufferGeometry>(null)
  const { positions, colors } = useMemo(() => ({ positions: new Float32Array(Math.max(1, n) * 3), colors: new Float32Array(Math.max(1, n) * 3) }), [n])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uSize: { value: 2.6 }, uScale: { value: 600 }, uShowDark: { value: present ? 0 : 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [present],
  )

  useFrame(({ size, camera }) => {
    const s = getState()
    const c = s.compiled
    const geo = geoRef.current
    if (!c || !geo || c.n !== n) return
    evaluate(c, s.time, positions, colors)
    // Wind test playback: real (simulated) positions, planned colours.
    if (!present) simPositions(c, s.time, positions)
    frame.positions = positions
    const pa = geo.getAttribute('position') as THREE.BufferAttribute
    const ca = geo.getAttribute('color') as THREE.BufferAttribute
    pa.needsUpdate = true
    ca.needsUpdate = true
    geo.setDrawRange(0, n)
    // Pixel scale for perspective size attenuation.
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45
    material.uniforms.uScale!.value = size.height / (2 * Math.tan((fov * Math.PI) / 360))
  })

  if (!n) return null
  return (
    <points frustumCulled={false} material={material} onClick={present ? undefined : pickDrone}>
      <bufferGeometry ref={geoRef} key={n}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
    </points>
  )
}
