// The site editor: where the show is on Earth, which way the audience faces,
// keep-out zones and the permitted flight area, drawn on a top-down map.
//
// The map is in show metres (x to the audience's right, z toward the audience,
// so the audience is at the bottom). With a location, street-map tiles are
// drawn underneath, turned to the heading. Zones are stored in show metres;
// moving or turning the site keeps them where they are on the ground.

import { useMemo, useRef, useState } from 'react'
import { MapPin, Pentagon, Trash2, Search, Hand, Crosshair, RotateCcw, RotateCw } from 'lucide-react'
import { getState, useStore } from '@/state/store'
import { Modal, NumberField, Row, Segmented, Toggle } from '@/ui/components/controls'
import {
  DEFAULT_TILES, TILES_ATTRIBUTION, latToTileY, lonToTileX, metresPerDegree, parseLatLon, showToLatLon, tileUrl, tileXToLon, tileYToLat, zoomFor,
} from '@/core/geo'
import { ZONE_KINDS, reanchorSite, centroid2 } from '@/core/site'
import { newId } from '@/core/defaults'
import type { Site, Zone } from '@/core/types'

type Tool = 'pan' | 'zone' | 'area' | 'place'
type Pt = [number, number]

const W = 720, H = 520

const ZONE_FILL: Record<Zone['kind'], string> = { audience: '#4dabf7', building: '#ff922b', 'no-fly': '#ff4d6d' }

function updateSite(recipe: (s: Site) => Site, label: string, key?: string) {
  const st = getState()
  st.update((d) => { d.site = recipe(d.site as Site) }, label, key)
}

