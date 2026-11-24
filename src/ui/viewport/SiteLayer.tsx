// The real site in the 3D view: keep-out zones as translucent volumes, the
// permitted flight area on the ground, and (optionally) the street map under
// the show, turned to the heading and dimmed for night.

import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '@/state/store'
import { DEFAULT_TILES, latToTileY, lonToTileX, metresPerDegree, showToLatLon, tileUrl, tileXToLon, tileYToLat, zoomFor, type GeoOrigin } from '@/core/geo'
import type { Zone } from '@/core/types'

const COLORS: Record<Zone['kind'], string> = { audience: '#4dabf7', building: '#ff922b', 'no-fly': '#ff4d6d' }

function ZoneVolume({ zone, ceiling }: { zone: Zone; ceiling: number }) {
  const { geo, edges } = useMemo(() => {
    // Shape in (x, −z), extruded along +z, then turned upright: extrusion becomes height.
    const shape = new THREE.Shape(zone.points.map(([x, z]) => new THREE.Vector2(x, -z)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1, zone.top ?? ceiling + 10), bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return { geo: g, edges: new THREE.EdgesGeometry(g) }
  }, [zone.points, zone.top, ceiling])
  useEffect(() => () => { geo.dispose(); edges.dispose() }, [geo, edges])
  return (
    <group>
      <mesh geometry={geo} renderOrder={1}>
        <meshBasicMaterial color={COLORS[zone.kind]} transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={COLORS[zone.kind]} transparent opacity={0.55} />
      </lineSegments>
    </group>
  )
}

function AreaOutline({ area }: { area: [number, number][] }) {
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints(area.map(([x, z]) => new THREE.Vector3(x, 0.08, z))), [area])
  return (
    <lineLoop geometry={geo}>
      <lineBasicMaterial color="#40c057" transparent opacity={0.8} />
    </lineLoop>
  )
}

/** Street map under the show: tiles drawn into one canvas, turned to the heading and dimmed. */
function MapGround({ geo, tiles, half }: { geo: GeoOrigin; tiles?: string; half: number }) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  useEffect(() => {
    let cancelled = false
    const size = 1024
    const k = size / (2 * half)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#05080e'
    ctx.fillRect(0, 0, size, size)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const z = zoomFor(1 / k, geo.lat)
    const corners = [[-half, -half], [half, -half], [-half, half], [half, half]].map(([x, zz]) => showToLatLon(x!, zz!, geo))
    const xs = corners.map(([, lon]) => lonToTileX(lon, z)), ys = corners.map(([lat]) => latToTileY(lat, z))
    const m = metresPerDegree(geo.lat)
    const h = (geo.heading * Math.PI) / 180
    const jobs: Promise<void>[] = []
    for (let tx = Math.floor(Math.min(...xs)); tx <= Math.floor(Math.max(...xs)); tx++)
      for (let ty = Math.floor(Math.min(...ys)); ty <= Math.floor(Math.max(...ys)); ty++) {
        const e0 = (tileXToLon(tx, z) - geo.lon) * m.lon, e1 = (tileXToLon(tx + 1, z) - geo.lon) * m.lon
        const n1 = (tileYToLat(ty, z) - geo.lat) * m.lat, n0 = (tileYToLat(ty + 1, z) - geo.lat) * m.lat
        jobs.push(new Promise<void>((resolve) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => {
            if (!cancelled) {
              // East/north → canvas (x across, z toward the audience), north up in the tile.
              ctx.setTransform(k * Math.cos(h), -k * Math.sin(h), -k * Math.sin(h), -k * Math.cos(h), k * half, k * half)
              ctx.scale(1, -1)
              ctx.drawImage(img, e0, -n1, e1 - e0, n1 - n0)
            }
            resolve()
          }
          img.onerror = () => resolve()
          img.src = tileUrl(tiles ?? DEFAULT_TILES, tx, ty, z)
        }))
      }
    void Promise.all(jobs).then(() => {
      if (cancelled) return
      // Night: dim the map so the drones stay the brightest thing in view.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = 'rgba(3, 5, 10, 0.58)'
      ctx.fillRect(0, 0, size, size)
      texture.needsUpdate = true
      setTex(texture)
    })
    return () => { cancelled = true; texture.dispose() }
  }, [geo.lat, geo.lon, geo.heading, tiles, half]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!tex) return null
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[2 * half, 2 * half]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}

export function SiteLayer({ present }: { present: boolean }) {
  const site = useStore((s) => s.doc.site)
  const ceiling = useStore((s) => s.doc.limits.maxAltitude)
  const radius = useStore((s) => s.doc.limits.maxRadius)
  const half = Math.max(200, radius * 1.4, site.audienceDistance * 1.3)
  return (
    <>
      {site.geo && site.mapInView && <MapGround geo={site.geo} tiles={site.tiles} half={half} />}
      {!present && (site.zones ?? []).map((z) => <ZoneVolume key={z.id} zone={z} ceiling={ceiling} />)}
      {!present && site.area && site.area.length >= 3 && <AreaOutline area={site.area} />}
    </>
  )
}
