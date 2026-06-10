// ============================================================================
// L1 (2026-05-21) — RegistryItemPreview
// ----------------------------------------------------------------------------
// Small live previews of registry items (generators, idle behaviors, color
// programs, transitions). Adopted by inspectors, the asset panel, and the AI
// tool-call cards (L3) so users can see what they're configuring without
// triggering a full editor evaluation.
//
// Implementation note: this is a 2D SVG projection of the registry item's
// output rather than a real 3D Canvas. The trade-off — way cheaper to mount
// 20+ of these in one panel without contention on the main viewport.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Vec3 } from '../graph/types'
import { getGenerator } from '../registries/generators'
import { getIdleBehavior } from '../registries/idleBehaviors'
import { getColorProgram, evaluateColorProgram } from '../graph/colorPrograms'

export interface RegistryItemPreviewProps {
  kind: 'generator' | 'idle' | 'color' | 'transition'
  id: string
  params?: Record<string, number>
  /** Preview size in CSS pixels. Default 64. */
  size?: number
  /** Loop period in seconds for animated previews. Default 4. */
  period?: number
  /** Show a thin border + background. Default true. */
  framed?: boolean
}

// ─── Projection helpers ─────────────────────────────────────────────────────

interface ProjectedPoint { x: number; y: number; depth: number }

function projectOrthoTopDown(points: Vec3[], width: number, height: number, padding = 4): ProjectedPoint[] {
  if (points.length === 0) return []
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z
  }
  const spanX = Math.max(0.01, maxX - minX)
  const spanZ = Math.max(0.01, maxZ - minZ)
  const innerW = width - padding * 2
  const innerH = height - padding * 2
  const scale = Math.min(innerW / spanX, innerH / spanZ)
  const cx = padding + innerW / 2
  const cy = padding + innerH / 2
  const ox = (minX + maxX) / 2
  const oz = (minZ + maxZ) / 2
  return points.map((p) => ({
    x: cx + (p.x - ox) * scale,
    y: cy + (p.z - oz) * scale,
    depth: p.y,
  }))
}

// ─── useRafTime — minimal animation loop for previews ───────────────────────

function useRafTime(active: boolean, period: number): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number): void => {
      const dt = ((now - start) / 1000) % period
      setT(dt)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, period])
  return t
}

// ─── The component ──────────────────────────────────────────────────────────

export function RegistryItemPreview({
  kind,
  id,
  params,
  size = 64,
  period = 4,
  framed = true,
}: RegistryItemPreviewProps) {
  // Pause the RAF loop when the tab/element isn't visible.
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    if (!ref.current) return
    const obs = new IntersectionObserver(([entry]) => {
      setVisible(!!entry?.isIntersecting)
    }, { threshold: 0 })
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  const animated = kind === 'idle' || kind === 'color' || kind === 'transition'
  const t = useRafTime(visible && animated, period)

  const content = useMemo(() => {
    if (kind === 'generator') return <GeneratorPreview id={id} params={params} size={size} />
    if (kind === 'idle') return <IdlePreview id={id} params={params} size={size} time={t} />
    if (kind === 'color') return <ColorProgramPreview id={id} size={size} time={t} />
    if (kind === 'transition') return <TransitionPreview id={id} size={size} time={t} period={period} />
    return null
  }, [kind, id, params, size, t, period])

  return (
    <div
      ref={ref}
      style={{ width: size, height: size }}
      className={framed ? 'rounded border border-white/10 bg-surface-raised/50 overflow-hidden' : 'overflow-hidden'}
    >
      {content}
    </div>
  )
}

// ─── kind = 'generator' ─────────────────────────────────────────────────────

function GeneratorPreview({ id, params, size }: { id: string; params?: Record<string, number>; size: number }) {
  const points = useMemo(() => {
    const def = getGenerator(id)
    if (!def) return []
    try {
      return def.generate({ ...def.defaultParams, ...(params ?? {}) })
    } catch { return [] }
  }, [id, params])
  const proj = useMemo(() => projectOrthoTopDown(points, size, size), [points, size])
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {proj.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={Math.max(0.5, size / 80)} fill="rgb(34, 211, 238)" opacity={0.8} />
      ))}
    </svg>
  )
}

