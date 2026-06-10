// ============================================================================
// L4 (2026-05-21) — ColorInput: swatch button that opens a popover with
//   • react-colorful HSL square + hex input
//   • a row of recent colours (per-session, max 12)
//   • a row of preset swatches (the project's existing palette)
//   • optional eyedropper (browser API `EyeDropper`, ignored if unsupported)
//   • mixed-value indicator for multi-select.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { HexColorPicker, HexColorInput } from 'react-colorful'
import { Pipette } from 'lucide-react'

export interface RGB { r: number; g: number; b: number }

export interface ColorInputProps {
  value: RGB
  onChange: (next: RGB) => void
  /** Multi-select with conflicting values. */
  mixed?: boolean
  /** Optional preset swatches (RGB). */
  presets?: RGB[]
  /** Inline label for accessibility. */
  label?: string
}

const RECENT_KEY = 'color-input-recents-v1'
const MAX_RECENTS = 12

function toHex({ r, g, b }: RGB): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function fromHex(hex: string): RGB | null {
  const m = hex.match(/^#?([\da-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 }
}

function readRecents(): RGB[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<{ r?: number; g?: number; b?: number }>
    return parsed.filter((c) => typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') as RGB[]
  } catch { return [] }
}

function pushRecent(c: RGB): void {
  try {
    const prev = readRecents().filter((p) => toHex(p) !== toHex(c))
    sessionStorage.setItem(RECENT_KEY, JSON.stringify([c, ...prev].slice(0, MAX_RECENTS)))
  } catch { /* storage unavailable */ }
}

// Browser EyeDropper API — Chromium-only; check at runtime.
interface EyeDropperAPI { open(): Promise<{ sRGBHex: string }> }
const EyeDropperCtor = (typeof window !== 'undefined'
  ? (window as unknown as { EyeDropper?: new () => EyeDropperAPI }).EyeDropper
  : undefined)

export function ColorInput({ value, onChange, mixed = false, presets, label }: ColorInputProps) {
  const [open, setOpen] = useState(false)
  const [recents, setRecents] = useState<RGB[]>(() => readRecents())
  const wrapRef = useRef<HTMLDivElement>(null)
  const hex = mixed ? '#888888' : toHex(value)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        // Capture the current colour as a "recent" when the popover closes.
        if (!mixed) {
          pushRecent(value)
          setRecents(readRecents())
        }
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, value, mixed])

  const apply = (next: RGB): void => {
    onChange(next)
  }

  const sample = async (): Promise<void> => {
    if (!EyeDropperCtor) return
    try {
      const result = await new EyeDropperCtor().open()
      const parsed = fromHex(result.sRGBHex)
      if (parsed) apply(parsed)
    } catch { /* user cancelled */ }
  }

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-6 h-6 rounded border border-white/20 hover:border-white/40 transition-colors"
        style={{
          background: mixed
            ? 'repeating-conic-gradient(#475569 0% 25%, #64748b 0% 50%)'
            : hex,
        }}
        aria-label={label ?? 'Edit colour'}
        title={mixed ? 'Mixed value — click to set' : hex}
      />
      {open && (
        <div
          role="dialog"
          className="absolute right-0 top-full mt-1 z-40 w-[220px] p-2 rounded-lg border border-white/10 bg-surface-raised/95 backdrop-blur-sm shadow-2xl space-y-2"
        >
          <HexColorPicker color={hex.slice(1)} onChange={(h) => { const p = fromHex(h); if (p) apply(p) }} />
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-white/40">#</span>
            <HexColorInput
              color={hex.slice(1)}
              onChange={(h) => { const p = fromHex(`#${h}`); if (p) apply(p) }}
              className="flex-1 bg-surface-hover border border-white/10 rounded px-1 py-0.5 text-micro text-white/80 outline-none focus:border-cyan-500/50"
              prefixed={false}
            />
            {EyeDropperCtor && (
              <button
                onClick={sample}
                className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white/80"
                aria-label="Eyedropper"
                title="Sample a colour from anywhere on the screen"
              >
                <Pipette size={11} />
              </button>
            )}
          </div>
          {presets && presets.length > 0 && (
            <div>
              <div className="text-[8px] uppercase tracking-wider text-white/30 mb-0.5">Presets</div>
              <div className="flex flex-wrap gap-1">
                {presets.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => apply(c)}
                    className="w-4 h-4 rounded border border-white/20 hover:border-white/50"
                    style={{ background: toHex(c) }}
                    aria-label={`Preset ${toHex(c)}`}
                  />
                ))}
              </div>
            </div>
          )}
          {recents.length > 0 && (
            <div>
              <div className="text-[8px] uppercase tracking-wider text-white/30 mb-0.5">Recent</div>
              <div className="flex flex-wrap gap-1">
                {recents.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => apply(c)}
                    className="w-4 h-4 rounded border border-white/20 hover:border-white/50"
                    style={{ background: toHex(c) }}
                    aria-label={`Recent ${toHex(c)}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
