// ============================================================================
// S9-04/05: Export — CSV waypoint + JSON project export
// ============================================================================
// CSV: Per-drone CSV files bundled in a ZIP archive
// JSON: Full project serialization (reuses existing serializer)
// ============================================================================

import type { BakeOutput } from './bakeService'
import type { BakeSample } from './bakeWorker'
import { gatherProjectJSON } from './projectIO'

export type ExportFormat = 'csv' | 'json'

export interface ExportOptions {
  format: ExportFormat
  sampleRate: number
  coordinateSystem: 'enu' | 'ned' // East-North-Up or North-East-Down
  projectName: string
}

/**
 * S9-05: Export full project as JSON (download).
 */
export function exportProjectJSON(projectName: string): void {
  const json = gatherProjectJSON()
  downloadBlob(json, `${sanitize(projectName)}.droneshow`, 'application/json')
}

/**
 * S9-04: Export baked trajectories as CSV files in a ZIP archive.
 * Uses a simple ZIP builder (no external dependency).
 */
export function exportCSV(bakeOutput: BakeOutput, options: ExportOptions): void {
  const files: { name: string; content: string }[] = []

  bakeOutput.trajectories.forEach((samples, droneId) => {
    const csv = buildCSV(samples, options.coordinateSystem)
    files.push({
      name: `drone_${String(droneId).padStart(4, '0')}.csv`,
      content: csv,
    })
  })

  // Build a simple ZIP
  const zipBlob = buildZip(files)
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitize(options.projectName)}_waypoints.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function buildCSV(samples: BakeSample[], coordinateSystem: 'enu' | 'ned'): string {
  const header = 'time,x,y,z,r,g,b\n'
  const rows = samples.map((s) => {
    let x = s.x, y = s.y, z = s.z
    if (coordinateSystem === 'ned') {
      // Convert ENU → NED: swap x↔y, negate z
      const tmp = x
      x = y
      y = tmp
      z = -z
    }
    return `${s.time.toFixed(3)},${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)},${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)}`
  })
  return header + rows.join('\n')
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'export'
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ============================================================================
// Minimal ZIP builder (no dependencies) — creates valid ZIP archives
// ============================================================================

function buildZip(files: { name: string; content: string }[]): Blob {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const centralDir: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const contentBytes = encoder.encode(file.content)
    const crc = crc32(contentBytes)

    // Local file header
    const localHeader = new ArrayBuffer(30 + nameBytes.length)
    const lhView = new DataView(localHeader)
    lhView.setUint32(0, 0x04034b50, true) // signature
    lhView.setUint16(4, 20, true) // version needed
    lhView.setUint16(6, 0, true) // flags
    lhView.setUint16(8, 0, true) // compression (store)
    lhView.setUint16(10, 0, true) // mod time
    lhView.setUint16(12, 0, true) // mod date
    lhView.setUint32(14, crc, true) // crc32
    lhView.setUint32(18, contentBytes.length, true) // compressed size
    lhView.setUint32(22, contentBytes.length, true) // uncompressed size
    lhView.setUint16(26, nameBytes.length, true) // filename length
    lhView.setUint16(28, 0, true) // extra field length
    new Uint8Array(localHeader).set(nameBytes, 30)

    const localHeaderBytes = new Uint8Array(localHeader)
    parts.push(localHeaderBytes)
    parts.push(contentBytes)

    // Central directory entry
    const cdEntry = new ArrayBuffer(46 + nameBytes.length)
    const cdView = new DataView(cdEntry)
    cdView.setUint32(0, 0x02014b50, true) // signature
    cdView.setUint16(4, 20, true) // version made by
    cdView.setUint16(6, 20, true) // version needed
    cdView.setUint16(8, 0, true) // flags
    cdView.setUint16(10, 0, true) // compression
    cdView.setUint16(12, 0, true) // mod time
    cdView.setUint16(14, 0, true) // mod date
    cdView.setUint32(16, crc, true)
    cdView.setUint32(20, contentBytes.length, true)
    cdView.setUint32(24, contentBytes.length, true)
    cdView.setUint16(28, nameBytes.length, true)
    cdView.setUint16(30, 0, true) // extra field length
    cdView.setUint16(32, 0, true) // comment length
    cdView.setUint16(34, 0, true) // disk number start
    cdView.setUint16(36, 0, true) // internal attrs
    cdView.setUint32(38, 0, true) // external attrs
    cdView.setUint32(42, offset, true) // local header offset
    new Uint8Array(cdEntry).set(nameBytes, 46)

    centralDir.push(new Uint8Array(cdEntry))
    offset += localHeaderBytes.length + contentBytes.length
  }

  const cdOffset = offset
  let cdSize = 0
  for (const entry of centralDir) {
    parts.push(entry)
    cdSize += entry.length
  }

  // End of central directory
  const eocd = new ArrayBuffer(22)
  const eocdView = new DataView(eocd)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(4, 0, true) // disk number
  eocdView.setUint16(6, 0, true) // disk with CD
  eocdView.setUint16(8, files.length, true) // entries on disk
  eocdView.setUint16(10, files.length, true) // total entries
  eocdView.setUint32(12, cdSize, true) // CD size
  eocdView.setUint32(16, cdOffset, true) // CD offset
  eocdView.setUint16(20, 0, true) // comment length
  parts.push(new Uint8Array(eocd))

  return new Blob(parts as BlobPart[], { type: 'application/zip' })
}

// CRC-32 lookup table
const crcTable: number[] = []
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[i] = c
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
