// ============================================================================
// MasterEditBanner — components/instances honesty for point editing. The
// point editor writes to the formation DEF (the master), so when that def is
// placed more than once, edits ripple to every placement. This banner makes
// that explicit and offers the copy-on-write escape: "Detach this copy"
// clones the def, repoints the selected placement, and re-enters point edit
// on the private clone. DOM overlay — mount in the viewport HUD.
// ============================================================================

import { usePointEditorStore } from './PointEditor'
import { useGraphStore } from '../../stores/graphStore'
import { useFormationStore } from '../../stores/formationStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { detachFormationDef } from '../../stores/formationUsage'
import { toast } from '../Toast'
import type { FormationNodeData } from '../../graph/types'

export function MasterEditBanner() {
  const isActive = usePointEditorStore((s) => s.isActive)
  const defId = usePointEditorStore((s) => s.formationId)
  const nodes = useGraphStore((s) => s.nodes)
  const formations = useFormationStore((s) => s.formations)
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)

  if (!isActive || !defId) return null
  const usage = nodes
    .filter((n) => n.type === 'formation' && (n.data as FormationNodeData).formationId === defId)
    .map((n) => n.id)
  if (usage.length <= 1) return null

  const def = formations.find((f) => f.id === defId)
  const detachTarget = selectedNodeIds.find((id) => usage.includes(id)) ?? usage[0]!

  const handleDetach = () => {
    const newId = detachFormationDef(detachTarget)
    if (!newId) return
    const editor = usePointEditorStore.getState()
    editor.exitEditMode()
    editor.enterEditMode(newId)
    toast.success('Detached — edits now affect only this placement')
  }

  return (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
      <div className="floating-panel animate-panel-in pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-caption">
        <span className="text-amber-300">
          Editing master{def ? ` “${def.name}”` : ''} — affects {usage.length} placements
        </span>
        <button
          className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
          onClick={handleDetach}
        >
          Detach this copy
        </button>
      </div>
    </div>
  )
}
