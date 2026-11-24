import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { newScene, newShow } from './defaults'
import { compile } from './compile'
import { evaluate } from './evaluate'
import { validate } from './validate'
import { autoFix } from './fixes'
import { exportCsvZip } from './export'
import { latLonToShow, metresPerDegree, parseLatLon, showToEN, showToLatLon } from './geo'
import { planningLimits, reanchorSite, safeSpacing, signedDistance, zoneClearanceFn } from './site'
import { parseProjectFile, toProjectFile } from './serialize'
import type { ShowDoc, Zone } from './types'

const square = (cx: number, cz: number, h: number): [number, number][] => [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]]

function twoScenes(): ShowDoc {
  const doc = newShow(40)
  doc.scenes.push({ ...newScene(doc, 'circle'), position: [0, 50, 0] }, { ...newScene(doc, 'heart'), position: [60, 50, 0] })
  return doc
}

describe('geo', () => {
  it('turns the show to the heading the audience faces, and back', () => {
    // Facing north: right = east, toward the audience = south.
    expect(showToEN(10, 0, 0)).toEqual([10, -0])
    expect(showToEN(0, 10, 0)[1]).toBeCloseTo(-10)
    // Facing east: right = south, toward the audience = west.
    const [e, n] = showToEN(10, 0, 90)
    expect(e).toBeCloseTo(0); expect(n).toBeCloseTo(-10)
    const o = { lat: 51.5, lon: -0.12, heading: 37 }
    const [lat, lon] = showToLatLon(123.4, -56.7, o)
    const [x, z] = latLonToShow(lat, lon, o)
    expect(x).toBeCloseTo(123.4, 6); expect(z).toBeCloseTo(-56.7, 6)
    // About 111.2 km per degree of latitude at 51.5°N, and lon scaled by cos(lat).
    const m = metresPerDegree(51.5)
    expect(m.lat).toBeGreaterThan(111_200); expect(m.lat).toBeLessThan(111_300)
    expect(m.lon / m.lat).toBeCloseTo(Math.cos((51.5 * Math.PI) / 180), 2)
  })

  it('reads coordinates and map links', () => {
    expect(parseLatLon('52.52, 13.405')).toEqual([52.52, 13.405])
    expect(parseLatLon('https://www.google.com/maps/@48.8584,2.2945,17z')).toEqual([48.8584, 2.2945])
    expect(parseLatLon('https://maps.apple.com/?q=40.7,-74.0')).toEqual([40.7, -74])
    expect(parseLatLon('Paris')).toBeNull()
    expect(parseLatLon('95, 10')).toBeNull()
  })

  it('moving or turning the site keeps zones where they are on the ground', () => {
    const site = { ...newShow(10).site, geo: { lat: 47, lon: 8, heading: 0 }, zones: [{ id: 'z', name: 'Stand', kind: 'audience', points: square(0, 150, 20), top: null, buffer: 20 } as Zone] }
    const before = site.zones[0]!.points.map(([x, z]) => showToLatLon(x, z, site.geo))
    const moved = reanchorSite(site, { lat: 47.0005, lon: 8.0004, heading: 30 })
    const after = moved.zones![0]!.points.map(([x, z]) => showToLatLon(x, z, moved.geo!))
    // Zones are stored to the centimetre: within ~10 cm.
    before.forEach(([la, lo], i) => { expect(after[i]![0]).toBeCloseTo(la, 6); expect(after[i]![1]).toBeCloseTo(lo, 6) })
  })
})

describe('keep-out zones and the flight area', () => {
  it('measures signed distances to polygons and prisms', () => {
    const p = square(0, 0, 10)
    expect(signedDistance(0, 0, p)).toBeCloseTo(-10)
    expect(signedDistance(15, 0, p)).toBeCloseTo(5)
    const f = zoneClearanceFn({ id: 'b', name: 'Tower', kind: 'building', points: p, top: 30, buffer: 5 }, { h: 0, v: 0 })
    expect(f(15, 10, 0)).toBeCloseTo(0) // 5 m from the side, buffer 5
    expect(f(0, 40, 0)).toBeCloseTo(5) // 10 m above the top
    expect(f(0, 10, 0)).toBeLessThan(-10) // inside
  })

  it('flags a formation inside a zone, at the right time, and the fix moves it clear', () => {
    const doc = twoScenes()
    // Just beyond the heart: its right side holds inside the zone's buffer.
    doc.site.zones = [{ id: 'z', name: 'Grandstand', kind: 'audience', points: square(90, 0, 10), top: null, buffer: 10 }]
    const c = compile(doc)
    const v = validate(doc, c)
    const issue = v.issues.find((i) => i.id === 'zone:z')!
    expect(issue).toBeTruthy()
    expect(issue.title).toMatch(/Grandstand/)
    expect(issue.time).toBeCloseTo(c.sceneTimes[1]!.holdStart, 3)
    expect(issue.fix?.action.kind).toBe('move')
    const fixed = autoFix(doc)
    expect(fixed.validation.issues.filter((i) => i.id.startsWith('zone:'))).toEqual([])
    // A zone right on the path between two formations: flagged, explained, no automatic fix.
    const path = twoScenes()
    path.site.zones = [{ id: 'q', name: 'Mast', kind: 'building', points: square(30, 0, 2), top: 200, buffer: 2 }]
    const pv = validate(path, compile(path)).issues.find((i) => i.id === 'zone:q')!
    expect(pv.detail).toMatch(/on the way into “Heart”/)
    expect(pv.fix).toBeUndefined()
  })

  it('never misses an intrusion that fine brute-force sampling finds (flights included)', () => {
    // A narrow pole right on the path between the two formations.
    const doc = twoScenes()
    doc.site.zones = [{ id: 'p', name: 'Pole', kind: 'building', points: square(30, 0, 1), top: 80, buffer: 1 }]
    const c = compile(doc)
    const flagged = validate(doc, c).issues.some((i) => i.id === 'zone:p')
    const f = zoneClearanceFn(doc.site.zones[0]!, { h: 0, v: 0 })
    const p = new Float32Array(c.n * 3)
    let min = Infinity
    for (let t = 0; t <= c.duration; t += 0.01) {
      evaluate(c, t, p, null)
      for (let i = 0; i < c.n; i++) min = Math.min(min, f(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!))
    }
    if (min < -0.01) expect(flagged).toBe(true)
    if (!flagged) expect(min).toBeGreaterThanOrEqual(-1e-3)
  })

  it('keeps drones inside the permitted flight area', () => {
    const doc = twoScenes()
    doc.site.area = square(0, 0, 50)
    const v = validate(doc, compile(doc))
    expect(v.issues.some((i) => i.id === 'area')).toBe(true)
    doc.site.area = square(30, 0, 120)
    expect(validate(doc, compile(doc)).issues).toEqual([])
  })
})

