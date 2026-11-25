// Browser-only content import: text in real fonts, and images/logos.

import type { DrawingPart, JointKind, ModelJoint, ShapeSpec, Vec3 } from '@/core/types'
import { encodeMask, bytesToBase64 } from '@/core/sample'

export { canvasTextMask } from '@/engine/textRaster'

/**
 * Turn an image file into a formation: transparent images use their alpha;
 * opaque images are separated from the background colour (sampled at the
 * corners). Each drone takes the colour of the pixel it sits on.
 */
export async function imageShape(file: File, size: number): Promise<Extract<ShapeSpec, { kind: 'image' }>> {
  // SVGs keep their strokes as lines of drones.
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    try { return await svgShape(await file.text(), size, file.name) } catch { /* fall back to the raster path */ }
  }
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

// --- SVG drawings: strokes become lines of drones ----------------------------------------

const GEOMETRY = 'path, line, polyline, polygon, circle, ellipse, rect'

/** Douglas–Peucker: drop points within `tol` of the line between their neighbours. */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]!, [bx, by] = pts[b]!
    const L = Math.hypot(bx - ax, by - ay)
    let far = -1, fd = tol
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!
      // Distance to the chord (or to its start, when a closed loop's ends meet).
      const d = L > 1e-9 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L : Math.hypot(px - ax, py - ay)
      if (d > fd) { fd = d; far = i }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

/** Render SVG markup to a canvas of at most `max` pixels on its long side. */
async function rasterize(svg: string, max: number): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    img.src = url
    await img.decode()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const iw = img.width || 400, ih = img.height || 400
  const k = Math.min(1, max / Math.max(iw, ih))
  const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  return { data: ctx.getImageData(0, 0, w, h).data, w, h }
}

/**
 * A drawing (SVG markup) as a formation. Filled areas are filled evenly with
 * drones; every stroke becomes one line of drones along its path, so outlines
 * and details stay crisp. Drones take the colours of the drawing (gradients
 * included).
 */
