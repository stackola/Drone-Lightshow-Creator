// Shared inspector UI primitives

import { useId, useState, useRef, type ReactNode } from 'react'
import { Lock } from 'lucide-react'

/** Slice 2: canonical seconds formatter — 1 decimal place + "s" suffix. */
export function formatSeconds(n: number): string {
  return `${n.toFixed(1)}s`
}

/** Slice 2: centralised severity colors. Used by ValidationBadge, DerivedValue, violation panels. */
export const SEVERITY_COLORS = {
  error: 'text-red-400 bg-red-500/15 border-red-500/30',
  warning: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  ok: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
  muted: 'text-white/50',
} as const

export type SeverityTone = keyof typeof SEVERITY_COLORS

/** Slice 2: read-only display for derived (computed) values. Italic + lock icon + optional tone. */
export function DerivedValue({
  value,
  unit,
  tooltip,
  tone = 'muted',
}: {
  value: string | number
  unit?: string
  tooltip?: string
  tone?: SeverityTone
}) {
  const display = typeof value === 'number' ? formatSeconds(value) : value + (unit ?? '')
  return (
    <div
      className={`flex items-center gap-1 italic text-xs ${SEVERITY_COLORS[tone]} px-2 py-0.5 rounded`}
      title={tooltip ?? 'Derived value (read-only)'}
    >
      <Lock size={10} aria-hidden="true" />
      <span>{display}</span>
    </div>
  )
}

export function InspectorHeader({ title }: { title: string }) {
  return (
    <div className="px-3 py-2 border-b border-white/10 text-xs font-semibold text-white/70 uppercase tracking-wider">
      {title}
    </div>
  )
}

/** O-04: small banner shown at the top of an inspector when its node is
 *  locked. Includes an Unlock button so the user can recover without having
 *  to hunt for the Ctrl+L shortcut. The banner is purely informational —
 *  individual inputs are not disabled (would require gating every onChange),
 *  but writes from the gizmo + L2 handles are already blocked. */
export function LockedBanner({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="px-3 py-2 border-b border-white/10 bg-amber-500/10 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-caption text-amber-300">
        <Lock size={12} aria-hidden="true" />
        <span>Locked — drag handles + gizmo refuse edits</span>
      </div>
      <button
        onClick={onUnlock}
        className="text-micro text-amber-200 hover:text-amber-100 underline underline-offset-2"
        title="Toggle the locked flag off (Ctrl+L)"
      >
        Unlock
      </button>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-xs text-white/70 flex-shrink-0">{label}</label>
      <div className="flex-1 min-w-0" id={id}>{children}</div>
    </div>
  )
}

/**
 * NumberInput — drag-to-scrub, math expressions, units, nudge, mixed-value.
 *
 * Interactions:
 *   • Mouse-down + drag horizontally → scrubs value. Shift = ×10, Alt = ×0.1.
 *     Cmd/Ctrl during scrub snaps to integer step.
 *   • Focus + type → normal numeric entry. Math expressions evaluated on
 *     Enter or blur (`2*pi`, `15+3`, `(5+1)/2`).
 *   • ↑ / ↓ → nudge by step. Shift+arrow = ×10. Alt+arrow = ×0.1.
 *   • `mixed` prop shows `—` for multi-select with conflicting values;
 *     typing immediately replaces.
 *   • `unit` prop appends a tiny suffix inside the input.
 *
 * L4 (2026-05-21) — upgraded in place so the ~120 existing callers inherit
 * the polish without churn.
 */
const NUMBER_HISTORY_KEY = 'num-input-history-v1'
const NUMBER_HISTORY_MAX = 16

