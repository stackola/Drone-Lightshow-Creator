// ============================================================================
// Bundle 4: Per-drone color override groups
// ============================================================================

import { ColorInput } from '../inputs/ColorInput'
import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import type { FormationNodeData, ColorOverrideGroup } from '../../graph/types'
import { Section } from './shared'
import { Tooltip } from '../Tooltip'

export function ColorOverridesSection({ nodeId, data }: { nodeId: string; data: FormationNodeData }) {
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const groups = data.colorOverrides ?? []

  const setGroups = (next: ColorOverrideGroup[], label = 'Edit Color Overrides') => {
    snapshot(label)
    updateNodeData(nodeId, { colorOverrides: next } as Partial<FormationNodeData>)
  }

  return (
    <Section title={`Color Overrides (${groups.length})`}>
      {groups.length === 0 && (
        <div className="text-micro text-white/30">
          Use Point Editor → select drones → "Override color" to create a group.
        </div>
      )}
      {groups.map((grp) => (
        <div key={grp.id} className="bg-white/5 rounded px-2 py-1.5 space-y-1 mb-1">
          <div className="flex items-center justify-between gap-1">
            <input
              type="text"
              value={grp.name}
              onChange={(e) => setGroups(groups.map((g) => (g.id === grp.id ? { ...g, name: e.target.value } : g)), 'Rename color override group')}
              className="flex-1 bg-surface-hover border border-white/10 rounded px-1 py-0.5 text-micro text-white/80 outline-none"
            />
            {/* L4 (2026-05-22): adopted ColorInput — swatch + popover with
                eyedropper + recent + presets, replacing the bespoke
                expand-inline picker. */}
            <ColorInput
              value={grp.color}
              onChange={(next) => setGroups(groups.map((g) => (g.id === grp.id ? { ...g, color: next } : g)), 'Set color override')}
              label="Edit color"
            />
            <Tooltip label="Remove group" side="left">
              <button
                onClick={() => setGroups(groups.filter((g) => g.id !== grp.id), 'Remove color override group')}
                className="text-red-400 hover:text-red-300 text-micro px-1"
                aria-label="Remove group"
              >
                ✕
              </button>
            </Tooltip>
          </div>
          <div className="text-micro text-white/40">{grp.pointIndices.length} drones</div>
        </div>
      ))}
    </Section>
  )
}
