// Trajectory export. Samples the exact same `evaluate()` used by the preview.
// Coordinates are ENU metres relative to the centre of the takeoff grid:
// east = x, north = −z (the audience stands to the south), up = y.

import { zipSync, strToU8 } from 'fflate'
import type { Compiled } from './compile'
import { evaluate } from './evaluate'

export interface ExportOptions {
  /** Samples per second. */
  rate: number
}

export function droneCsv(c: Compiled, drone: number, rate: number): string {
  const pos = new Float32Array(c.n * 3)
  const col = new Float32Array(c.n * 3)
  const lines = ['time_s,east_m,north_m,up_m,red,green,blue']
  const steps = Math.ceil(c.duration * rate)
  for (let k = 0; k <= steps; k++) {
    const t = Math.min(c.duration, k / rate)
    evaluate(c, t, pos, col)
    const o = drone * 3
    lines.push([
      t.toFixed(3),
      pos[o]!.toFixed(3), (-pos[o + 2]! || 0).toFixed(3), pos[o + 1]!.toFixed(3),
      Math.round(col[o]! * 255), Math.round(col[o + 1]! * 255), Math.round(col[o + 2]! * 255),
    ].join(','))
  }
  return lines.join('\n') + '\n'
}

/** One CSV per drone, zipped. Evaluates the show once per sample for all drones. */
export function exportCsvZip(c: Compiled, opts: ExportOptions, showName: string): Uint8Array {
  const rate = Math.max(1, Math.min(50, opts.rate))
  const steps = Math.ceil(c.duration * rate)
  const pos = new Float32Array(c.n * 3)
  const col = new Float32Array(c.n * 3)
  const rows: string[][] = Array.from({ length: c.n }, () => ['time_s,east_m,north_m,up_m,red,green,blue'])
  for (let k = 0; k <= steps; k++) {
    const t = Math.min(c.duration, k / rate)
    evaluate(c, t, pos, col)
    const ts = t.toFixed(3)
    for (let i = 0; i < c.n; i++) {
      const o = i * 3
      rows[i]!.push(`${ts},${pos[o]!.toFixed(3)},${(-pos[o + 2]! || 0).toFixed(3)},${pos[o + 1]!.toFixed(3)},${Math.round(col[o]! * 255)},${Math.round(col[o + 1]! * 255)},${Math.round(col[o + 2]! * 255)}`)
    }
  }
  const files: Record<string, Uint8Array> = {}
  const pad = String(c.n).length
  for (let i = 0; i < c.n; i++) files[`drone_${String(i + 1).padStart(pad, '0')}.csv`] = strToU8(rows[i]!.join('\n') + '\n')
  files['README.txt'] = strToU8(
    `${showName}\n\n${c.n} drones, ${c.duration.toFixed(1)} s, sampled at ${rate} Hz.\n` +
      'Columns: time (s), east, north, up (metres, ENU, origin = centre of the takeoff grid), red, green, blue (0-255).\n' +
      'The audience stands to the south, facing north.\n',
  )
  return zipSync(files, { level: 6 })
}