export function SiteDialog({ onClose }: { onClose: () => void }) {
  const site = useStore((s) => s.doc.site)
  const limits = useStore((s) => s.doc.limits)
  const compiled = useStore((s) => s.compiled)
  const [view, setView] = useState(() => ({ cx: 0, cz: Math.min(80, site.audienceDistance / 2), scale: Math.min(2.2, (H * 0.42) / Math.max(60, limits.maxRadius, site.audienceDistance)) }))
  const [tool, setTool] = useState<Tool>('pan')
  const [draft, setDraft] = useState<Pt[]>([])
  const [kind, setKind] = useState<Zone['kind']>('no-fly')
  const [sel, setSel] = useState<string | null>(null)
  const [where, setWhere] = useState('')
  const [results, setResults] = useState<{ name: string; lat: number; lon: number }[] | null>(null)
  const [searching, setSearching] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ kind: 'pan'; x: number; y: number; cx: number; cz: number } | { kind: 'vertex'; target: string; index: number } | null>(null)

  const toScreen = (x: number, z: number): Pt => [(x - view.cx) * view.scale + W / 2, (z - view.cz) * view.scale + H / 2]
  const fromScreen = (sx: number, sy: number): Pt => [(sx - W / 2) / view.scale + view.cx, (sy - H / 2) / view.scale + view.cz]
  const eventPoint = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent): Pt => {
    const r = svg.current!.getBoundingClientRect()
    return fromScreen(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H)
  }

  // Everything the show flies, from above: formation points (and group formations), and the pads.
  const footprint = useMemo(() => {
    if (!compiled) return [] as Pt[]
    const out: Pt[] = []
    const all = [...compiled.scenes, ...compiled.segments.flatMap((sg) => (sg.kind === 'split' ? sg.tracks.flatMap((t) => t.steps) : []))]
    for (const cs of all) for (let k = 0; k < cs.points.length; k += 3 * Math.max(1, Math.floor(cs.points.length / 3 / 150))) out.push([cs.points[k]!, cs.points[k + 2]!])
    return out
  }, [compiled])
  const pads = useMemo(() => {
    if (!compiled) return [] as Pt[]
    const out: Pt[] = []
    for (let k = 0; k < compiled.pads.length; k += 3) out.push([compiled.pads[k]!, compiled.pads[k + 2]!])
    return out
  }, [compiled])

  // Map tiles under the view, turned to the heading.
  const tiles = useMemo(() => {
    const g = site.geo
    if (!g) return null
    const corners = [fromScreen(0, 0), fromScreen(W, 0), fromScreen(0, H), fromScreen(W, H)].map(([x, z]) => showToLatLon(x, z, g))
    const z = zoomFor(1 / view.scale, g.lat)
    const xs = corners.map(([, lon]) => lonToTileX(lon, z)), ys = corners.map(([lat]) => latToTileY(lat, z))
    const x0 = Math.floor(Math.min(...xs)), x1 = Math.floor(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.floor(Math.max(...ys))
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 120) return null
    const m = metresPerDegree(g.lat)
    const list: { url: string; e0: number; e1: number; n0: number; n1: number }[] = []
    for (let tx = x0; tx <= x1; tx++)
      for (let ty = y0; ty <= y1; ty++) {
        const lonA = tileXToLon(tx, z), lonB = tileXToLon(tx + 1, z), latA = tileYToLat(ty, z), latB = tileYToLat(ty + 1, z)
        list.push({ url: tileUrl(site.tiles ?? DEFAULT_TILES, tx, ty, z), e0: (lonA - g.lon) * m.lon, e1: (lonB - g.lon) * m.lon, n0: (latB - g.lat) * m.lat, n1: (latA - g.lat) * m.lat })
      }
    const h = (g.heading * Math.PI) / 180, S = view.scale
    const matrix = `matrix(${S * Math.cos(h)} ${-S * Math.sin(h)} ${-S * Math.sin(h)} ${-S * Math.cos(h)} ${W / 2 - view.cx * S} ${H / 2 - view.cz * S})`
    return { list, matrix }
  }, [site.geo, site.tiles, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const finishDraft = () => {
    if (draft.length < 3) return
    const pts = draft.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10] as Pt)
    if (tool === 'area') {
      updateSite((s) => ({ ...s, area: pts }), 'Set flight area')
      setSel('area')
    } else {
      const def = ZONE_KINDS.find((k) => k.kind === kind)!
      const zone: Zone = { id: newId('zone'), name: `${def.label} ${(site.zones?.length ?? 0) + 1}`, kind, points: pts, top: def.top, buffer: def.buffer }
      updateSite((s) => ({ ...s, zones: [...(s.zones ?? []), zone] }), `Add ${zone.name}`)
      setSel(zone.id)
    }
    setDraft([])
    setTool('pan')
  }

  const placeAt = (x: number, z: number) => {
    const g = site.geo
    if (!g) return
    const [lat, lon] = showToLatLon(x, z, g)
    updateSite((s) => reanchorSite(s, { lat, lon, heading: g.heading }), 'Move launch site')
    setTool('pan')
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const p = eventPoint(e)
    const target = (e.target as Element).getAttribute('data-vertex')
    if (target) {
      const [id, i] = target.split(':')
      drag.current = { kind: 'vertex', target: id!, index: Number(i) }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'zone' || tool === 'area') {
      if (draft.length >= 3) {
        const [fx, fz] = toScreen(...draft[0]!), [px, pz] = toScreen(...p)
        if (Math.hypot(fx - px, fz - pz) < 10) { finishDraft(); return }
      }
      setDraft((d) => [...d, p])
      return
    }
    if (tool === 'place') { placeAt(p[0], p[1]); return }
    const zid = (e.target as Element).getAttribute('data-zone')
    setSel(zid)
    drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') {
      const r = svg.current!.getBoundingClientRect()
      const k = W / r.width / view.scale
      setView((v) => ({ ...v, cx: d.cx - (e.clientX - d.x) * k, cz: d.cz - (e.clientY - d.y) * k }))
    } else {
      const [x, z] = eventPoint(e)
      const pt: Pt = [Math.round(x * 10) / 10, Math.round(z * 10) / 10]
      if (d.target === 'area') updateSite((s) => ({ ...s, area: s.area?.map((q, i) => (i === d.index ? pt : q)) }), 'Edit flight area', 'area-vertex')
      else updateSite((s) => ({ ...s, zones: s.zones?.map((zn) => (zn.id !== d.target ? zn : { ...zn, points: zn.points.map((q, i) => (i === d.index ? pt : q)) })) }), 'Edit zone', `zone-vertex:${d.target}`)
    }
  }
  const onPointerUp = () => { drag.current = null }
  const onWheel = (e: React.WheelEvent) => {
    const [x, z] = eventPoint(e)
    const k = Math.exp(-e.deltaY * 0.0015)
    setView((v) => {
      const scale = Math.max(0.05, Math.min(20, v.scale * k))
      return { scale, cx: x - (x - v.cx) * (v.scale / scale), cz: z - (z - v.cz) * (v.scale / scale) }
    })
  }

  const setLocation = (lat: number, lon: number) => {
    const heading = site.geo?.heading ?? 0
    updateSite((s) => reanchorSite(s, { lat, lon, heading }), 'Set show location')
    setResults(null)
  }
  const turn = (heading: number) => {
    const g = site.geo
    const h = ((heading % 360) + 360) % 360
    if (!g) return
    updateSite((s) => reanchorSite(s, { ...g, heading: h }), 'Turn the show', 'heading')
  }
  const search = async () => {
    const parsed = parseLatLon(where)
    if (parsed) { setLocation(parsed[0], parsed[1]); return }
    if (!where.trim()) return
    setSearching(true)
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(where.trim())}`, { headers: { Accept: 'application/json' } })
      const j = (await r.json()) as { display_name: string; lat: string; lon: string }[]
      setResults(j.map((x) => ({ name: x.display_name, lat: Number(x.lat), lon: Number(x.lon) })))
    } catch {
      setResults([])
      getState().toast('Place search is unavailable — paste coordinates or a map link instead.', 'err')
    } finally {
      setSearching(false)
    }
  }

  const zones = site.zones ?? []
  const selZone = zones.find((z) => z.id === sel)
  const heading = site.geo?.heading ?? 0
  const north = (() => { const h = (heading * Math.PI) / 180; return [-Math.sin(h), -Math.cos(h)] as Pt })()
  const ring = (pts: Pt[]) => pts.map((p) => toScreen(...p).join(',')).join(' ')
  const audience = toScreen(0, site.audienceDistance)
  const origin = toScreen(0, 0)

  return (
    <Modal title="Site" onClose={onClose} wide footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="site-editor">
        <div className="site-map-wrap">
          <div className="site-tools">
            <Segmented<Tool>
              value={tool}
              onChange={(t) => { setTool(t); setDraft([]) }}
              options={[
                { value: 'pan', label: <><Hand size={12} /> Move</>, title: 'Drag to pan, scroll to zoom; click a zone to select it' },
                { value: 'zone', label: <><Pentagon size={12} /> Zone</>, title: 'Click to draw a keep-out zone; click the first point to finish' },
                { value: 'area', label: <><Pentagon size={12} /> Flight area</>, title: 'Draw the permitted flight area (e.g. from your permit)' },
                ...(site.geo ? [{ value: 'place' as Tool, label: <><Crosshair size={12} /> Launch site</>, title: 'Click where the centre of the takeoff grid is' }] : []),
              ]}
            />
            {tool === 'zone' && (
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Zone['kind'])} aria-label="Zone kind" style={{ width: 120 }}>
                {ZONE_KINDS.map((k) => <option key={k.kind} value={k.kind} title={k.hint}>{k.label}</option>)}
              </select>
            )}
            {draft.length > 0 && (
              <>
                <button className="btn sm primary" disabled={draft.length < 3} onClick={finishDraft}>Finish ({draft.length})</button>
                <button className="btn sm ghost" onClick={() => setDraft((d) => d.slice(0, -1))}>Undo point</button>
                <button className="btn sm ghost" onClick={() => setDraft([])}>Cancel</button>
              </>
            )}
          </div>
          <svg
            ref={svg}
            className={`site-map tool-${tool}`}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Site map"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            onDoubleClick={() => { if (draft.length >= 3) finishDraft() }}
          >
            <rect x={0} y={0} width={W} height={H} className="site-bg" />
            {tiles && (
              <g transform={tiles.matrix} className="site-tiles">
                <g transform="scale(1,-1)">
                  {tiles.list.map((t) => <image key={t.url} href={t.url} x={t.e0} y={-t.n1} width={t.e1 - t.e0} height={t.n1 - t.n0} preserveAspectRatio="none" />)}
                </g>
              </g>
            )}
            {/* Airspace radius and the show from above */}
            <circle cx={origin[0]} cy={origin[1]} r={limits.maxRadius * view.scale} className="site-radius" />
            {footprint.map((p, i) => { const [sx, sy] = toScreen(...p); return <circle key={i} cx={sx} cy={sy} r={1.3} className="site-dot" /> })}
            {pads.map((p, i) => { const [sx, sy] = toScreen(...p); return <circle key={`p${i}`} cx={sx} cy={sy} r={1} className="site-pad" /> })}
            {/* Flight area */}
            {site.area && site.area.length >= 3 && <polygon points={ring(site.area)} className={`site-area${sel === 'area' ? ' sel' : ''}`} data-zone="area" />}
            {/* Zones with their buffers */}
            {zones.map((z) => (
              <g key={z.id}>
                <polygon points={ring(z.points)} className="site-buffer" style={{ strokeWidth: Math.max(1, z.buffer * 2 * view.scale), stroke: ZONE_FILL[z.kind] }} />
                <polygon points={ring(z.points)} className={`site-zone${sel === z.id ? ' sel' : ''}`} style={{ fill: ZONE_FILL[z.kind], stroke: ZONE_FILL[z.kind] }} data-zone={z.id} />
                {(() => { const [cx, cz] = centroid2(z.points); const [sx, sy] = toScreen(cx, cz); return <text x={sx} y={sy} className="site-label">{z.name}</text> })()}
              </g>
            ))}
            {/* Vertex handles for the selection */}
            {(sel === 'area' ? site.area ?? [] : selZone?.points ?? []).map((p, i) => { const [sx, sy] = toScreen(...p); return <circle key={`v${i}`} cx={sx} cy={sy} r={5} className="site-vertex" data-vertex={`${sel}:${i}`} /> })}
            {/* Draft polygon */}
            {draft.length > 0 && <polyline points={ring(draft)} className="site-draft" />}
            {draft.map((p, i) => { const [sx, sy] = toScreen(...p); return <circle key={`d${i}`} cx={sx} cy={sy} r={i === 0 ? 6 : 3.5} className="site-draft-pt" /> })}
            {/* Launch site and audience */}
            <g transform={`translate(${origin[0]},${origin[1]})`}><circle r={5} className="site-origin" /><text y={-9} className="site-label">Launch</text></g>
            <g transform={`translate(${audience[0]},${audience[1]})`}><path d="M -9 6 L 0 -6 L 9 6 Z" className="site-audience" /><text y={20} className="site-label">Audience</text></g>
            {/* Compass and scale */}
            <g transform={`translate(${W - 34},${40})`} className="site-compass">
              <circle r={18} />
              <line x1={0} y1={0} x2={north[0] * 14} y2={north[1] * 14} />
              <text x={north[0] * 26} y={north[1] * 26 + 4}>N</text>
            </g>
            <ScaleBar scale={view.scale} />
            {tiles && <text x={W - 6} y={H - 6} className="site-attrib" textAnchor="end">{site.tiles ? 'Custom map tiles' : TILES_ATTRIBUTION}</text>}
          </svg>
          <div className="hint" style={{ marginTop: 6 }}>
            {tool === 'zone' || tool === 'area' ? 'Click to add points; click the first point (or double-click) to finish.' : tool === 'place' ? 'Click where the centre of the takeoff grid is. Zones stay where they are on the ground.' : 'Drag to pan, scroll to zoom. The audience is at the bottom; dots show where the formations fly.'}
          </div>
        </div>

        <div className="site-side">
          <h3><MapPin size={13} /> Location</h3>
          <div className="row-inline">
            <input className="text-input" placeholder="Place, address, “lat, lon” or a map link" value={where} onChange={(e) => setWhere(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search() }} aria-label="Location" />
            <button className="btn sm" onClick={() => void search()} disabled={searching} aria-label="Find"><Search size={13} /></button>
          </div>
          {results && (
            <div className="site-results">
              {results.length ? results.map((r) => <button key={`${r.lat},${r.lon}`} className="menu-item" onClick={() => setLocation(r.lat, r.lon)}>{r.name}</button>) : <div className="hint">No places found.</div>}
            </div>
          )}
          {site.geo ? (
            <>
              <div className="hint" style={{ margin: '6px 0' }}>Launch site {site.geo.lat.toFixed(6)}, {site.geo.lon.toFixed(6)}</div>
              <Row label="Audience faces" title="Compass bearing the audience looks toward (0° = north)">
                <button className="btn ghost icon sm" aria-label="Turn left" onClick={() => turn(heading - 15)}><RotateCcw size={13} /></button>
                <NumberField value={Math.round(heading)} step={5} unit="°" onChange={(v) => turn(v)} />
                <button className="btn ghost icon sm" aria-label="Turn right" onClick={() => turn(heading + 15)}><RotateCw size={13} /></button>
              </Row>
              <Row label="">
                <Toggle checked={!!site.mapInView} onChange={(v) => updateSite((s) => ({ ...s, mapInView: v }), 'Map in 3D view')} label="Show the map under the show in 3D" />
              </Row>
            </>
          ) : (
            <p className="hint">Set a location to see the site on a street map, export latitude/longitude, and keep zones where they are on the ground when you move or turn the show.</p>
          )}

          <h3>Keep-out zones</h3>
          {!zones.length && <p className="hint">Draw the audience area, buildings, trees and roads with the Zone tool. Every drone is checked against them for the whole show.</p>}
          {zones.map((z) => (
            <div key={z.id} className={`zone-card${sel === z.id ? ' sel' : ''}`} onClick={() => setSel(z.id)}>
              <div className="layer-head">
                <span className="zone-chip" style={{ background: ZONE_FILL[z.kind] }} />
                <input className="name-input sm" value={z.name} aria-label="Zone name" onChange={(e) => updateSite((s) => ({ ...s, zones: s.zones!.map((x) => (x.id === z.id ? { ...x, name: e.target.value } : x)) }), 'Rename zone', `zname:${z.id}`)} />
                <button className="btn ghost icon sm danger" aria-label="Delete zone" onClick={(e) => { e.stopPropagation(); updateSite((s) => ({ ...s, zones: s.zones!.filter((x) => x.id !== z.id) }), `Delete ${z.name}`); setSel(null) }}><Trash2 size={13} /></button>
              </div>
              {sel === z.id && (
                <div className="layer-body">
                  <Segmented full value={z.kind} options={ZONE_KINDS.map((k) => ({ value: k.kind, label: k.label, title: k.hint }))} onChange={(k) => updateSite((s) => ({ ...s, zones: s.zones!.map((x) => (x.id === z.id ? { ...x, kind: k } : x)) }), 'Zone kind')} />
                  <Row label="Height" title="How high the obstacle is; drones may pass above it (plus the buffer). Off = keep out entirely.">
                    <Toggle checked={z.top !== null} onChange={(on) => updateSite((s) => ({ ...s, zones: s.zones!.map((x) => (x.id === z.id ? { ...x, top: on ? 25 : null } : x)) }), 'Zone height')} label="" />
                    {z.top !== null ? <NumberField value={z.top} step={1} unit="m" min={0} onChange={(v) => updateSite((s) => ({ ...s, zones: s.zones!.map((x) => (x.id === z.id ? { ...x, top: v } : x)) }), 'Zone height', `ztop:${z.id}`)} /> : <span className="hint">No ceiling</span>}
                  </Row>
                  <Row label="Buffer" title="Extra distance drones must keep from the zone">
                    <NumberField value={z.buffer} step={1} unit="m" min={0} onChange={(v) => updateSite((s) => ({ ...s, zones: s.zones!.map((x) => (x.id === z.id ? { ...x, buffer: v } : x)) }), 'Zone buffer', `zbuf:${z.id}`)} />
                  </Row>
                </div>
              )}
            </div>
          ))}

          <h3>Flight area</h3>
          {site.area ? (
            <div className="row-inline">
              <span className="hint" style={{ flex: 1 }}>{site.area.length}-point area: drones must stay inside.</span>
              <button className="btn sm ghost danger" onClick={() => { updateSite((s) => { const { area: _a, ...rest } = s; void _a; return rest }, 'Clear flight area'); setSel(null) }}>Clear</button>
            </div>
          ) : (
            <p className="hint">Optional: draw the permitted area from your permit with the Flight area tool.</p>
          )}

          {site.geo && (
            <details className="site-advanced">
              <summary>Map tiles</summary>
              <input className="text-input" placeholder={DEFAULT_TILES} defaultValue={site.tiles ?? ''} aria-label="Tile URL" onBlur={(e) => {
                const v = e.target.value.trim()
                if (!v) updateSite((s) => { const { tiles: _t, ...rest } = s; void _t; return rest }, 'Map tiles')
                else if (/^https:\/\/\S+$/.test(v) && v.includes('{z}')) updateSite((s) => ({ ...s, tiles: v }), 'Map tiles')
                else getState().toast('Tile URLs look like https://…/{z}/{x}/{y}.png', 'err')
              }} />
              <p className="hint">Street map by default. Use your own tile service (e.g. satellite imagery) with a URL containing {'{z}'}, {'{x}'} and {'{y}'}.</p>
            </details>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ScaleBar({ scale }: { scale: number }) {
  const target = 120 / scale
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]
  const m = steps.find((s) => s >= target * 0.6) ?? 2000
  const w = m * scale
  return (
    <g transform={`translate(14,${H - 18})`} className="site-scale">
      <line x1={0} y1={0} x2={w} y2={0} />
      <line x1={0} y1={-4} x2={0} y2={4} />
      <line x1={w} y1={-4} x2={w} y2={4} />
      <text x={w / 2} y={-7} textAnchor="middle">{m} m</text>
    </g>
  )
}