function readHistory(): number[] {
  try {
    const raw = sessionStorage.getItem(NUMBER_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : []
  } catch { return [] }
}
function pushHistory(v: number): void {
  try {
    const prev = readHistory().filter((n) => n !== v)
    sessionStorage.setItem(NUMBER_HISTORY_KEY, JSON.stringify([v, ...prev].slice(0, NUMBER_HISTORY_MAX)))
  } catch { /* session storage blocked */ }
}

/**
 * Evaluate a math expression safely. Supports `+ - * / % ( )`, decimal numbers,
 * `pi` and `e` constants. Rejects anything else.
 * Returns `null` when input doesn't parse to a finite number.
 */
export function evalNumberExpression(raw: string): number | null {
  const text = raw.trim().replace(/pi/gi, String(Math.PI)).replace(/\be\b/g, String(Math.E))
  if (text.length === 0) return null
  // Whitelist characters to avoid `eval` injection.
  if (!/^[-+*/%().\d\s]+$/.test(text)) return null
  try {
    // eslint-disable-next-line no-new-func
    const n = Function(`"use strict"; return (${text})`)() as unknown
    return typeof n === 'number' && isFinite(n) ? n : null
  } catch { return null }
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  label,
  unit,
  mixed = false,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  /** Inline unit suffix (m, °, s, …). Purely decorative. */
  unit?: string
  /** Multi-select with conflicting values. Shows `—`; typing replaces. */
  mixed?: boolean
}) {
  const stepVal = step ?? 0.1
  const startValRef = useRef(value)
  const startXRef = useRef<number | null>(null)
  const draggedRef = useRef(false)
  const elRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState<string | null>(null) // null = controlled by value; string = mid-edit
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)

  const clamp = (n: number): number => {
    let r = n
    if (typeof min === 'number') r = Math.max(min, r)
    if (typeof max === 'number') r = Math.min(max, r)
    return +r.toFixed(4)
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    if (document.activeElement === e.currentTarget) return
    startValRef.current = value
    startXRef.current = e.clientX
    draggedRef.current = false
  }
  const handleMouseMove = (e: MouseEvent) => {
    if (startXRef.current === null) return
    const dx = e.clientX - startXRef.current
    if (Math.abs(dx) < 3) return
    draggedRef.current = true
    const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const sensitivity = stepVal * multiplier
    let next = startValRef.current + dx * sensitivity * 0.25
    if (e.ctrlKey || e.metaKey) next = Math.round(next / stepVal) * stepVal
    onChange(clamp(next))
  }
  const handleMouseUp = () => {
    if (draggedRef.current && elRef.current) elRef.current.blur()
    if (draggedRef.current) pushHistory(value)
    startXRef.current = null
    draggedRef.current = false
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  }

  const commit = (): void => {
    if (text === null) return
    const parsed = evalNumberExpression(text)
    if (parsed !== null) {
      const clamped = clamp(parsed)
      onChange(clamped)
      pushHistory(clamped)
    }
    setText(null)
    setHistoryIdx(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      ;(e.currentTarget as HTMLInputElement).blur()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setText(null)
      setHistoryIdx(null)
      ;(e.currentTarget as HTMLInputElement).blur()
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // History cycling when shift+up/down — otherwise nudge.
      if (e.altKey === false && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const history = readHistory()
        if (history.length === 0) return
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? 1 : -1
        const next = Math.max(0, Math.min(history.length - 1, (historyIdx ?? -1) + dir))
        setHistoryIdx(next)
        const v = history[next]!
        setText(String(v))
        return
      }
      e.preventDefault()
      const dir = e.key === 'ArrowUp' ? 1 : -1
      const mul = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
      onChange(clamp(value + dir * stepVal * mul))
      return
    }
  }

  const display = text !== null
    ? text
    : mixed
      ? ''
      : String(value)

  return (
    <div className="relative w-full">
      <input
        ref={elRef}
        type="text"
        inputMode="decimal"
        value={display}
        placeholder={mixed ? '—' : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => {
          if (document.activeElement === e.currentTarget) return
          handleMouseDown(e)
          window.addEventListener('mousemove', handleMouseMove)
          window.addEventListener('mouseup', handleMouseUp)
        }}
        aria-label={label}
        className={`w-full bg-surface-hover border border-white/10 rounded px-2 py-0.5 text-xs text-white/80 outline-none focus:border-cyan-500/50 ${text === null ? 'cursor-ew-resize' : 'cursor-text'} ${unit ? 'pr-5' : ''}`}
        title={'Drag = scrub  ·  Shift = coarse  ·  Alt = fine  ·  ↑↓ = nudge  ·  type = math expr'}
      />
      {unit && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-micro text-white/30 select-none">{unit}</span>
      )}
    </div>
  )
}

/**
 * VectorInput — three NumberInputs laid out in a row with axis-colored caps.
 * The component is a thin convenience over NumberInput; it doesn't duplicate
 * any of the math/scrub/units behaviour. Axis cap colours follow the standard
 * RGB = XYZ convention used by every gizmo on the planet.
 *
 * L4 (2026-05-21).
 */
export function VectorInput({
  value,
  onChange,
  step,
  min,
  unit,
  mixed,
}: {
  value: { x: number; y: number; z: number }
  onChange: (next: { x: number; y: number; z: number }) => void
  step?: number
  min?: number
  unit?: string
  mixed?: { x?: boolean; y?: boolean; z?: boolean }
}) {
  return (
    <div className="flex items-center gap-1 w-full">
      <AxisCap color="bg-red-500/60" label="X" />
      <NumberInput value={value.x} onChange={(v) => onChange({ ...value, x: v })} step={step} min={min} unit={unit} mixed={mixed?.x} label="X" />
      <AxisCap color="bg-emerald-500/60" label="Y" />
      <NumberInput value={value.y} onChange={(v) => onChange({ ...value, y: v })} step={step} min={min} unit={unit} mixed={mixed?.y} label="Y" />
      <AxisCap color="bg-blue-500/60" label="Z" />
      <NumberInput value={value.z} onChange={(v) => onChange({ ...value, z: v })} step={step} min={min} unit={unit} mixed={mixed?.z} label="Z" />
    </div>
  )
}

function AxisCap({ color, label }: { color: string; label: string }) {
  return (
    <span className={`flex-shrink-0 inline-flex items-center justify-center w-3 h-4 rounded text-[9px] font-bold text-white/80 ${color}`} aria-hidden="true">
      {label}
    </span>
  )
}

export function SelectInput({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="w-full bg-surface-hover border border-white/10 rounded px-2 py-0.5 text-xs text-white/80 outline-none focus:border-cyan-500/50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Section({ title, children, defaultCollapsed = false }: { title: string; children: ReactNode; defaultCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  return (
    <div className="px-3 py-2 space-y-2">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1 w-full text-left text-micro font-semibold text-white/60 uppercase tracking-wider hover:text-white/80 transition-colors"
      >
        <span className="text-[8px]">{collapsed ? '\u25B6' : '\u25BC'}</span>
        {title}
      </button>
      {!collapsed && children}
    </div>
  )
}
