// ============================================================================
// PhysicsDrawer + PhysicsBadge — physics as ambient status instead of a tab.
// The badge lives in the StatusStrip; clicking it slides a drawer up from
// the bottom hosting the (lifted) ViolationsPanel.
// ============================================================================

import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import { ViolationsPanel } from '../../components/panels/ViolationsPanel'
import { IconButton } from '../../components/ui'
import type { PhysicsViolation } from '../../graph/physicsValidator'

export function PhysicsBadge({ violations, onClick, open }: { violations: PhysicsViolation[]; onClick: () => void; open: boolean }) {
  const errors = violations.filter((v) => v.severity === 'error').length
  const warnings = violations.length - errors
  return (
    <button
      data-testid="physics-badge"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-1.5 rounded transition-colors ${
        open ? 'bg-white/10' : 'hover:bg-white/10'
      } ${errors > 0 ? 'text-red-400' : warnings > 0 ? 'text-amber-300' : 'text-emerald-400/70'}`}
      title={errors + warnings === 0 ? 'Physics validates clean' : `${errors} error(s), ${warnings} warning(s) — click for details`}
    >
      {errors + warnings === 0 ? <ShieldCheck size={10} aria-hidden="true" /> : <AlertTriangle size={10} aria-hidden="true" />}
      {errors + warnings === 0 ? 'Physics OK' : `${errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : `${warnings} warning${warnings === 1 ? '' : 's'}`}`}
    </button>
  )
}

export function PhysicsDrawer({ violations, onClose }: { violations: PhysicsViolation[]; onClose: () => void }) {
  return (
    <div
      data-testid="physics-drawer"
      className="animate-panel-in flex-shrink-0 border-t border-white/10 bg-surface-raised/95 flex flex-col"
      style={{ height: 260 }}
    >
      <div className="flex items-center justify-between px-3 py-1 border-b border-white/10 flex-shrink-0">
        <div className="text-micro uppercase tracking-wider text-white/40">Physics validation</div>
        <IconButton aria-label="Close physics drawer" onClick={onClose}>
          <X size={12} />
        </IconButton>
      </div>
      <div className="flex-1 min-h-0">
        <ViolationsPanel precomputedViolations={violations} />
      </div>
    </div>
  )
}
