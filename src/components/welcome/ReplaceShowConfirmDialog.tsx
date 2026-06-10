// ============================================================================
// Slice 3 Step 5: Confirmation dialog before destructive demo load.
// Styling pattern mirrors CrashRecoveryDialog.
// ============================================================================

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useGraphStore } from '../../stores/graphStore'
import { useFormationStore } from '../../stores/formationStore'

interface ReplaceShowConfirmDialogProps {
  demoName: string
  onCancel: () => void
  onReplace: () => void
  onSaveAndReplace: () => void
}

export function ReplaceShowConfirmDialog({
  demoName, onCancel, onReplace, onSaveAndReplace,
}: ReplaceShowConfirmDialogProps) {
  // N-03: surface what the user is about to lose. Pulled lazily — the dialog
  // mounts once per demo-pick so we can read the store on render.
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const formations = useFormationStore((s) => s.formations)
  const formationNodes = nodes.filter((n) => n.type === 'formation').length
  const idleNodes = nodes.filter((n) => n.type === 'idle').length
  const flowEdges = edges.filter((e) => e.edgeType === 'flow').length

  // N-03: keyboard shortcuts. Y/Enter = replace; N/Escape = cancel; S = save
  // & replace. Wired at the document level so they catch even when the
  // dialog hasn't been focused yet.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        onReplace()
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        onSaveAndReplace()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel, onReplace, onSaveAndReplace])

  return (
    <div className="fixed inset-0 z-[60] bg-surface/80 flex items-center justify-center animate-backdrop-in" onClick={onCancel}>
      <div className="animate-dialog-in bg-surface-raised border border-amber-500/30 rounded-lg shadow-2xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-white">Replace current show?</h2>
            <p className="mt-1 text-xs text-white/60">
              Loading <span className="text-white/80">{demoName}</span> will replace the show currently on the canvas.
            </p>
            {(formationNodes + idleNodes + formations.length) > 0 && (
              <div className="mt-2 rounded bg-white/5 border border-white/10 px-2 py-1.5 text-caption text-white/60 space-y-0.5">
                <div className="text-white/40 text-micro uppercase tracking-wider">Will be lost</div>
                <div className="flex justify-between"><span>Formation nodes</span><span className="font-mono text-white/80">{formationNodes}</span></div>
                <div className="flex justify-between"><span>Idle nodes</span><span className="font-mono text-white/80">{idleNodes}</span></div>
                <div className="flex justify-between"><span>Flow edges</span><span className="font-mono text-white/80">{flowEdges}</span></div>
                <div className="flex justify-between"><span>Saved formations</span><span className="font-mono text-white/80">{formations.length}</span></div>
              </div>
            )}
          </div>
        </div>
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-xs text-white/70 hover:bg-white/10 transition-colors"
            title="N / Escape"
          >
            Cancel <span className="ml-1 text-[9px] opacity-60">(N)</span>
          </button>
          <button
            type="button"
            onClick={onSaveAndReplace}
            className="px-3 py-1.5 rounded text-xs text-white/80 bg-white/10 hover:bg-white/15 transition-colors"
            title="S"
          >
            Save & Replace <span className="ml-1 text-[9px] opacity-60">(S)</span>
          </button>
          <button
            type="button"
            onClick={onReplace}
            className="px-3 py-1.5 rounded text-xs font-medium text-white bg-amber-600 hover:bg-amber-500 transition-colors"
            title="Y / Enter"
            autoFocus
          >
            Replace <span className="ml-1 text-[9px] opacity-80">(Y)</span>
          </button>
        </div>
      </div>
    </div>
  )
}
