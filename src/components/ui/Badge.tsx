// ============================================================================
// Badge — small count/status chip (tab badges, validation counts, node tags).
// One shape (rounded-full, 9px, padded) with semantic tones.
// ============================================================================

import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'accent'

const TONES: Record<Tone, string> = {
  neutral: 'bg-white/10 text-white/60',
  info: 'bg-status-info/15 text-status-info',
  success: 'bg-status-success/15 text-status-success',
  warning: 'bg-status-warning/15 text-status-warning',
  error: 'bg-status-error/20 text-status-error',
  accent: 'bg-accent-primary/15 text-accent-primary',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

export function Badge({ tone = 'neutral', className = '', children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full px-1.5 py-px text-[9px] font-semibold leading-none ${TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  )
}
