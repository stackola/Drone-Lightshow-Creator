// Light effects. Each drone's colour is a pure function of the effect, the
// drone's place in its shape, and time — so preview and export agree exactly.

import type { Effect, EffectKind } from './types'
import { hexToRgb, hsv, type RGB } from './color'
import { DEG, hash01 } from './math'
import { dotTextBitmap } from './pixelFont'

export interface DroneLook {
  /** Local position normalised to roughly [-1, 1] by the layer's largest half-extent. */
  u: number
  v: number
  /** 0..1 along the shape's natural order (outline direction, reading order). */
  order: number
  /** Stable random in [0, 1). */
  rand: number
  /** Letters in the shape (text), 0 otherwise. For text, order = (letter + pen fraction) / glyphs. */
  glyphs: number
  /** The layer's half-width and half-height in u/v units (for dot-matrix text). */
  uh: number
  vh: number
  /** Rows of drones if the layer is a grid (an LED panel), else 0. */
  rows: number
  /** Image colour if the shape has one. */
  image: RGB | null
}

export function blankLook(): DroneLook {
  return { u: 0, v: 0, order: 0, rand: 0, glyphs: 0, uh: 1, vh: 1, rows: 0, image: null }
}

/** Effects that reveal or display text, driven by each drone's letter and pen order. */
export const TEXT_EFFECTS: EffectKind[] = ['write', 'type', 'flip', 'matrix']

export interface EffectDef {
  kind: EffectKind
  label: string
}

export const EFFECTS: EffectDef[] = [
  { kind: 'solid', label: 'Solid' },
  { kind: 'gradient', label: 'Gradient' },
  { kind: 'rainbow', label: 'Rainbow' },
  { kind: 'pulse', label: 'Pulse' },
  { kind: 'twinkle', label: 'Twinkle' },
  { kind: 'chase', label: 'Chase' },
  { kind: 'wave', label: 'Wave' },
  { kind: 'image', label: 'Shape colours' },
  { kind: 'flash', label: 'Flash' },
  { kind: 'strobe', label: 'Strobe' },
  { kind: 'off', label: 'Lights off' },
  { kind: 'write', label: 'Write on' },
  { kind: 'type', label: 'Typewriter' },
  { kind: 'flip', label: 'Flip board' },
  { kind: 'matrix', label: 'LED text' },
]

export function defaultEffect(kind: EffectKind, base = '#38bdf8'): Effect {
  switch (kind) {
    case 'solid': return { kind, color: base, brightness: 1 }
    case 'gradient': return { kind, a: base, b: '#f472b6', angle: 90, brightness: 1 }
    case 'rainbow': return { kind, angle: 0, speed: 0.15, scale: 1, brightness: 1 }
    case 'pulse': return { kind, a: base, b: '#0b1020', period: 1, beatSync: true, brightness: 1 }
    case 'twinkle': return { kind, a: base, b: '#ffffff', rate: 1.5, brightness: 1 }
    case 'chase': return { kind, a: '#1e293b', b: base, speed: 0.4, width: 0.15, brightness: 1 }
    case 'wave': return { kind, a: base, b: '#ffffff', angle: 0, speed: 0.5, width: 0.3, brightness: 1 }
    case 'image': return { kind, brightness: 1 }
    case 'flash': return { kind, color: '#ffffff', decay: 0.35, beatSync: true, every: 1, brightness: 1 }
    case 'strobe': return { kind, color: '#ffffff', rate: 8, brightness: 1 }
    case 'off': return { kind, brightness: 0 }
    case 'write': return { kind, a: base, b: '#000000', pen: '#ffffff', duration: 4, brightness: 1 }
    case 'type': return { kind, a: base, b: '#000000', cursor: '#ffffff', duration: 3, brightness: 1 }
    case 'flip': return { kind, a: base, b: '#10131c', duration: 3, rate: 12, brightness: 1 }
    case 'matrix': return { kind, text: 'HELLO', a: '#ffb020', b: '#1c1406', speed: 6, font: 7, brightness: 1 }
  }
}

/**
 * Beat clock at show time t: phase within the current beat (0..1), the beat's
 * index, and seconds since it started — or null outside the music.
 */
export type BeatPhase = (t: number) => { phase: number; index: number; since: number } | null

const WHITE: RGB = [1, 1, 1]

function setHex(hex: string, out: RGB): RGB {
  const c = hexToRgb(hex)
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2]
  return out
}

const bitmaps = new Map<string, { w: number; h: number; on: Uint8Array }>()

