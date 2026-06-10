// ============================================================================
// L5-tooltips (2026-05-21) — unified Tooltip component.
// 300ms hover delay, 200ms fade, keyboard-accessible (shows on focus too).
// Replaces ad-hoc `title=` attributes across the app.
// ============================================================================

import { useState, useRef, useEffect, type ReactNode } from 'react'

export interface TooltipProps {
  /** Label shown in the tooltip body. */
  label: ReactNode
  /** Optional keyboard-shortcut hint shown in a chip next to the label. */
  shortcut?: string
  /** Side relative to the child. `auto` chooses based on viewport space. */
  side?: 'top' | 'bottom' | 'left' | 'right' | 'auto'
  /** Show delay in ms (default 300). */
  delay?: number
  /** Children get the trigger — wrap a button, input, etc. */
  children: ReactNode
  /** Disable the tooltip (useful for conditional rendering). */
  disabled?: boolean
}

const FADE_MS = 150

export function Tooltip({ label, shortcut, side = 'auto', delay = 300, children, disabled }: TooltipProps) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [resolvedSide, setResolvedSide] = useState<'top' | 'bottom' | 'left' | 'right'>('top')

  const show = (): void => {
    if (disabled) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      // Auto-side: prefer 'top'; flip to 'bottom' if the trigger is close to the viewport top.
      if (side === 'auto') {
        const rect = wrapRef.current?.getBoundingClientRect()
        if (rect && rect.top < 56) setResolvedSide('bottom')
        else setResolvedSide('top')
      } else {
        setResolvedSide(side)
      }
      setOpen(true)
    }, delay)
  }

  const hide = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setOpen(false)
  }

  // Hide on unmount.
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const positionClasses: Record<'top' | 'bottom' | 'left' | 'right', string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }

  return (
    <span
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="relative inline-flex"
    >
      {children}
      {open && (
        <span
          role="tooltip"
          aria-live="polite"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded px-2 py-1 text-caption leading-none shadow-xl backdrop-blur-sm bg-surface-raised/95 border border-white/10 text-white/90 ${positionClasses[resolvedSide]}`}
          style={{
            animation: `tooltipFade ${FADE_MS}ms ease-out forwards`,
          }}
        >
          <span>{label}</span>
          {shortcut && (
            <span className="ml-2 inline-flex items-center rounded bg-white/10 px-1 py-0.5 text-micro font-mono text-white/60">
              {shortcut}
            </span>
          )}
        </span>
      )}
      {/* Animation keyframes injected once; harmless to duplicate. */}
      <style>{`@keyframes tooltipFade { from { opacity: 0; transform: translateY(2px) translateX(var(--tt-tx, 0)) } to { opacity: 1; transform: translateY(0) } }`}</style>
    </span>
  )
}