export async function svgShape(markup: string, size: number, name: string): Promise<Extract<ShapeSpec, { kind: 'image' }>> {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName.toLowerCase() !== 'svg') throw new Error('Not an SVG drawing.')
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const vw = vb.length === 4 && vb[2]! > 0 ? vb[2]! : Number.parseFloat(root.getAttribute('width') ?? '') || 400
  const vh = vb.length === 4 && vb[3]! > 0 ? vb[3]! : Number.parseFloat(root.getAttribute('height') ?? '') || 400
  root.setAttribute('width', String(vw))
  root.setAttribute('height', String(vh))
  const full = new XMLSerializer().serializeToString(root)
  // Strokes: measured on a live copy (getTotalLength / getPointAtLength), in viewport units.
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none'
  host.innerHTML = full
  document.body.appendChild(host)
  const lines: { p: number[]; closed?: boolean; part?: number }[] = []
  let moving: { parts: DrawingPart[]; joints: ModelJoint[] } | null = null
  try {
    const live = host.querySelector('svg')!
    const step = Math.max(vw, vh) / 300
    // Moving parts: elements marked data-part (see svgParts); every stroke inside one moves with it.
    const partEls = Array.from(live.querySelectorAll<SVGGraphicsElement>('[data-part]')).slice(0, 16)
    const partPts: [number, number][][] = partEls.map(() => [])
    const partOf = (el: Element) => { const p = el.closest('[data-part]'); return p ? partEls.indexOf(p as SVGGraphicsElement) : -1 }
    for (const el of Array.from(live.querySelectorAll<SVGGeometryElement>(GEOMETRY))) {
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const stroked = !!cs.stroke && cs.stroke !== 'none' && Number.parseFloat(cs.strokeWidth) > 0
      const pi = partOf(el)
      if (!stroked && pi < 0) continue
      const total = el.getTotalLength()
      if (!(total > 0)) continue
      const m = el.getCTM()
      const pt = live.createSVGPoint()
      const raw: [number, number][] = []
      const k = Math.max(2, Math.ceil(total / step))
      for (let i = 0; i <= k; i++) {
        const q = el.getPointAtLength((total * i) / k)
        pt.x = q.x; pt.y = q.y
        const r = m ? pt.matrixTransform(m) : pt
        raw.push([r.x, r.y])
      }
      if (pi >= 0) for (let i = 0; i < raw.length; i += 2) partPts[pi]!.push([raw[i]![0] / vw, raw[i]![1] / vh])
      if (!stroked) continue
      // Separate subpaths: a jump far longer than the step starts a new line.
      const parts: [number, number][][] = [[raw[0]!]]
      for (let i = 1; i < raw.length; i++) {
        const [px, py] = raw[i - 1]!, [x, y] = raw[i]!
        if (Math.hypot(x - px, y - py) > step * 3 * Math.max(1, total / k / step)) parts.push([])
        parts[parts.length - 1]!.push([x, y])
      }
      const shapeClosed = /^(polygon|circle|ellipse|rect)$/i.test(el.tagName)
      for (const part of parts) {
        if (part.length < 2) continue
        const [fx, fy] = part[0]!, [lx, ly] = part[part.length - 1]!
        const closed = shapeClosed || Math.hypot(fx - lx, fy - ly) < step * 1.5
        const pts = simplify(closed ? part.slice(0, -1).concat([part[0]!]) : part, step * 0.25)
        lines.push({ p: pts.flatMap(([x, y]) => [Math.round((x / vw) * 1e4) / 1e4, Math.round((y / vh) * 1e4) / 1e4]), ...(closed ? { closed: true } : {}), ...(pi >= 0 ? { part: pi } : {}) })
        if (lines.length >= 200) break
      }
    }
    if (partEls.length) moving = svgParts(live, partEls, partPts, lines, vw, vh)
  } finally {
    host.remove()
  }
  // Fills only (strokes switched off) for the area to fill; everything for the colours.
  const fillsOnly = full.replace(/<svg([^>]*)>/i, '<svg$1><style>*{stroke:none!important}</style>')
  const max = 300
  const [fills, colours] = await Promise.all([rasterize(fillsOnly, max), rasterize(full, max)])
  const mask = encodeMask(fills.w, fills.h, (x, y) => fills.data[(y * fills.w + x) * 4 + 3]! > 128)
  const rgb = new Uint8Array(colours.w * colours.h * 3)
  for (let i = 0; i < colours.w * colours.h; i++) {
    let r = colours.data[i * 4]!, g = colours.data[i * 4 + 1]!, b = colours.data[i * 4 + 2]!
    const a = colours.data[i * 4 + 3]!
    if (a < 40 || Math.max(r, g, b) < 60) { r = g = b = 235 } // empty or dark ink → white light
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b
  }
  return { kind: 'image', size, name, mask, colors: bytesToBase64(rgb), cw: colours.w, ch: colours.h, ...(lines.length ? { lines } : {}), ...(moving ? moving : {}) }
}

/**
 * A drawing's moving parts, from its markup: any element (usually a <g>) with
 *   data-part="Left wing"         the part's name; every stroke inside it moves with it
 *   data-motion="swing|turn|slide" (default swing)
 *   data-pivot="x y"              the hinge, in the element's own coordinates (default: its centre)
 *   data-amount="20"              degrees either way (swing), degrees per second (turn), metres either way (slide)
 *   data-period="8"               seconds per beat (swing, slide)
 *   data-phase="0.5"              offset in the beat, 0–1 (0.5 = the opposite way)
 *   data-axis="0 0 1"             x right, y up, z toward the audience; swings in the drawing's plane by default
 *   data-parent="Upper arm"       hangs off another part (or the data-part element it sits in)
 * A part without strokes (only fills) moves by its outline.
 */
