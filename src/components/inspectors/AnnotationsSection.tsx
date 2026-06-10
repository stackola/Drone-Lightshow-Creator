// ============================================================================
// Bundle 8: Annotations section — pinned notes on a node
// ============================================================================

import { useState } from 'react'
import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import { Section } from './shared'
import { Tooltip } from '../Tooltip'
import type { FormationNodeData, NodeAnnotation } from '../../graph/types'
import { StickyNote, Trash2 } from 'lucide-react'

export function AnnotationsSection({ nodeId, data }: { nodeId: string; data: FormationNodeData }) {
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const [draft, setDraft] = useState('')
  const annotations = data.annotations ?? []

  const setAnnotations = (next: NodeAnnotation[], label = 'Edit Annotations') => {
    snapshot(label)
    updateNodeData(nodeId, { annotations: next } as Partial<FormationNodeData>)
  }

  const add = () => {
    const text = draft.trim()
    if (!text) return
    setAnnotations([
      ...annotations,
      { id: `note-${Date.now()}`, text, createdAt: Date.now() },
    ], 'Add note')
    setDraft('')
  }

  return (
    <Section title={`Notes (${annotations.length})`}>
      <div className="flex gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="Add a note for this node…"
          className="flex-1 bg-surface-hover border border-white/10 rounded px-2 py-0.5 text-xs text-white/80 outline-none focus:border-cyan-500/50"
        />
        <button
          onClick={add}
          className="px-2 py-0.5 text-micro bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-200 rounded"
        >
          +
        </button>
      </div>
      {annotations.length === 0 && (
        <div className="text-micro text-white/30 mt-1">e.g. "client wants this slower"</div>
      )}
      {annotations.map((n) => (
        <div key={n.id} className="bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1 mt-1 flex items-start gap-1">
          <StickyNote size={11} className="text-amber-300 mt-0.5 shrink-0" />
          <div className="flex-1 text-caption text-white/80">{n.text}</div>
          <Tooltip label="Delete note" side="left">
            <button
              onClick={() => setAnnotations(annotations.filter((a) => a.id !== n.id), 'Remove note')}
              className="text-red-400 hover:text-red-300"
              aria-label="Delete note"
            >
              <Trash2 size={11} />
            </button>
          </Tooltip>
        </div>
      ))}
    </Section>
  )
}
