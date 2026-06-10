// ============================================================================
// L4 (2026-05-21) — RegistrySelect: SelectInput specialised for registry items
// (generators, transitions, idle behaviors, color programs). Replaces a native
// <select> with a popover grid of L1 RegistryItemPreview tiles. Click to pick.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { RegistryItemPreview } from '../RegistryItemPreview'

export type RegistryKind = 'generator' | 'idle' | 'color' | 'transition'

export interface RegistrySelectProps {
  kind: RegistryKind
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
  /** Optional params forwarded to the preview tiles. */
  params?: Record<string, number>
}

export function RegistrySelect({ kind, value, options, onChange, params }: RegistrySelectProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = options.find((o) => o.id === value)

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 bg-surface-hover border border-white/10 rounded px-1 py-0.5 text-xs text-white/80 outline-none hover:border-white/20 focus:border-cyan-500/50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <RegistryItemPreview kind={kind} id={value} params={params} size={20} framed={false} />
        <span className="flex-1 text-left truncate">{current?.label ?? value}</span>
        <ChevronDown size={12} className="text-white/40" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 z-40 w-[260px] bg-surface-raised/95 border border-white/10 rounded-lg shadow-2xl backdrop-blur-sm overflow-hidden"
        >
          <div className="max-h-[60vh] overflow-y-auto p-1">
            <div className="grid grid-cols-3 gap-1">
              {options.map((opt) => {
                const active = opt.id === value
                return (
                  <button
                    key={opt.id}
                    role="option"
                    aria-selected={active}
                    onClick={() => { onChange(opt.id); setOpen(false) }}
                    className={`flex flex-col items-stretch gap-0.5 rounded p-1 text-micro leading-tight transition-colors ${
                      active ? 'bg-cyan-500/20 ring-1 ring-cyan-400/60 text-cyan-100' : 'bg-white/5 hover:bg-white/10 text-white/70'
                    }`}
                  >
                    <RegistryItemPreview kind={kind} id={opt.id} params={params} size={48} framed={false} />
                    <span className="truncate text-center">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
