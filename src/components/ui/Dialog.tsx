// ============================================================================
// Dialog — modal chrome shared by every dialog: dimmed animated backdrop,
// raised panel with the standard border/radius/shadow, click-outside +
// Escape to close, optional title bar with close button. Entry animations
// (animate-backdrop-in / animate-dialog-in) are baked in.
// ============================================================================

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'

export interface DialogProps {
  onClose?: () => void
  title?: ReactNode
  children: ReactNode
  /** Width class for the panel; default matches the app's dialogs. */
  widthClassName?: string
  /** z-index class for stacking above other overlays. */
  zClassName?: string
}

export function Dialog({ onClose, title, children, widthClassName = 'max-w-md', zClassName = 'z-50' }: DialogProps) {
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={`fixed inset-0 ${zClassName} bg-black/60 flex items-center justify-center animate-backdrop-in`}
      onClick={onClose}
    >
      <div
        className={`animate-dialog-in bg-surface-raised border border-white/10 rounded-lg shadow-2xl w-full mx-4 ${widthClassName}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title != null && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="text-sm font-semibold text-white/90">{title}</div>
            {onClose && (
              <IconButton aria-label="Close dialog" onClick={onClose}>
                <X size={14} />
              </IconButton>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
