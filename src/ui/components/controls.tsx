import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// --- NumberField ---------------------------------------------------------------
// Drag the label to scrub, ↑/↓ to nudge (Shift ×10, Alt ×0.1), type simple
// arithmetic ("12*2"), Enter/blur to commit, Esc to cancel.

interface NumberFieldProps {
  value: number
  onChange: (v: number, final: boolean) => void
  step?: number
  min?: number
  max?: number
  unit?: string
  label?: string
  precision?: number
  title?: string
  disabled?: boolean
  placeholder?: string
}

function evalExpr(s: string): number | null {
  const clean = s.replace(/,/g, '.').trim()
  if (!/^[\d\s.+\-*/()]+$/.test(clean)) return null
  try {
    const v = Function(`"use strict";return (${clean})`)() as unknown
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

export function NumberField({ value, onChange, step = 1, min = -Infinity, max = Infinity, unit, label, precision, title, disabled, placeholder }: NumberFieldProps) {
  const digits = precision ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2)
  const fmt = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(digits))) : '')
  const [text, setText] = useState(fmt(value))
  const [editing, setEditing] = useState(false)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  useEffect(() => {
    if (!editing) setText(fmt(value))
  }, [value, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (final: boolean) => {
    const v = evalExpr(text)
    if (v === null) setText(fmt(value))
    else {
      const c = clamp(v)
      if (c !== value) onChange(c, final)
      setText(fmt(c))
    }
  }

  const onScrubStart = (e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const start = value
    let latest = start
    let moved = false
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) < 3) return
      moved = true
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1
      latest = clamp(Number((start + Math.round(dx / 3) * step * mult).toFixed(Math.max(digits, 2))))
      onChange(latest, false)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      if (moved) onChange(latest, true)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up, { once: true })
  }

  return (
    <div className="nf" title={title} aria-disabled={disabled}>
      {label && (
        <span className="nf-label" onPointerDown={onScrubStart}>
          {label}
        </span>
      )}
      <input
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="decimal"
        aria-label={label ?? title}
        onFocus={(e) => {
          setEditing(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setEditing(false)
          commit(true)
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(true)
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            setText(fmt(value))
            setEditing(false)
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
            const base = evalExpr(text) ?? value
            const v = clamp(Number((base + (e.key === 'ArrowUp' ? 1 : -1) * step * mult).toFixed(Math.max(digits, 2))))
            setText(fmt(v))
            onChange(v, false)
          }
        }}
      />
      {unit && <span className="nf-unit">{unit}</span>}
    </div>
  )
}

// --- Rows -----------------------------------------------------------------------

export function Row({ label, children, title, stack }: { label: ReactNode; children: ReactNode; title?: string; stack?: boolean }) {
  return (
    <div className={`row${stack ? ' stack' : ''}`} title={title}>
      <label>{label}</label>
      <div className="grow" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {children}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, full }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={`seg${full ? ' full' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span>{label}</span>
    </label>
  )
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string, final: boolean) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="color-field">
      <label className="swatch" style={{ background: value }}>
        <input type="color" value={value.length === 7 ? value : '#ffffff'} onChange={(e) => onChange(e.target.value, false)} onBlur={(e) => onChange(e.target.value, true)} aria-label="Pick colour" />
      </label>
      <input
        className="text-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (/^#[0-9a-fA-F]{6}$/.test(text)) onChange(text.toLowerCase(), true)
          else setText(value)
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Hex colour"
      />
    </div>
  )
}

export function Select<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={ariaLabel}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// --- Popover ----------------------------------------------------------------------

export function Popover({ anchor, onClose, children, align = 'left', width }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; align?: 'left' | 'right'; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const r = anchor.getBoundingClientRect()
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight
    let left = align === 'right' ? r.right - w : r.left
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left))
    let top = r.bottom + 6
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
    setPos({ top, left })
  }, [anchor, align])
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])
  return createPortal(
    <div ref={ref} className="popover" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}>
      {children}
    </div>,
    document.body,
  )
}

/** Button that opens a popover. */
export function MenuButton({ button, children, align, width, className = 'btn', title }: { button: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: number; className?: string; title?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={ref} className={className} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={title}>
        {button}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} align={align} width={width}>
          {children(() => setOpen(false))}
        </Popover>
      )}
    </>
  )
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
