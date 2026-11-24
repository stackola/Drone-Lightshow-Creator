import { useEffect, useMemo, useRef, type ElementRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { Drones, frame } from './Drones'
import { Manipulator, gizmoHovered, gizmoJustUsed } from './Manipulator'
import { getState, useStore, type CameraMode } from '@/state/store'
import type { Compiled } from '@/core/compile'

function presetFor(mode: CameraMode, c: Compiled | null, audience: number): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const cy = c?.stage.cy ?? 50
  const cx = c?.stage.cx ?? 0
  const r = c?.stage.r ?? 40
  switch (mode) {
    case 'audience':
      return { pos: new THREE.Vector3(0, 1.7, audience), target: new THREE.Vector3(cx, cy, 0) }
    case 'orbit':
      return { pos: new THREE.Vector3(audience * 0.62, cy + audience * 0.32, audience * 0.7), target: new THREE.Vector3(cx, cy * 0.75, 0) }
    case 'top':
      return { pos: new THREE.Vector3(0, Math.max(160, r * 4.2), 0.001), target: new THREE.Vector3(0, 0, 0) }
  }
}

const EYE = 1.7

/**
 * Vertical field of view that frames every formation from the audience: from
 * just below the horizon to above the highest drone, and the full width.
 */
function audienceFov(c: Compiled | null, dist: number, aspect: number, target: THREE.Vector3): number {
  if (!c) return 40
  const { minX, maxX, maxY } = c.stage
  const pitch = Math.atan2(target.y - EYE, dist)
  const top = Math.atan2(maxY - EYE, dist) - pitch
  const bottom = pitch - Math.atan2(-2, dist) // keep a sliver of horizon in view
  const v = 2 * Math.max(top, bottom) * 1.12
  const half = Math.atan(Math.max(Math.abs(minX), Math.abs(maxX)) / dist) * 1.12
  const h = 2 * Math.atan(Math.tan(half) / Math.max(0.3, aspect))
  return Math.min(80, Math.max(28, (Math.max(v, h) * 180) / Math.PI))
}

function CameraRig({ present }: { present: boolean }) {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const { camera, size } = useThree()
  const mode = useStore((s) => (present ? 'audience' : s.camera))
  const nonce = useStore((s) => s.cameraNonce)
  const audience = useStore((s) => s.doc.site.audienceDistance)
  const hasCompiled = useStore((s) => !!s.compiled)
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null>(null)
  const first = useRef(true)

  useEffect(() => {
    if (!hasCompiled) return
    // A pending "frame selection" request owns the camera move.
    if (mode === 'orbit' && getState().frameRequest && !first.current) return
    const p = presetFor(mode, getState().compiled, audience)
    const cam = camera as THREE.PerspectiveCamera
    cam.fov = mode === 'audience' ? audienceFov(getState().compiled, audience, size.width / size.height, p.target) : 40
    cam.updateProjectionMatrix()
    const ctl = controls.current
    if (first.current || !ctl) {
      camera.position.copy(p.pos)
      ctl?.target.copy(p.target)
      ctl?.update()
      first.current = false
      return
    }
    anim.current = { from: camera.position.clone(), to: p.pos, tFrom: ctl.target.clone(), tTo: p.target, t: 0 }
  }, [mode, nonce, audience, hasCompiled, camera, size.width, size.height])

  // F: fly to the selected formation, keeping the current viewing direction.
  const frameReq = useStore((s) => s.frameRequest)
  useEffect(() => {
    const ctl = controls.current
    if (!frameReq || !ctl) return
    const target = new THREE.Vector3(...frameReq.center)
    const dir = camera.position.clone().sub(ctl.target)
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1)
    dir.normalize()
    if (dir.y < 0.05) dir.y = 0.05
    dir.normalize()
    const cam = camera as THREE.PerspectiveCamera
    cam.fov = 40
    cam.updateProjectionMatrix()
    const dist = (frameReq.radius / Math.sin((cam.fov * Math.PI) / 360)) * 1.15
    const pos = target.clone().addScaledVector(dir, dist)
    pos.y = Math.max(2, pos.y)
    anim.current = { from: camera.position.clone(), to: pos, tFrom: ctl.target.clone(), tTo: target, t: 0 }
    getState().set({ frameRequest: null })
  }, [frameReq, camera])

  useFrame((_, dt) => {
    // Never let the camera sink below the ground.
    if (camera.position.y < 0.5) camera.position.y = 0.5
    const a = anim.current
    const ctl = controls.current
    if (!a || !ctl) return
    a.t = Math.min(1, a.t + dt / 0.6)
    const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2
    camera.position.lerpVectors(a.from, a.to, k)
    ctl.target.lerpVectors(a.tFrom, a.tTo, k)
    ctl.update()
    if (a.t >= 1) anim.current = null
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      enabled={!present}
      maxPolarAngle={Math.PI - 0.05}
      minDistance={5}
      maxDistance={1500}
      onStart={() => {
        // Grabbing the gizmo is not a camera move.
        if (gizmoHovered()) return
        anim.current = null
        const s = getState()
        if (s.camera !== 'orbit' && !present) s.set({ camera: 'orbit' })
      }}
    />
  )
}