/** Dot-matrix bitmap of a line of text, 5×7 (height 7) or 3×5 (height 5) letters (cached). */
export function textBitmap(text: string, height: 5 | 7 = 7): { w: number; h: number; on: Uint8Array } {
  const key = `${height}|${text}`
  let b = bitmaps.get(key)
  if (!b) {
    b = dotTextBitmap(text.replace(/\s+/g, ' ').trim() || ' ', height)
    if (bitmaps.size > 64) bitmaps.clear()
    bitmaps.set(key, b)
  }
  return b
}

function mix(a: RGB, b: RGB, t: number, out: RGB): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}

/**
 * Colour of one drone.
 * @param tau seconds since the formation's hold started
 * @param t   show time (for beat sync)
 */
export function effectColor(e: Effect, d: DroneLook, tau: number, t: number, beat: BeatPhase, out: RGB): RGB {
  switch (e.kind) {
    case 'solid': {
      const c = hexToRgb(e.color)
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]
      break
    }
    case 'gradient': {
      const a = e.angle * DEG
      const p = (d.u * Math.cos(a) + d.v * Math.sin(a)) * 0.5 + 0.5
      mix(hexToRgb(e.a), hexToRgb(e.b), Math.max(0, Math.min(1, p)), out)
      break
    }
    case 'rainbow': {
      const a = e.angle * DEG
      const p = (d.u * Math.cos(a) + d.v * Math.sin(a)) * 0.5 * e.scale
      const c = hsv(p + tau * e.speed, 0.85, 1)
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]
      break
    }
    case 'pulse': {
      const b = e.beatSync ? beat(t) : null
      // On beat: snap to A then decay to B. Free-running: smooth sine.
      const k = b !== null ? Math.exp(-b.phase * 5) : 0.5 + 0.5 * Math.cos((tau / Math.max(0.05, e.period)) * Math.PI * 2)
      mix(hexToRgb(e.b), hexToRgb(e.a), k, out)
      break
    }
    case 'twinkle': {
      const speed = e.rate * (0.6 + 0.8 * d.rand)
      const x = Math.sin(tau * speed * Math.PI * 2 + d.rand * 40)
      const k = Math.pow(Math.max(0, x), 12)
      mix(hexToRgb(e.a), hexToRgb(e.b), k, out)
      break
    }
    case 'chase': {
      let p = (d.order - tau * e.speed) % 1
      if (p < 0) p += 1
      const w = Math.max(0.01, e.width)
      const k = p < w ? 1 - p / w : 0
      mix(hexToRgb(e.a), hexToRgb(e.b), k, out)
      break
    }
    case 'wave': {
      const a = e.angle * DEG
      const p = (d.u * Math.cos(a) + d.v * Math.sin(a)) * 0.5 + 0.5
      let x = (p - tau * e.speed) % 1
      if (x < 0) x += 1
      const w = Math.max(0.02, e.width)
      const k = Math.max(0, 1 - Math.abs(x - 0.5) / (w / 2))
      mix(hexToRgb(e.a), hexToRgb(e.b), k * k * (3 - 2 * k), out)
      break
    }
    case 'image': {
      // Colours carried by the shape itself (images and 3D models).
      const c = d.image ?? [1, 1, 1]
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]
      break
    }
    case 'flash': {
      // Flash on every Nth beat when synced (and music is playing), else once at the start.
      let since = tau
      if (e.beatSync) {
        const b = beat(t)
        if (b) {
          const every = Math.max(1, Math.round(e.every))
          const k = ((b.index % every) + every) % every
          // Seconds since the last flash beat: approximate earlier beats by this beat's length.
          const len = b.phase > 0 ? b.since / b.phase : 0.5
          since = b.since + k * len
        }
      }
      const k = since >= 0 ? Math.exp(-since / Math.max(0.02, e.decay)) : 0
      const c = hexToRgb(e.color)
      out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k
      break
    }
    case 'strobe': {
      const on = (tau * e.rate) % 1 < 0.35
      const c = hexToRgb(e.color)
      out[0] = on ? c[0] : 0; out[1] = on ? c[1] : 0; out[2] = on ? c[2] : 0
      break
    }
    case 'off': {
      out[0] = 0; out[1] = 0; out[2] = 0
      break
    }
    case 'write': {
      // Pen progress in order units; the newest-lit drones glow in the pen colour.
      const G = Math.max(1, d.glyphs)
      const P = Math.max(0, Math.min(1, tau / Math.max(0.1, e.duration)))
      if (d.order <= P) {
        const w = Math.min(0.08, 0.35 / G)
        const k = P < 1 ? (P - d.order) / w : 1
        mix(hexToRgb(e.pen), hexToRgb(e.a), Math.min(1, k), out)
      } else setHex(e.b, out)
      break
    }
    case 'type': {
      // Whole letters appear one after another; the next letter blinks as a cursor.
      const G = d.glyphs > 0 ? d.glyphs : 12
      const dur = Math.max(0.1, e.duration)
      const P = Math.max(0, Math.min(1, tau / dur))
      const shown = Math.floor(P * G + 1e-6)
      const g = Math.min(G - 1, Math.floor(d.order * G))
      if (g < shown) {
        const age = tau - ((g + 1) / G) * dur
        mix(hexToRgb(e.a), WHITE, age >= 0 ? Math.exp(-age / 0.12) * 0.8 : 0, out)
      } else if (g === shown && P < 1 && Math.floor(tau * 3) % 2 === 0) {
        mix(hexToRgb(e.b), hexToRgb(e.cursor), 0.55, out)
      } else setHex(e.b, out)
      break
    }
    case 'flip': {
      // Each letter flickers through random states, then settles; letters settle left to right.
      const G = d.glyphs > 0 ? d.glyphs : 10
      const g = Math.min(G - 1, Math.floor(d.order * G))
      const settle = ((g + 1) / G) * Math.max(0.1, e.duration)
      if (tau >= settle) {
        mix(hexToRgb(e.a), WHITE, Math.exp(-(tau - settle) / 0.1) * 0.7, out)
      } else {
        const tick = Math.floor(tau * Math.max(1, e.rate))
        const r = hash01(Math.floor(d.rand * 1e6) + tick * 7919, 31)
        if (r < 0.45) setHex(e.b, out)
        else if (r < 0.8) setHex(e.a, out)
        else { out[0] = 0.9; out[1] = 0.92; out[2] = 1 }
      }
      break
    }
    case 'matrix': {
      // Dot-matrix text. On a grid (an LED panel) each font dot is one drone row/column, with the text
      // centred vertically if the panel is taller than the font; elsewhere the font fills the shape's height.
      const H = e.font === 5 ? 5 : 7
      const bmp = textBitmap(e.text, H)
      const vh = d.vh > 1e-6 ? d.vh : 1, uh = d.uh > 1e-6 ? d.uh : 1
      const panelRows = d.rows >= H ? d.rows : H
      const pitch = (2 * vh) / Math.max(1, panelRows - 1)
      // A small bias keeps exact half-pitch positions (even column counts) rounding the same way despite float noise.
      const row = Math.round((vh - d.v) / pitch + 1e-4) - Math.floor((panelRows - H) / 2)
      const x = d.u / pitch + 1e-4
      let c: number
      if (e.speed > 0) {
        // Scroll right to left, one column at a time, entering at the right edge and fully leaving before repeating.
        const half = uh / pitch
        const period = bmp.w + Math.round(2 * half) + 2
        const raw = Math.round(x - half + Math.floor(tau * e.speed))
        c = ((raw % period) + period) % period
      } else c = Math.round(x + (bmp.w - 1) / 2)
      const lit = row >= 0 && row < bmp.h && c >= 0 && c < bmp.w && bmp.on[row * bmp.w + c] === 1
      setHex(lit ? e.a : e.b, out)
      break
    }
  }
  const b = Math.max(0, Math.min(1, e.brightness))
  out[0] *= b; out[1] *= b; out[2] *= b
  return out
}

