// Browser-only content import: text in real fonts, and images/logos.

import type { ShapeSpec } from '@/core/types'
import { encodeMask, bytesToBase64 } from '@/core/sample'

export { canvasTextMask } from '@/engine/textRaster'

/**
 * Turn an image file into a formation: transparent images use their alpha;
 * opaque images are separated from the background colour (sampled at the
 * corners). Each drone takes the colour of the pixel it sits on.
 */
export async function imageShape(file: File, size: number): Promise<Extract<ShapeSpec, { kind: 'image' }>> {
  const bitmap = await loadBitmap(file)
  const max = 220
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  let transparent = 0
  for (let i = 3; i < px.length; i += 4) if (px[i]! < 200) transparent++
  const useAlpha = transparent > (w * h) / 20
  let on: (x: number, y: number) => boolean
  if (useAlpha) {
    on = (x, y) => px[(y * w + x) * 4 + 3]! > 128
  } else {
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => (y! * w + x!) * 4)
    const bg = [0, 1, 2].map((c) => corners.reduce((a, o) => a + px[o + c]!, 0) / 4)
    on = (x, y) => {
      const o = (y * w + x) * 4
      return Math.hypot(px[o]! - bg[0]!, px[o + 1]! - bg[1]!, px[o + 2]! - bg[2]!) > 60
    }
  }
  const mask = encodeMask(w, h, on)
  // Colour raster: boost very dark logo colours so they read as light.
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    let r = px[i * 4]!, g = px[i * 4 + 1]!, b = px[i * 4 + 2]!
    const m = Math.max(r, g, b)
    if (m < 90) { r = g = b = 235 } // dark ink → white light
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b
  }
  return { kind: 'image', size, name: file.name, mask, colors: bytesToBase64(rgb), cw: w, ch: h }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      // SVGs without intrinsic size: give them one.
      if (!img.width || !img.height) { img.width = 512; img.height = 512 }
      return img
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  return createImageBitmap(file)
}
