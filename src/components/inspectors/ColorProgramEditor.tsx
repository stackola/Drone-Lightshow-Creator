// ============================================================================
// Bundle 4: Rich color program editor — hex/HSV picker, live swatch preview
// ============================================================================

import { useMemo, useRef, useState } from 'react'
import { HexColorPicker, HexColorInput } from 'react-colorful'
import {
  registerColorProgram,
  evaluateColorProgram,
  getColorProgram,
  type ColorProgram,
  type ColorProgramType,
} from '../../graph/colorPrograms'
import type { Color3 } from '../../graph/colors'

const TYPE_OPTIONS: { id: Exclude<ColorProgramType, 'custom'>; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'multi-gradient', label: 'Multi-Gradient' },
  { id: 'sweep', label: 'Sweep' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'chase', label: 'Chase' },
]

const DEFAULT_STOPS: { t: number; color: Color3 }[] = [
  { t: 0, color: { r: 1, g: 0.4, b: 0.6 } },
  { t: 0.5, color: { r: 0.6, g: 0.4, b: 1 } },
  { t: 1, color: { r: 0.2, g: 0.6, b: 1 } },
]

function toHex(c: Color3): string {
  const r = Math.round(Math.max(0, Math.min(1, c.r)) * 255)
  const g = Math.round(Math.max(0, Math.min(1, c.g)) * 255)
  const b = Math.round(Math.max(0, Math.min(1, c.b)) * 255)
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Color3 {
  const m = hex.replace('#', '')
  const n = m.length === 3
    ? m.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
  return { r: n[0]! / 255, g: n[1]! / 255, b: n[2]! / 255 }
}

interface Props {
  onSaved: (programId: string) => void
  onCancel?: () => void
  initialProgramId?: string
}

// L4 (2026-05-21) — typed extraction of editable fields from any ColorProgram
// variant. Replaces the five `as any` casts the first audit flagged. Each
// variant maps to a {primary, secondary} colour pair plus the optional fields
// the editor exposes (axis / frequency / speed). When a field doesn't exist
// for a given variant, the helper returns a sensible default — that's the
// "default" the editor falls back to when the user switches types.
const DEFAULT_A: Color3 = { r: 1, g: 0.4, b: 0.6 }
const DEFAULT_B: Color3 = { r: 0.2, g: 0.6, b: 1 }

interface EditableFields {
  colorA: Color3
  colorB: Color3
  axis: 'x' | 'y' | 'z'
  frequency: number
  speed: number
}

function extractEditableFields(program: ColorProgram | null): EditableFields {
  if (!program) {
    return { colorA: DEFAULT_A, colorB: DEFAULT_B, axis: 'y', frequency: 1, speed: 0.5 }
  }
  switch (program.type) {
    case 'solid':
      return { colorA: program.color, colorB: DEFAULT_B, axis: 'y', frequency: 1, speed: 0.5 }
    case 'gradient':
      return { colorA: program.colorStart, colorB: program.colorEnd, axis: program.axis, frequency: 1, speed: 0.5 }
    case 'sweep':
      return { colorA: program.colorFrom, colorB: program.colorTo, axis: 'y', frequency: 1, speed: program.speed }
    case 'rainbow':
      return { colorA: DEFAULT_A, colorB: DEFAULT_B, axis: program.axis, frequency: 1, speed: program.speed }
    case 'pulse':
      return { colorA: program.color, colorB: DEFAULT_B, axis: 'y', frequency: program.frequency, speed: 0.5 }
    case 'chase':
      return {
        colorA: program.colors[0] ?? DEFAULT_A,
        colorB: program.colors[1] ?? DEFAULT_B,
        axis: 'y',
        frequency: 1,
        speed: program.speed,
      }
    case 'custom':
    default:
      return { colorA: DEFAULT_A, colorB: DEFAULT_B, axis: 'y', frequency: 1, speed: 0.5 }
  }
}

export function ColorProgramEditor({ onSaved, onCancel, initialProgramId }: Props) {
  const existing = initialProgramId ? getColorProgram(initialProgramId) : null
  const initial = useMemo(() => extractEditableFields(existing ?? null), [existing])
  const [name, setName] = useState(existing?.name ?? 'My Color')
  const [type, setType] = useState<Exclude<ColorProgramType, 'custom'>>(
    (existing?.type === 'custom' ? 'solid' : (existing?.type as Exclude<ColorProgramType, 'custom'> | undefined)) ?? 'solid',
  )
  const [colorA, setColorA] = useState<Color3>(initial.colorA)
  const [colorB, setColorB] = useState<Color3>(initial.colorB)
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>(initial.axis)
  const [freq, setFreq] = useState<number>(initial.frequency)
  const [speed, setSpeed] = useState<number>(initial.speed)
  const [editingHex, setEditingHex] = useState<'a' | 'b'>('a')
  // S6 — multi-stop gradient state. Initialised from the program when it is
  // already a multi-gradient; otherwise starts with the 3-stop default.
  const [stops, setStops] = useState<{ t: number; color: Color3 }[]>(
    existing && existing.type === 'multi-gradient' ? existing.stops : DEFAULT_STOPS,
  )
  // Which stop's colour is currently being edited (when type === 'multi-gradient').
  const [activeStopIdx, setActiveStopIdx] = useState(0)

  const programDraft = useMemo<ColorProgram>(() => {
    const id = initialProgramId ?? `custom-${Date.now()}`
    switch (type) {
      case 'solid': return { id, name, type: 'solid', color: colorA }
      case 'gradient': return { id, name, type: 'gradient', colorStart: colorA, colorEnd: colorB, axis }
      case 'multi-gradient': return { id, name, type: 'multi-gradient', stops, axis }
      case 'sweep': return { id, name, type: 'sweep', colorFrom: colorA, colorTo: colorB, speed, direction: { x: 1, y: 0, z: 0 } }
      case 'rainbow': return { id, name, type: 'rainbow', mode: 'spatial', axis, saturation: 1, brightness: 1, speed }
      case 'pulse': return { id, name, type: 'pulse', color: colorA, frequency: freq, amplitude: 0.8, minBrightness: 0.2 }
      case 'chase': return { id, name, type: 'chase', colors: [colorA, colorB, { r: 1, g: 1, b: 1 }], speed, width: 5 }
      default: return { id, name, type: 'solid', color: colorA }
    }
  }, [initialProgramId, type, name, colorA, colorB, axis, freq, speed, stops])

  // 12-dot live preview line (positions span axis, t=0)
  const previewDots = useMemo(() => {
    const N = 12
    const dots: string[] = []
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1)
      const pos = { x: f * 10 - 5, y: f * 10 - 5, z: f * 10 - 5 }
      const c = evaluateColorProgram(programDraft, i, N, pos, 0)
      dots.push(toHex(c))
    }
    return dots
  }, [programDraft])

  const handleSave = () => {
    registerColorProgram(programDraft)
    onSaved(programDraft.id)
  }

  // S6 — when editing a multi-gradient, the HexColorPicker drives the active
  // stop's colour instead of colorA/colorB. Falls back to legacy behaviour
  // for all other types.
  const activeColor: Color3 = type === 'multi-gradient'
    ? (stops[activeStopIdx]?.color ?? DEFAULT_A)
    : (editingHex === 'a' ? colorA : colorB)
  const setActiveColor = (c: Color3): void => {
    if (type === 'multi-gradient') {
      setStops((prev) => prev.map((s, i) => (i === activeStopIdx ? { ...s, color: c } : s)))
    } else if (editingHex === 'a') {
      setColorA(c)
    } else {
      setColorB(c)
    }
  }

  return (
    <div className="mt-1 p-2 bg-white/5 rounded border border-white/10 space-y-1.5">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 bg-surface-hover border border-white/10 rounded px-2 py-0.5 text-xs text-white/80 outline-none focus:border-cyan-500/50"
          placeholder="Program name"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {TYPE_OPTIONS.map((t) => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={`px-2 py-0.5 text-micro rounded transition-colors ${
              type === t.id
                ? 'bg-cyan-600 text-white'
                : 'bg-white/5 hover:bg-white/10 text-white/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Picker — applies to whichever swatch is selected */}
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          <HexColorPicker
            color={toHex(activeColor)}
            onChange={(h) => setActiveColor(fromHex(h))}
            style={{ width: '100%', height: 90 }}
          />
        </div>
        <div className="flex flex-col gap-1 w-20">
          <SwatchButton
            color={colorA}
            label="A"
            active={editingHex === 'a'}
            onClick={() => setEditingHex('a')}
          />
          {(type === 'gradient' || type === 'sweep' || type === 'chase') && (
            <SwatchButton
              color={colorB}
              label="B"
              active={editingHex === 'b'}
              onClick={() => setEditingHex('b')}
            />
          )}
          <HexColorInput
            color={toHex(activeColor)}
            onChange={(h) => setActiveColor(fromHex(h))}
            prefixed
            className="w-full bg-surface-hover border border-white/10 rounded px-1 py-0.5 text-micro text-white/80 outline-none uppercase"
          />
        </div>
      </div>

      {/* Type-specific extras */}
      {(type === 'gradient' || type === 'rainbow' || type === 'multi-gradient') && (
        <label className="flex items-center justify-between text-micro text-white/50">
          <span>Axis</span>
          <select
            value={axis}
            onChange={(e) => setAxis(e.target.value as 'x' | 'y' | 'z')}
            className="bg-surface-hover border border-white/10 rounded px-1 py-0.5 text-micro text-white/80 outline-none"
          >
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
        </label>
      )}
      {type === 'multi-gradient' && (
        <MultiGradientStops
          stops={stops}
          onChange={setStops}
          activeIdx={activeStopIdx}
          onActivate={setActiveStopIdx}
          activeColor={stops[activeStopIdx]?.color ?? DEFAULT_A}
          onActiveColorChange={(c) => {
            setStops((prev) => prev.map((s, i) => (i === activeStopIdx ? { ...s, color: c } : s)))
          }}
        />
      )}
      {(type === 'sweep' || type === 'chase' || type === 'rainbow') && (
        <label className="flex items-center justify-between gap-2 text-micro text-white/50">
          <span>Speed</span>
          <input
            type="range" min={0} max={5} step={0.1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="flex-1 accent-cyan-400"
          />
          <span className="w-6 text-right text-white/70 tabular-nums">{speed.toFixed(1)}</span>
        </label>
      )}
      {type === 'pulse' && (
        <label className="flex items-center justify-between gap-2 text-micro text-white/50">
          <span>Freq (Hz)</span>
          <input
            type="range" min={0.1} max={10} step={0.1}
            value={freq}
            onChange={(e) => setFreq(Number(e.target.value))}
            className="flex-1 accent-cyan-400"
          />
          <span className="w-6 text-right text-white/70 tabular-nums">{freq.toFixed(1)}</span>
        </label>
      )}

      {/* Live preview row */}
      <div className="flex gap-0.5 py-1">
        {previewDots.map((hex, i) => (
          <div
            key={i}
            className="flex-1 h-3 rounded-sm"
            style={{ background: hex, boxShadow: `0 0 4px ${hex}` }}
          />
        ))}
      </div>

      <div className="flex gap-1">
        <button
          onClick={handleSave}
          className="flex-1 px-2 py-1 text-micro text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 rounded transition-colors"
        >
          {initialProgramId ? 'Update' : 'Create'}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-2 py-1 text-micro text-white/40 hover:text-white/60 bg-white/5 rounded transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function SwatchButton({ color, label, active, onClick }: { color: Color3; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-1 py-0.5 rounded border transition-colors ${
        active ? 'border-cyan-400' : 'border-white/10 hover:border-white/30'
      }`}
    >
      <span className="w-4 h-4 rounded-sm" style={{ background: toHex(color) }} />
      <span className="text-micro text-white/60">{label}</span>
    </button>
  )
}

// S6 — multi-stop gradient stops editor. Renders the stops as small swatches
// on a horizontal track. Click a stop to select it (its colour goes into the
// HexColorPicker above). Drag horizontally to move its `t`. Right-click or
// the "−" button removes; clicking empty track inserts a new stop at that t.
//
// Minimal version: drag, click-to-select, +/- buttons. No double-click-to-add
// (use + button), no shift-snap, no copy/paste. Those can come later.
function MultiGradientStops({
  stops,
  onChange,
  activeIdx,
  onActivate,
  activeColor,
  onActiveColorChange,
}: {
  stops: { t: number; color: Color3 }[]
  onChange: (next: { t: number; color: Color3 }[]) => void
  activeIdx: number
  onActivate: (idx: number) => void
  activeColor: Color3
  onActiveColorChange: (c: Color3) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(() => stops.map((s, i) => ({ ...s, originalIdx: i })).sort((a, b) => a.t - b.t), [stops])

  const handleAdd = () => {
    // Insert at the largest gap between existing stops.
    if (sorted.length === 0) {
      onChange([{ t: 0.5, color: activeColor }])
      onActivate(0)
      return
    }
    let bestT = (sorted[0]!.t + 1) / 2
    let bestGap = 0
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1]!.t - sorted[i]!.t
      if (gap > bestGap) { bestGap = gap; bestT = (sorted[i]!.t + sorted[i + 1]!.t) / 2 }
    }
    // Also consider before-first and after-last.
    if (sorted[0]!.t > bestGap) { bestGap = sorted[0]!.t; bestT = sorted[0]!.t / 2 }
    const lastT = sorted[sorted.length - 1]!.t
    if (1 - lastT > bestGap) { bestT = (1 + lastT) / 2 }
    const newStops = [...stops, { t: bestT, color: activeColor }]
    onChange(newStops)
    onActivate(newStops.length - 1)
  }

  const handleRemove = (i: number) => {
    if (stops.length <= 1) return // keep at least one stop
    const next = stops.filter((_, idx) => idx !== i)
    onChange(next)
    onActivate(Math.min(activeIdx, next.length - 1))
  }

  // Drag a stop horizontally to change its t value.
  const startDrag = (e: React.PointerEvent, idx: number) => {
    e.preventDefault()
    e.stopPropagation()
    onActivate(idx)
    const trackEl = trackRef.current
    if (!trackEl) return
    const rect = trackEl.getBoundingClientRect()
    const onMove = (ev: PointerEvent): void => {
      const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
      onChange(stops.map((s, j) => (j === idx ? { ...s, t } : s)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Build the gradient CSS for the track background (sorted by t).
  const gradientCss = sorted.length === 0
    ? 'rgb(40,40,40)'
    : `linear-gradient(to right, ${sorted.map((s) => `${toHex(s.color)} ${(s.t * 100).toFixed(1)}%`).join(', ')})`

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-micro text-white/50">
        <span>Stops ({stops.length})</span>
        <div className="flex gap-1">
          <button
            onClick={handleAdd}
            className="px-1.5 py-0.5 text-micro rounded bg-white/5 hover:bg-white/10 text-white/60"
          >
            + Add
          </button>
          <button
            onClick={() => handleRemove(activeIdx)}
            disabled={stops.length <= 1}
            className="px-1.5 py-0.5 text-micro rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            − Remove
          </button>
        </div>
      </div>
      {/* Gradient preview track + draggable stop pips */}
      <div ref={trackRef} className="relative h-7 rounded border border-white/10" style={{ background: gradientCss }}>
        {stops.map((s, i) => (
          <button
            key={i}
            onPointerDown={(e) => startDrag(e, i)}
            onClick={() => onActivate(i)}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 cursor-grab active:cursor-grabbing ${
              i === activeIdx ? 'border-cyan-300 ring-2 ring-cyan-400/40' : 'border-white/70'
            }`}
            style={{ left: `${s.t * 100}%`, background: toHex(s.color) }}
            aria-label={`Stop ${i + 1} at t=${s.t.toFixed(2)}`}
          />
        ))}
      </div>
      {/* Active stop t input */}
      <div className="flex items-center justify-between text-micro text-white/40">
        <span>Active stop t</span>
        <input
          type="number" min={0} max={1} step={0.05}
          value={stops[activeIdx]?.t ?? 0}
          onChange={(e) => {
            const t = Math.max(0, Math.min(1, Number(e.target.value)))
            onChange(stops.map((s, i) => (i === activeIdx ? { ...s, t } : s)))
          }}
          className="w-16 bg-surface-hover border border-white/10 rounded px-1 py-0.5 text-micro text-white/80 outline-none focus:border-cyan-500/50"
        />
      </div>
      {/* Mirror activeColor into the HexColorPicker above — the parent's
          editingHex state isn't touched here; we directly drive the active
          stop's colour when the picker is showing the same value. */}
      <input type="hidden" value={toHex(activeColor)} onChange={(e) => onActiveColorChange(fromHex(e.target.value))} />
    </div>
  )
}