function svgParts(live: SVGSVGElement, els: SVGGraphicsElement[], pts: [number, number][][], lines: { part?: number }[], vw: number, vh: number): { parts: DrawingPart[]; joints: ModelJoint[] } {
  const names = els.map((el, i) => (el.getAttribute('data-part') || `Part ${i + 1}`).slice(0, 60))
  const ids = names.map((nm, i) => `${nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part'}-${i}`)
  const num = (v: string | null, d: number, lo: number, hi: number) => { const x = Number.parseFloat(v ?? ''); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d }
  const stroked = new Set(lines.map((l) => l.part).filter((p): p is number => p !== undefined))
  const parts: DrawingPart[] = [], joints: ModelJoint[] = []
  els.forEach((el, i) => {
    const kindAttr = el.getAttribute('data-motion')
    const kind: JointKind = kindAttr === 'turn' || kindAttr === 'slide' ? kindAttr : 'swing'
    // The hinge: given in the element's own coordinates, mapped to the picture; else the part's centre.
    let pivot: Vec3
    const pv = (el.getAttribute('data-pivot') ?? '').trim().split(/[\s,]+/).map(Number)
    if (pv.length >= 2 && pv.every(Number.isFinite)) {
      const p = live.createSVGPoint()
      p.x = pv[0]!; p.y = pv[1]!
      const m = el.getCTM()
      const r = m ? p.matrixTransform(m) : p
      pivot = [Math.round((r.x / vw) * 1e4) / 1e4, Math.round((r.y / vh) * 1e4) / 1e4, 0]
    } else {
      const q = pts[i]!
      const c = q.length ? q.reduce((a, b) => [a[0] + b[0] / q.length, a[1] + b[1] / q.length], [0, 0]) : [0.5, 0.5]
      pivot = [Math.round(c[0]! * 1e4) / 1e4, Math.round(c[1]! * 1e4) / 1e4, 0]
    }
    const ax = (el.getAttribute('data-axis') ?? '').trim().split(/[\s,]+/).map(Number)
    const axis: Vec3 = ax.length === 3 && ax.every(Number.isFinite) && Math.hypot(...ax) > 1e-9 ? [ax[0]!, ax[1]!, ax[2]!] : kind === 'slide' ? [0, 1, 0] : [0, 0, 1]
    const amount = kind === 'turn' ? num(el.getAttribute('data-amount'), 20, -720, 720) : kind === 'slide' ? num(el.getAttribute('data-amount'), 2, -100, 100) : num(el.getAttribute('data-amount'), 20, 0, 180)
    const parentName = el.getAttribute('data-parent')
    let parent = parentName ? names.findIndex((nm) => nm.toLowerCase() === parentName.toLowerCase()) : -1
    if (parent < 0 && el.parentElement) { const up = el.parentElement.closest('[data-part]'); parent = up ? els.indexOf(up as SVGGraphicsElement) : -1 }
    joints.push({
      id: ids[i]!, name: names[i]!, pivot, kind, axis, amount,
      period: num(el.getAttribute('data-period'), 8, 0.5, 120), phase: num(el.getAttribute('data-phase'), 0, -1, 1),
      ...(parent >= 0 && parent !== i ? { parent: ids[parent]! } : {}),
    })
    // Fill-only parts move by their outline (the hull of their geometry).
    const region = !stroked.has(i) && pts[i]!.length >= 3 ? hull(pts[i]!) : null
    parts.push({ name: names[i]!, joint: ids[i]!, ...(region && region.length >= 3 ? { region } : {}) })
  })
  return { parts, joints }
}

/** Convex hull (monotone chain), at most 64 points. */
function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = [], upper: [number, number][] = []
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q) }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q) }
  const h = lower.slice(0, -1).concat(upper.slice(0, -1))
  const k = Math.max(1, Math.ceil(h.length / 64))
  return h.filter((_, i) => i % k === 0).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4])
}
