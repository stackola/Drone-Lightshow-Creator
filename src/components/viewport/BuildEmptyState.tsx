// ============================================================================
// Build-mode empty state — shown over the 3D stage when the show has no
// formations yet. Points the user at the primary build interaction (drag a
// formation onto the stage) instead of leaving them on a blank canvas.
// ============================================================================

import { MousePointerClick } from 'lucide-react'
import { useGraphStore } from '../../stores/graphStore'

export function BuildEmptyState() {
  const hasFormation = useGraphStore((s) => s.nodes.some((n) => n.type === 'formation'))
  if (hasFormation) return null

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="floating-panel px-6 py-5 text-center max-w-sm">
        <div className="mx-auto mb-3 w-11 h-11 rounded-full bg-cyan-400/15 grid place-items-center ring-1 ring-cyan-400/30">
          <MousePointerClick size={20} className="text-cyan-300" aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold text-white/90">Place your first formation</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-white/55">
          Drag a shape from the <span className="text-cyan-300">Formations</span> panel onto the stage.
          It snaps to the active build plane — switch views or planes anytime from the controls above.
        </p>
      </div>
    </div>
  )
}