function Pads() {
  const pads = useStore((s) => s.compiled?.pads)
  const spacing = useStore((s) => s.doc.site.gridSpacing)
  const ref = useRef<THREE.InstancedMesh>(null)
  const n = pads ? pads.length / 3 : 0
  useEffect(() => {
    const m = ref.current
    if (!m || !pads) return
    const o = new THREE.Object3D()
    for (let i = 0; i < n; i++) {
      o.position.set(pads[i * 3]!, 0.02, pads[i * 3 + 2]!)
      o.rotation.set(-Math.PI / 2, 0, 0)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  }, [pads, n])
  if (!n) return null
  const size = Math.min(1.2, spacing * 0.45)
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} key={n} frustumCulled={false}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color="#232b3a" />
    </instancedMesh>
  )
}

const skyVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const skyFragment = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    float h = max(dir.y, 0.0);
    vec3 zenith = vec3(0.012, 0.018, 0.035);
    vec3 mid = vec3(0.035, 0.05, 0.095);
    vec3 horizon = vec3(0.085, 0.115, 0.2);
    vec3 c = mix(horizon, mid, smoothstep(0.0, 0.12, h));
    c = mix(c, zenith, smoothstep(0.12, 0.7, h));
    gl_FragColor = vec4(c, 1.0);
  }
`

/** Night-sky dome with a soft glow toward the horizon. */
function Sky() {
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false }), [])
  const ref = useRef<THREE.Mesh>(null)
  // Keep the dome centred on the camera so the horizon is always at eye level.
  useFrame(({ camera }) => ref.current?.position.copy(camera.position))
  return (
    <mesh ref={ref} material={mat} renderOrder={-2} frustumCulled={false}>
      <sphereGeometry args={[4000, 48, 24]} />
    </mesh>
  )
}

function Ground({ present }: { present: boolean }) {
  const site = useStore((s) => s.doc.site)
  const radius = useStore((s) => s.doc.limits.maxRadius)
  const fence = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0.05, Math.sin(a) * radius))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [radius])
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial color="#05080e" />
      </mesh>
      <Sky />
      <Grid
        position={[0, 0, 0]}
        args={[10, 10]}
        cellSize={5}
        sectionSize={25}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor="#161e2e"
        sectionColor="#243049"
        fadeDistance={present ? 380 : 650}
        fadeStrength={1.4}
        infiniteGrid
      />
      {!present && (
        <>
          <lineLoop geometry={fence}>
            <lineBasicMaterial color="#5b2a33" transparent opacity={0.45} />
          </lineLoop>
          <mesh position={[0, 0.03, site.audienceDistance]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[80, 6]} />
            <meshBasicMaterial color="#3a2f17" />
          </mesh>
          <Html position={[0, 0.5, site.audienceDistance]} center distanceFactor={260} zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
            <div style={{ color: '#c9a45a', font: '600 11px system-ui', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>AUDIENCE</div>
          </Html>
        </>
      )}
    </>
  )
}

/** Outline of the selected formation at its arrival position. */
function SelectionBox() {
  const sel = useStore((s) => s.selection)
  const compiled = useStore((s) => s.compiled)
  const box = useMemo(() => {
    if (!compiled || (sel.kind !== 'scene' && sel.kind !== 'flight')) return null
    const cs = compiled.scenes.find((x) => x.id === sel.id)
    if (!cs) return null
    const b = new THREE.Box3()
    const v = new THREE.Vector3()
    for (let i = 0; i < cs.points.length; i += 3) b.expandByPoint(v.set(cs.points[i]!, cs.points[i + 1]!, cs.points[i + 2]!))
    b.expandByScalar(2)
    return b
  }, [compiled, sel])
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: '#f5b544', transparent: true, opacity: 0.28 }), [])
  if (!box) return null
  return <box3Helper args={[box]} material={mat} />
}

/** Red rings around drones involved in the focused safety issue. */
function IssueMarkers() {
  const focus = useStore((s) => s.focus)
  const group = useRef<THREE.Group>(null)
  const drones = focus?.drones ?? []
  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    drones.forEach((d, i) => {
      const m = g.children[i]
      const p = frame.positions
      if (!m || p.length < d * 3 + 3) return
      m.position.set(p[d * 3]!, p[d * 3 + 1]!, p[d * 3 + 2]!)
      m.quaternion.copy(camera.quaternion)
      const dist = camera.position.distanceTo(m.position)
      m.scale.setScalar(Math.max(1.2, dist * 0.018))
    })
  })
  if (!drones.length) return null
  return (
    <group ref={group}>
      {drones.map((d) => (
        <mesh key={d} renderOrder={10}>
          <ringGeometry args={[0.8, 1, 32]} />
          <meshBasicMaterial color="#ff5d5d" transparent opacity={0.95} depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}

export function Viewport({ present = false }: { present?: boolean }) {
  return (
    <Canvas
      camera={{ fov: 40, near: 0.5, far: 9000, position: [0, 1.7, 160] }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => gl.setClearColor('#04060b')}
      frameloop="always"
      raycaster={{ params: { Points: { threshold: 1.5 }, Mesh: {}, Line: { threshold: 1 }, LOD: {}, Sprite: {} } }}
      onPointerMissed={(e) => {
        // A click on empty sky deselects the formation (not after an orbit drag).
        if (present || e.button !== 0 || gizmoJustUsed()) return
        const s = getState()
        if (s.selection.kind === 'scene' || s.selection.kind === 'flight') s.select({ kind: 'show' })
      }}
    >
      <CameraRig present={present} />
      <Ground present={present} />
      <Pads />
      <Drones present={present} />
      {!present && <SelectionBox />}
      {!present && <IssueMarkers />}
      {!present && <Manipulator />}
    </Canvas>
  )
}
