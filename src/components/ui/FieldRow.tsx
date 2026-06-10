// ============================================================================
// FieldRow — label + control row used throughout the inspectors. Fixes the
// label column so stacked rows align, and keeps the 11px/40% label idiom.
// ============================================================================

import type { ReactNode } from 'react'

export interface FieldRowProps {
  label: ReactNode
  children: ReactNode
  /** Tailwind width class for the label column. */
  labelWidth?: string
  className?: string
}

export function FieldRow({ label, children, labelWidth = 'w-20', className = '' }: FieldRowProps) {
  return (
    <label className={`flex items-center gap-2 ${className}`}>
      <span className={`${labelWidth} flex-shrink-0 text-caption text-white/40`}>{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </label>
  )
}
