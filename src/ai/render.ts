// Renders formations as images the model can look at (front view, as the
// audience sees them, in their opening colours). Browser only.

import type { Compiled } from '@/core/compile'
import { scenePointColors } from '@/core/compile'
import type { ShowDoc } from '@/core/types'

const TILE_W = 360
const TILE_H = 250

function drawTile(ctx: CanvasRenderingContext2D, x0: number, y0: number, points: Float32Array, colors: Float32Array, label: string, sub: string) {
  ctx.fillStyle = '#04060b'
  ctx.fillRect(x0, y0, TILE_W, TILE_H)
  const n = points.length / 3
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, points[i * 3]!); maxX = Math.max(maxX, points[i * 3]!)
    minY = Math.min(minY, points[i * 3 + 1]!); maxY = Math.max(maxY, points[i * 3 + 1]!)
  }
  const top = 34, pad = 14
  const s = Math.min((TILE_W - pad * 2) / Math.max(1e-6, maxX - minX), (TILE_H - top - pad) / Math.max(1e-6, maxY - minY))
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const r = Math.max(1.4, Math.min(3.2, 90 / Math.sqrt(Math.max(1, n))))
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < n; i++) {
    const R = colors[i * 3]!, G = colors[i * 3 + 1]!, B = colors[i * 3 + 2]!
    const dark = R + G + B < 0.03
    const x = x0 + TILE_W / 2 + (points[i * 3]! - cx) * s
    const y = y0 + top + (TILE_H - top - pad) / 2 - (points[i * 3 + 1]! - cy) * s
    ctx.fillStyle = dark ? 'rgba(90,100,120,0.35)' : `rgb(${Math.round(R * 255)},${Math.round(G * 255)},${Math.round(B * 255)})`
    ctx.beginPath()
    ctx.arc(x, y, dark ? r * 0.6 : r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#e8ebf1'
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.fillText(label, x0 + 10, y0 + 20)
  ctx.fillStyle = '#8b95a7'
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText(sub, x0 + 10, y0 + TILE_H - 8)
  ctx.strokeStyle = '#222836'
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, TILE_W - 1, TILE_H - 1)
}

/**
 * A grid of formation tiles as a PNG (base64, no data: prefix). Each tile is
 * labelled with the scene number and name; grey dots are drones with lights off.
 */
export function contactSheet(doc: ShowDoc, compiled: Compiled, sceneIds?: string[]): { data: string; count: number } | null {
  const list = compiled.scenes.filter((cs) => !sceneIds?.length || sceneIds.includes(cs.id)).slice(0, 12)
  if (!list.length) return null
  const cols = Math.min(3, list.length)
  const rows = Math.ceil(list.length / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * TILE_W
  canvas.height = rows * TILE_H
  const ctx = canvas.getContext('2d')!
  list.forEach((cs, k) => {
    const scene = doc.scenes[cs.index]!
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let i = 0; i < cs.points.length; i += 3) {
      minX = Math.min(minX, cs.points[i]!); maxX = Math.max(maxX, cs.points[i]!)
      minY = Math.min(minY, cs.points[i + 1]!); maxY = Math.max(maxY, cs.points[i + 1]!)
    }
    drawTile(ctx, (k % cols) * TILE_W, Math.floor(k / cols) * TILE_H, cs.points, scenePointColors(cs), `${cs.index + 1}. ${scene.name}`, `${Math.round(maxX - minX)} × ${Math.round(maxY - minY)} m · ${doc.droneCount} drones`)
  })
  return { data: canvas.toDataURL('image/png').split(',')[1]!, count: list.length }
}

/** Preview of a single shape as drones (PNG base64), e.g. to show the model how its drawing came out. */
export function shapePreview(points: Float32Array, colors: Float32Array | null, label: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = TILE_W
  canvas.height = TILE_H
  const ctx = canvas.getContext('2d')!
  const n = points.length / 3
  const cols = colors ?? new Float32Array(n * 3).fill(1)
  drawTile(ctx, 0, 0, points, cols, label, `${n} drones`)
  return canvas.toDataURL('image/png').split(',')[1]!
}

// --- Four views of a 3D formation -----------------------------------------------------

export interface View {
  label: string
  /** Rotation about the vertical axis, then tilt about the horizontal axis (radians). */
  yaw: number
  pitch: number
}

export const FOUR_VIEWS: View[] = [
  { label: 'Front (audience view)', yaw: 0, pitch: 0 },
  { label: 'Right side', yaw: -Math.PI / 2, pitch: 0 },
  { label: 'Top (audience at bottom)', yaw: 0, pitch: Math.PI / 2 },
  { label: 'Three-quarter, from above', yaw: -0.6, pitch: 0.35 },
]

/** Project points for a view: screen x, screen y (up), depth (toward the viewer). */
export function projectView(points: Float32Array, v: View): Float32Array {
  const n = points.length / 3
  const out = new Float32Array(n * 3)
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch)
  for (let i = 0; i < n; i++) {
    const x = points[i * 3]!, y = points[i * 3 + 1]!, z = points[i * 3 + 2]!
    const x1 = x * cy + z * sy
    const z1 = -x * sy + z * cy
    out[i * 3] = x1
    out[i * 3 + 1] = y * cp - z1 * sp
    out[i * 3 + 2] = y * sp + z1 * cp
  }
  return out
}