describe('position accuracy', () => {
  it('widens every clearance, and planning keeps the wider spacing', () => {
    const L = { ...newShow(10).limits, accuracy: { h: 0.3, v: 0.5 } }
    expect(safeSpacing(L)).toBeCloseTo(3)
    const P = planningLimits(L)
    expect(P.minAltitude).toBeCloseTo(L.minAltitude + 0.5)
    expect(P.maxRadius).toBeCloseTo(L.maxRadius - 0.3)
    // A formation sized for exact flying fails with GPS-grade accuracy; the fix enlarges it.
    const doc = twoScenes()
    doc.limits = { ...doc.limits, accuracy: { h: 1, v: 1 } }
    const v = validate(doc, compile(doc))
    expect(v.issues.some((i) => i.kind === 'spacing' || i.kind === 'near-miss' || i.kind === 'pads')).toBe(true)
    const fixed = autoFix(doc)
    expect(fixed.validation.issues).toEqual([])
    expect(fixed.validation.stats.minDistance).toBeGreaterThanOrEqual(4 - 1e-6)
  })
})

describe('site files', () => {
  it('saves and loads the site, and exports latitude/longitude turned to the heading', () => {
    const doc = twoScenes()
    doc.limits.accuracy = { h: 0.1, v: 0.15 }
    doc.site.geo = { lat: 40.4168, lon: -3.7038, heading: 90 }
    doc.site.zones = [{ id: 'z', name: 'Road', kind: 'no-fly', points: square(0, 300, 10), top: null, buffer: 5 }]
    doc.site.area = square(0, 0, 200)
    const back = parseProjectFile(JSON.stringify(toProjectFile(doc, null))).doc
    expect(back.site.geo).toEqual(doc.site.geo)
    expect(back.site.zones).toEqual(doc.site.zones)
    expect(back.site.area).toEqual(doc.site.area)
    expect(back.limits.accuracy).toEqual(doc.limits.accuracy)
    const c = compile(doc)
    const files = unzipSync(exportCsvZip(c, { rate: 2 }, doc.name, doc.site))
    const csv = strFromU8(files['drone_01.csv']!).trim().split('\n')
    expect(csv[0]).toBe('time_s,east_m,north_m,up_m,red,green,blue,lat_deg,lon_deg')
    // Mid-show: the exported lat/lon matches the drone's show position.
    const k = Math.floor(csv.length / 2)
    const [t, , , , , , , lat, lon] = csv[k]!.split(',').map(Number)
    const p = new Float32Array(c.n * 3)
    evaluate(c, t!, p, null)
    const [x, z] = latLonToShow(lat!, lon!, doc.site.geo)
    expect(x).toBeCloseTo(p[0]!, 1); expect(z).toBeCloseTo(p[2]!, 1)
    expect(JSON.parse(strFromU8(files['site.json']!)).zones[0].name).toBe('Road')
  })
})

describe('the copilot sees the site', () => {
  it('lists accuracy, zones and the flight area in show metres', async () => {
    const { summarizeShow } = await import('@/ai/context')
    const doc = twoScenes()
    doc.limits.accuracy = { h: 0.1, v: 0.15 }
    doc.site.zones = [{ id: 'z', name: 'Grandstand', kind: 'audience', points: square(0, 200, 30), top: null, buffer: 30 }]
    doc.site.area = square(0, 0, 220)
    const s = summarizeShow(doc)
    expect(s).toMatch(/Position accuracy ±0\.1 m across, ±0\.15 m up\/down: drones are kept 2\.30 m apart/)
    expect(s).toMatch(/"Grandstand" \(audience\): x -30…30, z 170…230, no ceiling/)
    expect(s).toMatch(/Permitted flight area: polygon spanning x -220…220/)
  })
})
