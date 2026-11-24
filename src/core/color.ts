export type RGB = [number, number, number]

const cache = new Map<string, RGB>()

/** Parse "#rgb" / "#rrggbb" into linear-ish 0..1 sRGB components. */
export function hexToRgb(hex: string): RGB {
  const hit = cache.get(hex)
  if (hit) return hit
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  const rgb: RGB = Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : [1, 1, 1]
  cache.set(hex, rgb)
  return rgb
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** HSV → RGB, h in [0,1). */
export function hsv(h: number, s: number, v: number): RGB {
  h = ((h % 1) + 1) % 1
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0: return [v, t, p]
    case 1: return [q, v, p]
    case 2: return [p, v, t]
    case 3: return [p, q, v]
    case 4: return [t, p, v]
    default: return [v, p, q]
  }
}

/** A pleasant palette for new scenes. */
export const PALETTE = ['#38bdf8', '#f472b6', '#facc15', '#a78bfa', '#34d399', '#fb923c', '#f87171', '#e2e8f0']