// ─── kind = 'idle' ──────────────────────────────────────────────────────────

const IDLE_DRONE_COUNT = 24

function IdlePreview({ id, params, size, time }: { id: string; params?: Record<string, number>; size: number; time: number }) {
  const behavior = getIdleBehavior(id)
  const center: Vec3 = { x: 0, y: 0, z: 0 }
  const home: Vec3 = { x: 0, y: 0, z: 0 }
  const effective = {
    center,
    radius: params?.radius ?? 4,
    speed: params?.speed ?? 1,
    altitude: params?.altitude ?? 0,
  }
  const points: Vec3[] = useMemo(() => {
    if (!behavior) return []
    const out: Vec3[] = []
    for (let i = 0; i < IDLE_DRONE_COUNT; i++) {
      out.push(behavior.getPosition(i, IDLE_DRONE_COUNT, time, effective, home))
    }
    return out
  }, [behavior, effective, time])
  const proj = projectOrthoTopDown(points, size, size)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {proj.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={Math.max(0.5, size / 70)} fill="rgb(34, 211, 238)" opacity={0.85} />
      ))}
    </svg>
  )
}

// ─── kind = 'color' ─────────────────────────────────────────────────────────

const COLOR_SWATCH_COUNT = 8

function ColorProgramPreview({ id, size, time }: { id: string; size: number; time: number }) {
  const program = getColorProgram(id)
  const swatches = useMemo(() => {
    if (!program) return Array.from({ length: COLOR_SWATCH_COUNT }, () => ({ r: 0.5, g: 0.5, b: 0.5 }))
    return Array.from({ length: COLOR_SWATCH_COUNT }, (_, i) => {
      const samplePos = { x: i - COLOR_SWATCH_COUNT / 2, y: 0, z: 0 }
      return evaluateColorProgram(program, i, COLOR_SWATCH_COUNT, samplePos, time)
    })
  }, [program, time])
  const w = size
  const h = size
  const stripe = (w - 8) / COLOR_SWATCH_COUNT
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {swatches.map((c, i) => (
        <rect
          key={i}
          x={4 + i * stripe}
          y={h * 0.25}
          width={stripe - 1}
          height={h * 0.5}
          fill={`rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`}
          rx={2}
        />
      ))}
    </svg>
  )
}

// ─── kind = 'transition' ────────────────────────────────────────────────────
// Strategy-aware previews. Each strategy renders a small canonical animation
// that captures its visual signature; nothing here invokes the bake worker.
// The preview is a *feeling*, not a faithful reproduction.

function TransitionPreview({ id, size, time, period }: { id: string; size: number; time: number; period: number }) {
  const N = 18
  const t = (time % period) / period
  const phase = t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2

  const points: Vec3[] = useMemo(() => buildTransitionPoints(id, N, phase, t), [id, phase, t])
  const proj = projectOrthoTopDown(points, size, size)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {proj.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={Math.max(0.5, size / 60)} fill="rgb(168, 85, 247)" opacity={0.85} />
      ))}
    </svg>
  )
}

