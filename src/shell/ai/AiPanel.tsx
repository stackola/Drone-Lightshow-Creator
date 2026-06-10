// ============================================================================
// AiPanel — the AI co-designer as an inspector-column MODE (not a tab):
// toggling AI in the TopBar swaps the right panel to the chat; selecting
// something on the stage swaps back. Hosts the lifted AIChatPanel.
// ============================================================================

import { Sparkles, X } from 'lucide-react'
import { AIChatPanel } from '../../components/AIChatPanel'
import { IconButton } from '../../components/ui'

export function AiPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-white/70 uppercase tracking-wider">
          <Sparkles size={12} className="text-accent-secondary" />
          AI co-designer
        </div>
        <IconButton aria-label="Close AI panel" onClick={onClose}>
          <X size={12} />
        </IconButton>
      </div>
      <div className="flex-1 min-h-0">
        <AIChatPanel />
      </div>
    </div>
  )
}
