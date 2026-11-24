import { useEffect, useRef } from 'react'

/** Front-view (audience) dot rendering of a point set. */
export function Thumb({ points, colors, width, height, color = '#f5b544', className }: { points: Float32Array | null; colors?: Float32Array | null; width: number; height: number; color?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = width * dpr
    cv.height = height * dpr
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (!points || points.length === 0) return
    const n = points.length / 3
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let i = 0; i < n; i++) {
      const x = points[i * 3]!, y = points[i * 3 + 1]!
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
    const pad = 5
    const s = Math.min((width - pad * 2) / Math.max(1e-6, maxX - minX), (height - pad * 2) / Math.max(1e-6, maxY - minY))
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    const r = Math.max(0.8, Math.min(2.2, 70 / Math.sqrt(n) / 3))
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < n; i++) {
      const x = width / 2 + (points[i * 3]! - cx) * s
      const y = height / 2 - (points[i * 3 + 1]! - cy) * s
      let fill = color
      if (colors) {
        const R = colors[i * 3]!, G = colors[i * 3 + 1]!, B = colors[i * 3 + 2]!
        if (R + G + B < 0.03) continue
        fill = `rgb(${Math.round(R * 255)},${Math.round(G * 255)},${Math.round(B * 255)})`
      }
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [points, colors, width, height, color])
  return <canvas ref={ref} className={className} style={{ width, height }} />
}
