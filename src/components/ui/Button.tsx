// ============================================================================
// Button — the shared button primitive. Replaces the ~8 bespoke button
// recipes that grew across the app. Variants are modeled on the dominant
// existing patterns so adoption is a visual no-op for most call sites:
//   primary — solid accent CTA (export, confirm)
//   ghost   — quiet text/utility button on panels
//   danger  — destructive action
//   toggle  — pill that carries an active state (mode/view switchers)
// ============================================================================

import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'danger' | 'toggle'
type Size = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Only meaningful for variant="toggle". */
  active?: boolean
}

const SIZES: Record<Size, string> = {
  sm: 'px-2 py-0.5 text-micro',
  md: 'px-3 py-1.5 text-xs',
}

const VARIANTS: Record<Variant, (active: boolean) => string> = {
  primary: () =>
    'bg-accent-primary/90 text-slate-900 font-medium hover:bg-accent-primary disabled:opacity-40 disabled:cursor-not-allowed',
  ghost: () =>
    'text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed',
  danger: () =>
    'text-red-300 hover:text-red-200 hover:bg-red-500/15 disabled:opacity-40 disabled:cursor-not-allowed',
  toggle: (active) =>
    active
      ? 'bg-accent-primary/90 text-slate-900 font-medium shadow'
      : 'text-white/50 hover:text-white/80 hover:bg-white/10',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', active = false, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`rounded transition-colors active:scale-95 ${SIZES[size]} ${VARIANTS[variant](active)} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})
