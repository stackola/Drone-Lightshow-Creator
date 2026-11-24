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
