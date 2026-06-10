// ============================================================================
// S10-06: Easing Preview Widget + S10-07: Full easing library
// L4 (2026-05-21): Replaced the native <select> with a popover grid of curve
// tiles. All 32 easings (31 presets + Custom Bézier) visible at once,
// grouped by family. Each tile shows the actual curve via SVG. Click to
// select. When the user picks "Custom Bézier", a draggable editor renders
// below the grid so the four control-point values can be tuned by hand.
// ============================================================================

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { EASING_TYPES, applyEasing, type EasingType, type CubicBezierConfig, DEFAULT_BEZIER } from '../../graph/easing'
import { ChevronDown } from 'lucide-react'
import { ACCENT_PRIMARY, ACCENT_HIGHLIGHT } from '../../ui/colors'

interface EasingSelectProps {
  value: EasingType
  onChange: (easing: EasingType) => void
  /** When `value === 'cubic-bezier'`, the {x1,y1,x2,y2} the curve uses. */
  bezierConfig?: CubicBezierConfig
  /** Called when the user drags one of the editor's two control points. */
  onBezierConfigChange?: (config: CubicBezierConfig) => void
}

export function EasingSelect({ value, onChange, bezierConfig, onBezierConfigChange }: EasingSelectProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const groups = useMemo(() => {
    const grouped = new Map<string, { id: EasingType; label: string }[]>()
    for (const et of EASING_TYPES) {
      let list = grouped.get(et.group)
      if (!list) { list = []; grouped.set(et.group, list) }
      list.push({ id: et.id, label: et.label })
    }
    return Array.from(grouped.entries())
  }, [])

  // Click-outside closes.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const selectedLabel = EASING_TYPES.find((e) => e.id === value)?.label ?? value
  const cfg = bezierConfig ?? DEFAULT_BEZIER

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 bg-surface-hover border border-white/10 rounded px-2 py-0.5 text-xs text-white/80 outline-none hover:border-white/20 focus:border-cyan-500/50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <EasingCurve easing={value} size={20} accent bezierConfig={cfg} />
        <span className="flex-1 text-left truncate">{selectedLabel}</span>
        <ChevronDown size={12} className="text-white/40" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 z-40 w-[320px] bg-surface-raised/95 border border-white/10 rounded-lg shadow-2xl backdrop-blur-sm overflow-hidden"
        >
          <div className="max-h-[60vh] overflow-y-auto p-1">
            {groups.map(([group, options]) => (
              <div key={group} className="mb-1">
                <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-white/30">{group}</div>
                <div className="grid grid-cols-3 gap-1">
                  {options.map((opt) => {
                    const active = opt.id === value
                    return (
                      <button
                        key={opt.id}
                        role="option"
                        aria-selected={active}
                        onClick={() => { onChange(opt.id); setOpen(false) }}
                        className={`flex flex-col items-stretch gap-0.5 rounded p-1 text-[9px] leading-tight transition-colors ${
                          active ? 'bg-cyan-500/20 ring-1 ring-cyan-400/60 text-cyan-100' : 'bg-white/5 hover:bg-white/10 text-white/60'
                        }`}
                      >
                        <EasingCurve easing={opt.id} size={28} accent={active} bezierConfig={opt.id === 'cubic-bezier' ? cfg : undefined} />
                        <span className="truncate text-center">{opt.label.replace(/^Ease /, '')}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Draggable Bézier editor — only when "Custom" is the selected easing
                AND an `onBezierConfigChange` handler was wired (otherwise it'd
                be a read-only widget). */}
            {value === 'cubic-bezier' && onBezierConfigChange && (
              <div className="mt-1 px-2 py-2 border-t border-white/10">
                <div className="text-[9px] uppercase tracking-wider text-white/30 mb-1">Custom Bézier</div>
                <BezierEditor config={cfg} onChange={onBezierConfigChange} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Standalone curve preview — used by EasingSelect, also exported for elsewhere.
 *  When `easing === 'cubic-bezier'`, draws the supplied `bezierConfig`. */
export function EasingCurve({ easing, size = 28, accent = false, bezierConfig }: { easing: EasingType; size?: number; accent?: boolean; bezierConfig?: CubicBezierConfig }) {
  const w = size + 6
  const h = size
  const pad = 3
  const steps = 30
  const pathD = useMemo(() => {
    const pts: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const v = applyEasing(t, easing, undefined, bezierConfig)
      const x = pad + t * (w - 2 * pad)
      const y = (h - pad) - v * (h - 2 * pad)
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [easing, w, h, bezierConfig])
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="bg-black/20 rounded border border-white/5 flex-shrink-0">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="white" strokeOpacity={0.08} strokeWidth={0.5} />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="white" strokeOpacity={0.08} strokeWidth={0.5} />
      <path d={pathD} fill="none" stroke={accent ? ACCENT_PRIMARY : '#60a5fa'} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

/** Two-handle Bézier editor. The two control points are draggable in the
 *  unit square; x is clamped to [0, 1] (CSS-cubic-bezier requirement), y is
 *  free in approximately [-1, 2] so users can author overshoot/undershoot. */
function BezierEditor({ config, onChange }: { config: CubicBezierConfig; onChange: (next: CubicBezierConfig) => void }) {
  const SIZE = 140
  const PAD = 12
  const svgRef = useRef<SVGSVGElement>(null)
  const innerW = SIZE - 2 * PAD
  const innerH = SIZE - 2 * PAD
  // Map config-space (x∈[0,1], y∈[-0.5, 1.5]) → SVG. Y is inverted.
  const Y_MIN = -0.5, Y_MAX = 1.5
  const toSvgX = (cx: number): number => PAD + cx * innerW
  const toSvgY = (cy: number): number => PAD + ((Y_MAX - cy) / (Y_MAX - Y_MIN)) * innerH

  const drag = useRef<'p1' | 'p2' | null>(null)

  const beginDrag = useCallback((handle: 'p1' | 'p2', e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = handle
    const svg = svgRef.current
    if (!svg) return
    const onMove = (ev: PointerEvent): void => {
      if (!drag.current) return
      const rect = svg.getBoundingClientRect()
      const sx = SIZE / Math.max(1, rect.width)
      const sy = SIZE / Math.max(1, rect.height)
      const x = (ev.clientX - rect.left) * sx
      const y = (ev.clientY - rect.top) * sy
      const cx = Math.max(0, Math.min(1, (x - PAD) / innerW))
      const cy = Y_MAX - ((y - PAD) / innerH) * (Y_MAX - Y_MIN)
      const clampedY = Math.max(Y_MIN, Math.min(Y_MAX, cy))
      if (drag.current === 'p1') onChange({ ...config, x1: cx, y1: clampedY })
      else onChange({ ...config, x2: cx, y2: clampedY })
    }
    const onUp = (): void => {
      drag.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [config, onChange, innerW, innerH])

  // Curve path
  const pathD = useMemo(() => {
    const pts: string[] = []
    const steps = 30
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const v = applyEasing(t, 'cubic-bezier', undefined, config)
      const x = toSvgX(t)
      const y = toSvgY(v)
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [config])

  // Anchor points (0,0) and (1,1) in config-space.
  const A = { x: toSvgX(0), y: toSvgY(0) }
  const B = { x: toSvgX(1), y: toSvgY(1) }
  const P1 = { x: toSvgX(config.x1), y: toSvgY(config.y1) }
  const P2 = { x: toSvgX(config.x2), y: toSvgY(config.y2) }

  const fmt = (n: number): string => n.toFixed(2)

  return (
    <div>
      <svg ref={svgRef} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="bg-black/30 rounded border border-white/10">
        {/* Unit-square grid. */}
        <rect x={PAD} y={toSvgY(1)} width={innerW} height={toSvgY(0) - toSvgY(1)} fill="white" fillOpacity={0.02} />
        <line x1={PAD} y1={toSvgY(0)} x2={SIZE - PAD} y2={toSvgY(0)} stroke="white" strokeOpacity={0.18} strokeWidth={0.5} strokeDasharray="2 2" />
        <line x1={PAD} y1={toSvgY(1)} x2={SIZE - PAD} y2={toSvgY(1)} stroke="white" strokeOpacity={0.18} strokeWidth={0.5} strokeDasharray="2 2" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={SIZE - PAD} stroke="white" strokeOpacity={0.18} strokeWidth={0.5} />
        <line x1={SIZE - PAD} y1={PAD} x2={SIZE - PAD} y2={SIZE - PAD} stroke="white" strokeOpacity={0.18} strokeWidth={0.5} />

        {/* Tangent lines from anchors to control points. */}
        <line x1={A.x} y1={A.y} x2={P1.x} y2={P1.y} stroke={ACCENT_HIGHLIGHT} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="3 2" />
        <line x1={B.x} y1={B.y} x2={P2.x} y2={P2.y} stroke={ACCENT_HIGHLIGHT} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="3 2" />

        {/* Curve. */}
        <path d={pathD} fill="none" stroke={ACCENT_PRIMARY} strokeWidth={1.5} strokeLinecap="round" />

        {/* Anchors. */}
        <circle cx={A.x} cy={A.y} r={3} fill="white" fillOpacity={0.6} />
        <circle cx={B.x} cy={B.y} r={3} fill="white" fillOpacity={0.6} />

        {/* Draggable control points. */}
        <circle
          cx={P1.x} cy={P1.y} r={6}
          fill={ACCENT_HIGHLIGHT} fillOpacity={0.9} stroke="white" strokeOpacity={0.6} strokeWidth={1}
          style={{ cursor: 'grab' }}
          onPointerDown={(e) => beginDrag('p1', e)}
        />
        <circle
          cx={P2.x} cy={P2.y} r={6}
          fill={ACCENT_HIGHLIGHT} fillOpacity={0.9} stroke="white" strokeOpacity={0.6} strokeWidth={1}
          style={{ cursor: 'grab' }}
          onPointerDown={(e) => beginDrag('p2', e)}
        />
      </svg>
      <div className="mt-1 text-[9px] text-white/40 font-mono">
        cubic-bezier({fmt(config.x1)}, {fmt(config.y1)}, {fmt(config.x2)}, {fmt(config.y2)})
      </div>
    </div>
  )
}
