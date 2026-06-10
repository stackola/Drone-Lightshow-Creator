// ============================================================================
// InspectorHost — the shell's contextual right panel. Replaces the legacy
// tab router with pure selection routing: single node → its typed inspector,
// single edge → EdgeInspector, multi → MultiSelectInspector, none → a
// coaching empty state. Physics / Settings / AI live elsewhere in the shell
// (status drawer, settings dialog, AI panel mode).
//
// Components/instances: a formation node gets an instance bar when its def
// is placed more than once — master name, usage count, one-click Detach.
// ============================================================================

import type { ReactNode } from 'react'
import { useSelectionStore } from '../../stores/selectionStore'
import { useGraphStore } from '../../stores/graphStore'
import { useFormationStore } from '../../stores/formationStore'
import { formationUsage, detachFormationDef } from '../../stores/formationUsage'
import { FormationNodeInspector } from '../../components/inspectors/FormationNodeInspector'
import { LaunchNodeInspector } from '../../components/inspectors/LaunchNodeInspector'
import { LandNodeInspector } from '../../components/inspectors/LandNodeInspector'
import { IdleNodeInspector } from '../../components/inspectors/IdleNodeInspector'
import { EdgeInspector } from '../../components/inspectors/EdgeInspector'
import { MultiSelectInspector } from './MultiSelectInspector'
import { toast } from '../../components/Toast'
import type { FormationNodeData } from '../../graph/types'

export function InspectorHost() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds)
  const getNode = useGraphStore((s) => s.getNode)

  if (selectedNodeIds.length === 1) {
    const node = getNode(selectedNodeIds[0]!)
    if (!node) return <EmptyState />
    switch (node.type) {
      case 'formation':
        return (
          <div className="h-full flex flex-col min-h-0">
            <InstanceBar nodeId={node.id} />
            <div className="flex-1 min-h-0 overflow-hidden">
              <FormationNodeInspector nodeId={node.id} />
            </div>
          </div>
        )
      case 'launch':
        return <LaunchNodeInspector nodeId={node.id} />
      case 'land':
        return <LandNodeInspector nodeId={node.id} />
      case 'idle':
        return <IdleNodeInspector nodeId={node.id} />
      case 'group':
        return <GroupInspector nodeId={node.id} />
    }
  }

  if (selectedEdgeIds.length === 1 && selectedNodeIds.length === 0) {
    return <EdgeInspector edgeId={selectedEdgeIds[0]!} />
  }

  if (selectedNodeIds.length > 1) {
    return <MultiSelectInspector selectedNodeIds={selectedNodeIds} />
  }

  return <EmptyState />
}

/** Components/instances bar — shown when this placement shares its def. */
function InstanceBar({ nodeId }: { nodeId: string }) {
  const nodes = useGraphStore((s) => s.nodes)
  const formations = useFormationStore((s) => s.formations)
  const node = nodes.find((n) => n.id === nodeId)
  const defId = (node?.data as FormationNodeData | undefined)?.formationId
  if (!defId) return null
  const usage = formationUsage(defId)
  if (usage.length <= 1) return null
  const def = formations.find((f) => f.id === defId)

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-accent-primary/10 border-b border-accent-primary/20 text-micro">
      <span className="text-accent-primary/90 truncate">
        Instance of <span className="font-semibold">{def?.name ?? 'formation'}</span> · placed ×{usage.length}
      </span>
      <button
        className="flex-shrink-0 px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
        title="Clone the formation so edits only affect this placement"
        onClick={() => {
          const newId = detachFormationDef(nodeId)
          if (newId) toast.success('Detached — this placement now has its own formation')
        }}
      >
        Detach
      </button>
    </div>
  )
}

function GroupInspector({ nodeId }: { nodeId: string }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId))
  const childCount = useGraphStore((s) => s.nodes.filter((n) => n.parentId === nodeId).length)
  if (!node || node.type !== 'group') return null
  const data = node.data as { label: string; color: string; collapsed: boolean }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-white/10 text-xs font-semibold text-white/70 uppercase tracking-wider">
        Group Node
      </div>
      <div className="px-3 py-2 space-y-2">
        <Row label="Label">{data.label}</Row>
        <Row label="Color">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: data.color }} />
            <span className="text-white/60">{data.color}</span>
          </div>
        </Row>
        <Row label="Children">{childCount}</Row>
        <Row label="Collapsed">{data.collapsed ? 'Yes' : 'No'}</Row>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-white/70">{label}</span>
      <span className="text-white/90">{children}</span>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 text-center gap-3">
        <div className="text-white/20 text-sm font-medium">Nothing selected</div>
        <div className="text-white/15 text-xs leading-relaxed max-w-[220px]">
          Click a formation on the stage — or a clip in the timeline — to edit its properties.
        </div>
        <div className="text-white/10 text-micro leading-relaxed space-y-1">
          <ShortcutHint chord="Ctrl+K">Command palette</ShortcutHint>
          <ShortcutHint chord="Right-click stage">Add nodes</ShortcutHint>
          <ShortcutHint chord="Double-click">Edit points</ShortcutHint>
          <ShortcutHint chord="?">Keyboard shortcuts</ShortcutHint>
        </div>
      </div>
    </div>
  )
}

function ShortcutHint({ chord, children }: { chord: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="font-mono bg-white/5 rounded px-1 py-0.5 text-[9px] text-white/30">{chord}</span>
      <span>{children}</span>
    </div>
  )
}
