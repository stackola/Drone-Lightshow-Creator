// ============================================================================
// IconButton — the shared icon-only button. Mirrors the pattern used across
// HeaderBar / TransportControls / toolbars:
//   p-1.5 rounded, white/40 → white/80 on hover, white/10 hover wash.
// Pass `active` for a persistent on-state (accent text + wash).
// Always provide aria-label (enforced by the prop type).
// ============================================================================

import { forwardRef, type ButtonHTMLAttributes } from 'react'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { active = false, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'text-accent-primary bg-white/10'
          : 'text-white/40 hover:text-white/80 hover:bg-white/10'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})
