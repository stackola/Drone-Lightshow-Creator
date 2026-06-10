// ============================================================================
// S8-09: Auto-recovery on crash — offer to restore from autosave
// ============================================================================

import { AlertTriangle } from 'lucide-react'
import type { AutosaveEntry } from '../services/autosave'
import { Button } from './ui'

interface CrashRecoveryDialogProps {
  entry: AutosaveEntry
  onRestore: () => void
  onDiscard: () => void
}

export function CrashRecoveryDialog({ entry, onRestore, onDiscard }: CrashRecoveryDialogProps) {
  const date = new Date(entry.timestamp)
  const timeStr = date.toLocaleTimeString()
  const dateStr = date.toLocaleDateString()

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center animate-backdrop-in">
      <div className="animate-dialog-in bg-surface-raised border border-yellow-500/30 rounded-lg shadow-2xl max-w-md w-full mx-4">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={24} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-semibold text-white">Recover Unsaved Work?</h2>
              <p className="text-sm text-white/50 mt-1">
                It looks like the app was closed unexpectedly. An autosave was found:
              </p>
              <div className="mt-3 p-3 bg-white/5 rounded text-sm text-white/70">
                <div><strong className="text-white/90">{entry.projectName}</strong></div>
                <div className="text-white/40 mt-1">
                  {entry.droneCount} drones &middot; Saved at {timeStr}, {dateStr}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-white/10">
          <button
            onClick={onDiscard}
            className="px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors"
          >
            Discard
          </button>
          <Button variant="primary" size="md" onClick={onRestore}>
            Restore
          </Button>
        </div>
      </div>
    </div>
  )
}
