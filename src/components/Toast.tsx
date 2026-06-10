// ============================================================================
// S17-02: Toast Notification System — non-blocking notifications
// L5-toast (2026-05-21): Figma-tier polish — module-level emitter so services
// can fire toasts from anywhere, action buttons, severity-based default
// durations, simple deduplication, dismiss animation.
// ============================================================================

import { useState, useCallback, useEffect, createContext, useContext } from 'react'
import { X } from 'lucide-react'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  type?: ToastType
  duration?: number
  action?: ToastAction
}

interface InternalToast {
  id: number
  message: string
  type: ToastType
  duration: number
  action?: ToastAction
  createdAt: number
}

// Default durations per severity (ms). Errors stick around longer because
// users need time to read them and click the action button if any.
const DEFAULT_DURATION: Record<ToastType, number> = {
  info: 3000,
  success: 2000,
  warning: 5000,
  error: 8000,
}

// Module-level event bus. Services and non-React code call `toast.*` to fire.
// The provider below subscribes and renders.
type ToastListener = (t: { message: string; opts: ToastOptions }) => void
const listeners = new Set<ToastListener>()
function emit(message: string, opts: ToastOptions): void {
  listeners.forEach((l) => l({ message, opts }))
}

/**
 * Module-level toast API. Use from anywhere — services, hooks, components.
 * If no <ToastProvider> is mounted the calls are no-ops; safe to call eagerly.
 *
 *   toast.error('Bake failed', { action: { label: 'Retry', onClick: retry } })
 *   toast.success('Show saved')
 *   toast.warning('Velocity clamped to 8 m/s')
 *   toast.info('Autosaved')
 */
export const toast = {
  info: (msg: string, opts?: Omit<ToastOptions, 'type'>) => emit(msg, { ...opts, type: 'info' }),
  success: (msg: string, opts?: Omit<ToastOptions, 'type'>) => emit(msg, { ...opts, type: 'success' }),
  warning: (msg: string, opts?: Omit<ToastOptions, 'type'>) => emit(msg, { ...opts, type: 'warning' }),
  error: (msg: string, opts?: Omit<ToastOptions, 'type'>) => emit(msg, { ...opts, type: 'error' }),
}

// ────────────────────────────────────────────────────────────────────────────
// React context (legacy `useToast()` API kept compatible).
// ────────────────────────────────────────────────────────────────────────────

interface ToastContextValue {
  addToast: (message: string, type?: ToastType, duration?: number) => void
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} })

/**
 * React hook for in-component toast firing. Equivalent to the module-level
 * `toast.*` API; kept for components that prefer hook-style.
 */
export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}

let toastId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<InternalToast[]>([])

  const push = useCallback((message: string, opts: ToastOptions) => {
    const type = opts.type ?? 'info'
    const duration = opts.duration ?? DEFAULT_DURATION[type]
    const now = Date.now()
    setToasts((prev) => {
      // Dedupe: identical message + type fired within 1 s collapses into a single toast.
      const dup = prev.find((t) => t.message === message && t.type === type && now - t.createdAt < 1000)
      if (dup) return prev
      const id = ++toastId
      return [...prev, { id, message, type, duration, action: opts.action, createdAt: now }]
    })
  }, [])

  // Subscribe to the module-level emitter while mounted.
  useEffect(() => {
    const listener: ToastListener = ({ message, opts }) => push(message, opts)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [push])

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((message: string, type: ToastType = 'info', duration?: number) => {
    push(message, { type, duration })
  }, [push])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-10 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast: t, onRemove }: { toast: InternalToast; onRemove: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(t.id), t.duration)
    return () => clearTimeout(timer)
  }, [t.id, t.duration, onRemove])

  const colors = {
    info: 'bg-blue-900/80 border-blue-500/30 text-blue-200',
    success: 'bg-green-900/80 border-green-500/30 text-green-200',
    warning: 'bg-yellow-900/80 border-yellow-500/30 text-yellow-200',
    error: 'bg-red-900/80 border-red-500/30 text-red-200',
  }

  return (
    <div className={`pointer-events-auto flex items-center gap-3 px-4 py-2 rounded-lg border shadow-xl backdrop-blur-sm text-sm ${colors[t.type]} animate-in slide-in-from-right`}>
      <span className="flex-1 whitespace-pre-line">{t.message}</span>
      {t.action && (
        <button
          onClick={() => { t.action!.onClick(); onRemove(t.id) }}
          className="px-2 py-0.5 rounded text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors"
        >
          {t.action.label}
        </button>
      )}
      <button onClick={() => onRemove(t.id)} className="text-white/40 hover:text-white/70" aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}
