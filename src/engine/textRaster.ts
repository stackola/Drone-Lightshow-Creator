// Text in real fonts → a 1-bit mask. Works on the main thread and in workers.

import type { Mask, TextFont } from '@/core/types'
import { encodeMask } from '@/core/sample'
import { pixelTextMask } from '@/core/pixelFont'

const FONTS: Record<Exclude<TextFont, 'pixel'>, string> = {
  sans: '800 {px}px "Inter", "Helvetica Neue", Arial, system-ui, sans-serif',
  serif: '700 {px}px Georgia, "Times New Roman", serif',
}

/** Rasterise text into a tight 1-bit mask using the browser's fonts. */
export function canvasTextMask(text: string, font: TextFont): Mask {
  if (font === 'pixel') return pixelTextMask(text)
  const lines = (text || ' ').split('\n')
  const px = 96
  const lineH = px * 1.12
  // OffscreenCanvas also works inside the engine worker (where shows like the flagship demo are built).
  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  const f = FONTS[font].replace('{px}', String(px))
  ctx.font = f
  const width = Math.ceil(Math.max(1, ...lines.map((l) => ctx.measureText(l).width))) + 20
  const height = Math.ceil(lineH * lines.length + 20)
  canvas.width = width
  canvas.height = height
  ctx.font = f
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  lines.forEach((l, i) => ctx.fillText(l, width / 2, 10 + lineH * (i + 0.5)))
  const data = ctx.getImageData(0, 0, width, height).data
  return trimMask(width, height, (x, y) => data[(y * width + x) * 4 + 3]! > 110)
}

function trimMask(w: number, h: number, on: (x: number, y: number) => boolean, pad = 1): Mask {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (on(x, y)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
  if (x1 < 0) return encodeMask(1, 1, () => false)
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad)
  return encodeMask(x1 - x0 + 1, y1 - y0 + 1, (x, y) => on(x + x0, y + y0))
}

