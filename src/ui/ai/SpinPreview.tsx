import { useEffect, useRef } from 'react'

/** A slowly turning, depth-shaded dot preview of a 3D formation. */
export function SpinPreview({ points, colors, size = 260 }: { points: Float32Array; colors: Float32Array | null; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = size * dpr
    cv.height = size * dpr
    const ctx = cv.getContext('2d')!
    const n = points.length / 3
    const c = [0, 0, 0]
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k]! += points[i * 3 + k]! / n
    let ext = 1e-6
    for (let i = 0; i < n; i++) ext = Math.max(ext, Math.hypot(points[i * 3]! - c[0]!, points[i * 3 + 2]! - c[2]!), Math.abs(points[i * 3 + 1]! - c[1]!))
    const scale = (size / 2 - 14) / ext
    const r = Math.max(1.2, Math.min(3, 80 / Math.sqrt(Math.max(1, n))))
    const proj = new Float32Array(n * 3)
    const order = Array.from({ length: n }, (_, i) => i)
    let raf = 0
    const t0 = performance.now()
    const draw = (now: number) => {
      const a = ((now - t0) / 1000) * 0.6
      const ca = Math.cos(a), sa = Math.sin(a), tilt = 0.18, ct = Math.cos(tilt), st = Math.sin(tilt)
      for (let i = 0; i < n; i++) {
        const x = points[i * 3]! - c[0]!, y = points[i * 3 + 1]! - c[1]!, z = points[i * 3 + 2]! - c[2]!
        const x1 = x * ca + z * sa, z1 = -x * sa + z * ca
        proj[i * 3] = x1
        proj[i * 3 + 1] = y * ct - z1 * st
        proj[i * 3 + 2] = y * st + z1 * ct
      }
      order.sort((p, q) => proj[p * 3 + 2]! - proj[q * 3 + 2]!)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#04060b'
      ctx.fillRect(0, 0, size, size)
      for (const i of order) {
        const depth = (proj[i * 3 + 2]! / ext + 1) / 2
        const k = 0.3 + 0.7 * depth
        const R = colors ? colors[i * 3]! : 1, G = colors ? colors[i * 3 + 1]! : 1, B = colors ? colors[i * 3 + 2]! : 1
        if (R + G + B < 0.03) continue
        ctx.fillStyle = `rgb(${Math.round(R * 255 * k)},${Math.round(G * 255 * k)},${Math.round(B * 255 * k)})`
        ctx.beginPath()
        ctx.arc(size / 2 + proj[i * 3]! * scale, size / 2 - proj[i * 3 + 1]! * scale, r * (0.65 + 0.35 * depth), 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [points, colors, size])
  return <canvas ref={ref} style={{ width: size, height: size, borderRadius: 10, display: 'block' }} aria-label="Turning preview of the drone formation" />
}