function buildTransitionPoints(id: string, N: number, phase: number, raw: number): Vec3[] {
  // Helper: source = ring radius 3, target = ring radius 5 rotated half-step.
  const src = (i: number): Vec3 => {
    const a = (i / N) * Math.PI * 2
    return { x: Math.cos(a) * 3, y: 0, z: Math.sin(a) * 3 }
  }
  const tgt = (i: number): Vec3 => {
    const a = ((i + 0.5) / N) * Math.PI * 2 + Math.PI / 2
    return { x: Math.cos(a) * 5, y: 0, z: Math.sin(a) * 5 }
  }
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const out: Vec3[] = []

  switch (id) {
    case 'stagger': {
      // Each drone starts at a slightly different time, so the swarm "peels"
      // from one ring to the other.
      for (let i = 0; i < N; i++) {
        const stagger = i / N
        const local = Math.max(0, Math.min(1, (phase - stagger * 0.4) / (1 - stagger * 0.4)))
        const s = src(i), e = tgt(i)
        out.push({ x: lerp(s.x, e.x, local), y: 0, z: lerp(s.z, e.z, local) })
      }
      return out
    }
    case 'spiral': {
      // Drones rotate around an axis as they interpolate — circular arc instead
      // of straight line.
      const turns = 1
      for (let i = 0; i < N; i++) {
        const s = src(i), e = tgt(i)
        const cx = lerp(s.x, e.x, phase)
        const cz = lerp(s.z, e.z, phase)
        const swirl = Math.sin(phase * Math.PI) * 1.5
        const a = phase * Math.PI * 2 * turns + (i / N) * Math.PI * 2
        out.push({ x: cx + Math.cos(a) * swirl, y: 0, z: cz + Math.sin(a) * swirl })
      }
      return out
    }
    case 'explosion': {
      // Burst outward then converge: at phase 0.4 drones are at max scatter.
      for (let i = 0; i < N; i++) {
        const s = src(i), e = tgt(i)
        const blow = Math.sin(phase * Math.PI) * 3 // outward distance
        const dir = { x: Math.cos((i / N) * Math.PI * 2), z: Math.sin((i / N) * Math.PI * 2) }
        out.push({
          x: lerp(s.x, e.x, phase) + dir.x * blow,
          y: 0,
          z: lerp(s.z, e.z, phase) + dir.z * blow,
        })
      }
      return out
    }
    case 'implosion': {
      // Drones collapse toward center first, then expand to target.
      for (let i = 0; i < N; i++) {
        const s = src(i), e = tgt(i)
        const pull = phase < 0.5 ? phase * 2 : (1 - phase) * 2
        out.push({ x: lerp(s.x, e.x, phase) * (1 - pull * 0.7), y: 0, z: lerp(s.z, e.z, phase) * (1 - pull * 0.7) })
      }
      return out
    }
    case 'cascade': {
      // Wave-like sweep — drones near one side arrive first.
      for (let i = 0; i < N; i++) {
        const s = src(i), e = tgt(i)
        const order = (s.x + 5) / 10
        const local = Math.max(0, Math.min(1, (phase - order * 0.5) / 0.5))
        out.push({ x: lerp(s.x, e.x, local), y: 0, z: lerp(s.z, e.z, local) })
      }
      return out
    }
    case 'morph': {
      // Straight lerp with a small arc lift so paths don't cross.
      for (let i = 0; i < N; i++) {
        const s = src(i), e = tgt(i)
        const arc = Math.sin(phase * Math.PI) * 1.5 * (i % 2 === 0 ? 1 : -1)
        out.push({ x: lerp(s.x, e.x, phase), y: arc, z: lerp(s.z, e.z, phase) })
      }
      return out
    }
    case 'color-sweep': {
      // Positions move minimally; the visual signature is color (not in this preview).
      // Render a gentle nudge for motion feedback.
      for (let i = 0; i < N; i++) {
        const s = src(i), e = tgt(i)
        out.push({ x: lerp(s.x, e.x, phase), y: 0, z: lerp(s.z, e.z, phase) })
      }
      return out
    }
    case 'bounce': {
      // Decaying overshoot oscillation — drones pass their target then settle.
      for (let i = 0; i < N; i++) {
        const s = src(i), e = tgt(i)
        const overshoot = phase < 0.8
          ? phase / 0.8
          : 1 + Math.sin((phase - 0.8) * Math.PI * 8) * (1 - phase) * 0.6
        out.push({ x: lerp(s.x, e.x, overshoot), y: 0, z: lerp(s.z, e.z, overshoot) })
      }
      return out
    }
    default: {
      // Generic shortest-path (Hungarian fallback): linear interp.
      void raw
      for (let i = 0; i < N; i++) {
        const s = src(i), e = tgt(i)
        out.push({ x: lerp(s.x, e.x, phase), y: 0, z: lerp(s.z, e.z, phase) })
      }
      return out
    }
  }
}