function drawDepthTile(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, points: Float32Array, colors: Float32Array, view: View, scale: number, center: [number, number]) {
  ctx.fillStyle = '#04060b'
  ctx.fillRect(x0, y0, w, h)
  const p = projectView(points, view)
  const n = p.length / 3
  let zMin = Infinity, zMax = -Infinity
  for (let i = 0; i < n; i++) { zMin = Math.min(zMin, p[i * 3 + 2]!); zMax = Math.max(zMax, p[i * 3 + 2]!) }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => p[a * 3 + 2]! - p[b * 3 + 2]!)
  const r = Math.max(1.4, Math.min(3.4, 100 / Math.sqrt(Math.max(1, n))))
  for (const i of order) {
    const depth = zMax > zMin ? (p[i * 3 + 2]! - zMin) / (zMax - zMin) : 1
    const k = 0.35 + 0.65 * depth // far drones dimmer and smaller
    const R = colors[i * 3]!, G = colors[i * 3 + 1]!, B = colors[i * 3 + 2]!
    const dark = R + G + B < 0.03
    ctx.fillStyle = dark ? `rgba(90,100,120,${0.25 + 0.3 * depth})` : `rgb(${Math.round(R * 255 * k)},${Math.round(G * 255 * k)},${Math.round(B * 255 * k)})`
    ctx.beginPath()
    ctx.arc(x0 + w / 2 + (p[i * 3]! - center[0]) * scale, y0 + 30 + (h - 40) / 2 - (p[i * 3 + 1]! - center[1]) * scale, r * (0.7 + 0.3 * depth), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#c7cede'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillText(view.label, x0 + 10, y0 + 19)
  ctx.strokeStyle = '#222836'
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1)
}

/**
 * A 2×2 sheet of the same formation from the front, side, top and a
 * three-quarter angle (PNG base64). Drones further away are drawn dimmer.
 */
export function fourViews(points: Float32Array, colors: Float32Array | null, title: string): string {
  const W = 360, H = 300
  const canvas = document.createElement('canvas')
  canvas.width = W * 2
  canvas.height = H * 2 + 34
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0b0e15'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#e8ebf1'
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.fillText(`${title} — ${points.length / 3} drones`, 10, 22)
  const n = points.length / 3
  const cols = colors ?? new Float32Array(n * 3).fill(1)
  // One scale for all views so proportions compare across them.
  let ext = 1e-6
  const cx = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) cx[k]! += points[i * 3 + k]! / n
  const centred = new Float32Array(points.length)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    centred[i * 3 + k] = points[i * 3 + k]! - cx[k]!
    ext = Math.max(ext, Math.abs(centred[i * 3 + k]!))
  }
  const scale = (Math.min(W, H - 40) / 2 - 12) / ext
  FOUR_VIEWS.forEach((v, k) => drawDepthTile(ctx, (k % 2) * W, 34 + Math.floor(k / 2) * H, W, H, centred, cols, v, scale, [0, 0]))
  return canvas.toDataURL('image/png').split(',')[1]!
}

/**
 * Front views side by side (PNG base64): the same formation in different
 * poses, e.g. a model's moving parts at rest and at both ends of their swing.
 */
export function frontStrip(frames: { points: Float32Array; label: string }[], colors: Float32Array | null, title: string): string {
  const W = 300, H = 280
  const canvas = document.createElement('canvas')
  canvas.width = W * frames.length
  canvas.height = H + 34
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0b0e15'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#e8ebf1'
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.fillText(title, 10, 22)
  // One scale and centre for every frame, so the motion is visible.
  let ext = 1e-6
  const c = [0, 0, 0]
  const first = frames[0]!.points, n = first.length / 3
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k]! += first[i * 3 + k]! / n
  for (const f of frames) for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) ext = Math.max(ext, Math.abs(f.points[i * 3 + k]! - c[k]!))
  const scale = (Math.min(W, H - 40) / 2 - 12) / ext
  const cols = colors ?? new Float32Array(n * 3).fill(1)
  frames.forEach((f, k) => {
    const centred = new Float32Array(f.points.length)
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) centred[i * 3 + a] = f.points[i * 3 + a]! - c[a]!
    drawDepthTile(ctx, k * W, 34, W, H, centred, cols, { label: f.label, yaw: 0, pitch: 0 }, scale, [0, 0])
  })
  return canvas.toDataURL('image/png').split(',')[1]!
}

/**
 * Drones as the audience sees them at night (PNG base64): glowing dots on
 * black, sized for the count, the formation filling the frame.
 */
export function dronesPng(points: Float32Array, colors: Float32Array | null, size = 640): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const x = canvas.getContext('2d')!
  x.fillStyle = '#000'
  x.fillRect(0, 0, size, size)
  const n = points.length / 3
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, points[i * 3]!); maxX = Math.max(maxX, points[i * 3]!)
    minY = Math.min(minY, points[i * 3 + 1]!); maxY = Math.max(maxY, points[i * 3 + 1]!)
  }
  const k = (size - 40) / Math.max(1e-6, maxX - minX, maxY - minY)
  const r = Math.max(1.4, Math.min(4, (1.1 * size) / Math.sqrt(Math.max(1, n)) / 9))
  x.globalCompositeOperation = 'lighter'
  for (let i = 0; i < n; i++) {
    const px = size / 2 + (points[i * 3]! - (minX + maxX) / 2) * k
    const py = size / 2 - (points[i * 3 + 1]! - (minY + maxY) / 2) * k
    const c = colors ? [colors[i * 3]!, colors[i * 3 + 1]!, colors[i * 3 + 2]!].map((v) => Math.round(v * 255)).join(',') : '255,255,255'
    const g = x.createRadialGradient(px, py, 0, px, py, r * 2.2)
    g.addColorStop(0, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.35, `rgba(${c},0.95)`)
    g.addColorStop(1, `rgba(${c},0)`)
    x.fillStyle = g
    x.beginPath()
    x.arc(px, py, r * 2.2, 0, Math.PI * 2)
    x.fill()
  }
  return canvas.toDataURL('image/png').split(',')[1]!
}
