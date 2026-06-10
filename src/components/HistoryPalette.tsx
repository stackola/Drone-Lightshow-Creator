// ============================================================================
// L5-undo (2026-05-21) — history palette. Opens via the keyboard (Ctrl+Shift+H)
// and shows the labelled undo stack so power users can see exactly what each
// step did and jump back N steps in one click.
// ============================================================================

import { useState, useEffect, useMemo } from 'react'
import { X, Undo2, Redo2, History } from 'lucide-react'
import { useHistoryStore, getHistorySummary } from '../stores/historyStore'
import { toast } from './Toast'

function relativeTime(t: number): string {
  const dt = Date.now() - t
  if (dt < 1000) return 'just now'
  if (dt < 60_000) return `${Math.round(dt / 1000)}s ago`
  if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m ago`
  return `${Math.round(dt / 3_600_000)}h ago`
}

interface Props {
  onClose: () => void
}

export function HistoryPalette({ onClose }: Props) {
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)
  const [, forceRefresh] = useState(0)
  // History store mutations don't go through React; tick once per second to
  // refresh "just now" / "5s ago" labels.
  useEffect(() => {
    const i = window.setInterval(() => forceRefresh((n) => n + 1), 1000)
    return () => window.clearInterval(i)
  }, [])
  const summary = useMemo(() => getHistorySummary(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stepUndo = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const label = useHistoryStore.getState().labelForNextUndo()
      if (!label) break
      undo()
    }
    toast.info(`Undid ${n} step${n === 1 ? '' : 's'}`, { duration: 1500 })
    onClose()
  }

  const stepRedo = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const label = useHistoryStore.getState().labelForNextRedo()
      if (!label) break
      redo()
    }
    toast.info(`Redid ${n} step${n === 1 ? '' : 's'}`, { duration: 1500 })
    onClose()
  }

  // Render: past entries newest-first (so the user can scan recent edits),
  // then a divider, then future entries (redo stack).
  const pastReversed = [...summary.past].reverse()

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[15vh] animate-backdrop-in" onClick={onClose}>
      <div
        className="animate-dialog-in bg-surface-raised border border-white/10 rounded-lg shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <Undo2 size={14} className="text-white/40" />
          <span className="flex-1 text-sm text-white/80">History</span>
          <span className="text-micro text-white/30 font-mono">{summary.past.length} undo · {summary.future.length} redo</span>
          <button onClick={onClose} className="text-white/30 hover:text-white/60" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {pastReversed.length === 0 && summary.future.length === 0 && (
            <div className="px-4 py-8 flex flex-col items-center justify-center gap-2 text-center">
              <History size={22} className="text-white/30" aria-hidden="true" />
              <div className="text-sm font-medium text-white/60">No history yet</div>
              <div className="text-caption text-white/30 max-w-[240px] leading-relaxed">
                Every edit you make will land here. Use Ctrl+Z to step back; click any row in this palette to jump back N steps at once.
              </div>
            </div>
          )}
          {pastReversed.map((entry, idx) => (
            <button
              key={`p-${idx}`}
              onClick={() => stepUndo(idx + 1)}
              className="w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-white/5 transition-colors group"
            >
              <Undo2 size={12} className="text-white/30 group-hover:text-cyan-400 flex-shrink-0" />
              <span className="flex-1 text-sm text-white/70 truncate">{entry.label}</span>
              <span className="text-micro text-white/30 flex-shrink-0">{relativeTime(entry.timestamp)}</span>
            </button>
          ))}
          {summary.future.length > 0 && (
            <div className="border-t border-white/10">
              {summary.future.map((entry, idx) => (
                <button
                  key={`f-${idx}`}
                  onClick={() => stepRedo(idx + 1)}
                  className="w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-white/5 transition-colors group"
                >
                  <Redo2 size={12} className="text-white/30 group-hover:text-purple-400 flex-shrink-0" />
                  <span className="flex-1 text-sm text-white/40 truncate">{entry.label}</span>
                  <span className="text-micro text-white/30 flex-shrink-0">{relativeTime(entry.timestamp)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/10 text-micro text-white/30">
          <span>click to jump · esc to close</span>
          <span>Ctrl+Shift+H</span>
        </div>
      </div>
    </div>
  )
}
