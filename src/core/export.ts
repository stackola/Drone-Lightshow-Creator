// Trajectory export. Samples the exact same `evaluate()` used by the preview.
// Coordinates are ENU metres relative to the centre of the takeoff grid. With
// a site location they are true east/north (the show turned to the heading
// the audience faces) plus latitude and longitude; without one, the audience
// is assumed to stand to the south (east = x, north = −z).

import { zipSync, strToU8 } from 'fflate'
import type { Compiled } from './compile'
import type { Site } from './types'
import { evaluate } from './evaluate'
import { showToEN, showToLatLon } from './geo'

export interface ExportOptions {
  /** Samples per second. */
  rate: number
}

/** One CSV per drone, zipped. Evaluates the show once per sample for all drones. */
export function exportCsvZip(c: Compiled, opts: ExportOptions, showName: string, site?: Site): Uint8Array {
  const rate = Math.max(1, Math.min(50, opts.rate))
  const steps = Math.ceil(c.duration * rate)
  const pos = new Float32Array(c.n * 3)
  const col = new Float32Array(c.n * 3)
  const geo = site?.geo
  const rows: string[][] = Array.from({ length: c.n }, () => [`time_s,east_m,north_m,up_m,red,green,blue${geo ? ',lat_deg,lon_deg' : ''}`])
  for (let k = 0; k <= steps; k++) {
    const t = Math.min(c.duration, k / rate)
    evaluate(c, t, pos, col)
    const ts = t.toFixed(3)
    for (let i = 0; i < c.n; i++) {
      const o = i * 3
      const [e, n] = showToEN(pos[o]!, pos[o + 2]!, geo?.heading ?? 0)
      const ll = geo ? showToLatLon(pos[o]!, pos[o + 2]!, geo) : null
      rows[i]!.push(`${ts},${(e || 0).toFixed(3)},${(n || 0).toFixed(3)},${pos[o + 1]!.toFixed(3)},${Math.round(col[o]! * 255)},${Math.round(col[o + 1]! * 255)},${Math.round(col[o + 2]! * 255)}${ll ? `,${ll[0].toFixed(8)},${ll[1].toFixed(8)}` : ''}`)
    }
  }
  const files: Record<string, Uint8Array> = {}
  const pad = String(c.n).length
  for (let i = 0; i < c.n; i++) files[`drone_${String(i + 1).padStart(pad, '0')}.csv`] = strToU8(rows[i]!.join('\n') + '\n')
  files['README.txt'] = strToU8(
    `${showName}\n\n${c.n} drones, ${c.duration.toFixed(1)} s, sampled at ${rate} Hz.\n` +
      'Columns: time (s), east, north, up (metres, ENU, origin = centre of the takeoff grid), red, green, blue (0-255)' +
      (geo ? ', latitude and longitude (degrees, WGS84).\n' : '.\n') +
      (geo
        ? `Takeoff grid centre: ${geo.lat.toFixed(7)}, ${geo.lon.toFixed(7)}. The audience faces ${Math.round(geo.heading)}° (compass bearing). Altitudes are above the takeoff ground.\n`
        : 'No site location was set: the audience is assumed to stand to the south, facing north.\n'),
  )
  if (site && (geo || site.zones?.length || site.area)) {
    const toGeo = (p: [number, number]) => (geo ? { x: p[0], z: p[1], lat: showToLatLon(p[0], p[1], geo)[0], lon: showToLatLon(p[0], p[1], geo)[1] } : { x: p[0], z: p[1] })
    files['site.json'] = strToU8(JSON.stringify({
      origin: geo ?? null,
      zones: (site.zones ?? []).map((z) => ({ name: z.name, kind: z.kind, top: z.top, buffer: z.buffer, points: z.points.map(toGeo) })),
      flightArea: site.area?.map(toGeo) ?? null,
      note: 'x = metres to the audience’s right, z = metres toward the audience, from the centre of the takeoff grid.',
    }, null, 2))
  }
  return zipSync(files, { level: 6 })
}