/** Representative colour for UI chips. */
export function effectSwatch(e: Effect): string {
  switch (e.kind) {
    case 'solid': return e.color
    case 'gradient': return `linear-gradient(90deg, ${e.a}, ${e.b})`
    case 'rainbow': return 'linear-gradient(90deg,#f87171,#facc15,#4ade80,#38bdf8,#a78bfa,#f472b6)'
    case 'pulse': return `linear-gradient(90deg, ${e.a}, ${e.b})`
    case 'twinkle': return `linear-gradient(90deg, ${e.a}, ${e.b})`
    case 'chase': return `linear-gradient(90deg, ${e.a}, ${e.b})`
    case 'wave': return `linear-gradient(90deg, ${e.a}, ${e.b}, ${e.a})`
    case 'image': return 'linear-gradient(90deg,#f87171,#38bdf8)'
    case 'write': return `linear-gradient(90deg, ${e.a} 0 60%, ${e.pen} 60% 70%, ${e.b} 70%)`
    case 'type': return `linear-gradient(90deg, ${e.a} 0 55%, ${e.cursor} 55% 65%, ${e.b} 65%)`
    case 'flip': return `repeating-linear-gradient(90deg, ${e.a} 0 5px, ${e.b} 5px 7px)`
    case 'matrix': return `radial-gradient(circle, ${e.a} 0 1.5px, ${e.b} 2px) 0 0 / 5px 5px`
    case 'flash': return e.color
    case 'strobe': return `repeating-linear-gradient(90deg, ${e.color} 0 4px, #000 4px 8px)`
    case 'off': return '#05070d'
  }
}

export { mix }
