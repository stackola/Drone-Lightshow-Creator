// ============================================================================
// SectionHeader — uppercase tracking label that tops panels and inspector
// sections. Two density levels:
//   bar    — full-width bar with bottom border (panel headers)
//   inline — bare label above a field group (inspector sections)
// `actions` renders right-aligned (e.g. an IconButton or count Badge).
// ============================================================================

import type { ReactNode } from 'react'

export interface SectionHeaderProps {
  children: ReactNode
  variant?: 'bar' | 'inline'
  actions?: ReactNode
  className?: string
}

export function SectionHeader({ children, variant = 'bar', actions, className = '' }: SectionHeaderProps) {
  if (variant === 'inline') {
    return (
      <div className={`flex items-center justify-between text-micro uppercase tracking-wider text-white/30 ${className}`}>
        <span>{children}</span>
        {actions}
      </div>
    )
  }
  return (
    <div className={`flex items-center justify-between px-3 py-2 border-b border-white/10 text-xs font-semibold text-white/70 uppercase tracking-wider ${className}`}>
      <span>{children}</span>
      {actions}
    </div>
  )
}
