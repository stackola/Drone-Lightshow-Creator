// ============================================================================
// MultiSelectInspector (shell) — type breakdown + batch operations across the
// selection. Ported from the legacy InspectorPanel (which is deleted at
// cutover); math lives in graph/alignDistribute.
// ============================================================================

import { useGraphStore } from '../../stores/graphStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useHistoryStore } from '../../stores/historyStore'
import { alignAxisToMean, distributeAxisEvenly } from '../../graph/alignDistribute'

const BTN = 'flex-1 px-2 py-1 text-caption rounded bg-white/5 hover:bg-white/15 text-white/80'

export function MultiSelectInspector({ selectedNodeIds }: { selectedNodeIds: string[] }) {
  const nodes = useGraphStore((s) => s.nodes)
  const selected = nodes.filter((n) => selectedNodeIds.includes(n.id))
  const counts = selected.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1
    return acc
  }, {})
  const formationIds = selected.filter((n) => n.type === 'formation').map((n) => n.id)
  const timeAwareIds = selected
    .filter((n) => n.type === 'formation' || n.type === 'idle' || n.type === 'launch')
    .map((n) => n.id)

  const snapshot = useHistoryStore((s) => s.snapshot)

  const nudgeStartTime = (deltaSeconds: number): void => {
    snapshot(`Nudge start time (${selectedNodeIds.length} nodes)`)
    const { updateNodeData, getNode } = useGraphStore.getState()
    for (const id of timeAwareIds) {
      const n = getNode(id)
      if (!n) continue
      const data = n.data as { startTime?: number }
      if (typeof data.startTime !== 'number') continue
      updateNodeData(id, { startTime: Math.max(0, data.startTime + deltaSeconds) })
    }
  }

  const nudgeAltitude = (deltaMeters: number): void => {
    snapshot(`Nudge altitude (${formationIds.length} formations)`)
    const { updateNodeData, getNode } = useGraphStore.getState()
    for (const id of formationIds) {
      const n = getNode(id)
      if (!n || n.type !== 'formation') continue
      const data = n.data as { transform: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } } }
      updateNodeData(id, {
        transform: { ...data.transform, position: { ...data.transform.position, y: data.transform.position.y + deltaMeters } },
      })
    }
  }

  const deleteSelected = (): void => {
    snapshot(`Delete ${selectedNodeIds.length} nodes`)
    const removeNode = useGraphStore.getState().removeNode
    for (const id of selectedNodeIds) {
      const node = nodes.find((n) => n.id === id)
      if (node && (node.type === 'launch' || node.type === 'land')) continue
      removeNode(id)
    }
    useSelectionStore.getState().setSelection([], [])
  }

  const alignStartTime = (): void => {
    if (timeAwareIds.length < 2) return
    const { getNode, updateNodeData } = useGraphStore.getState()
    const times = timeAwareIds
      .map((id) => (getNode(id)?.data as { startTime?: number } | undefined)?.startTime)
      .filter((t): t is number => typeof t === 'number')
    if (times.length === 0) return
    const minTime = Math.min(...times)
    snapshot(`Align start times (${timeAwareIds.length} nodes)`)
    for (const id of timeAwareIds) updateNodeData(id, { startTime: minTime })
  }

  const collectUnlockedFormations = () => {
    const getNode = useGraphStore.getState().getNode
    return formationIds
      .map((id) => getNode(id))
      .filter((n): n is NonNullable<typeof n> => n != null && n.type === 'formation' && !(n.data as { locked?: boolean }).locked)
      .map((n) => {
        const data = n.data as { transform: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } } }
        return { id: n.id, position: data.transform.position, data }
      })
  }

  const alignPositionAxis = (axis: 'x' | 'y' | 'z'): void => {
    const items = collectUnlockedFormations()
    const updates = alignAxisToMean(items, axis)
    if (updates.length === 0) return
    snapshot(`Align ${axis.toUpperCase()} (${updates.length} formations)`)
    const updateNodeData = useGraphStore.getState().updateNodeData
    const dataById = new Map(items.map((i) => [i.id, i.data]))
    for (const u of updates) {
      const data = dataById.get(u.id)
      if (!data) continue
      updateNodeData(u.id, { transform: { ...data.transform, position: u.position } })
    }
  }

  const distributePositionAxis = (axis: 'x' | 'y' | 'z'): void => {
    const items = collectUnlockedFormations()
    const updates = distributeAxisEvenly(items, axis)
    if (updates.length === 0) return
    snapshot(`Distribute ${axis.toUpperCase()} (${updates.length} formations)`)
    const updateNodeData = useGraphStore.getState().updateNodeData
    const dataById = new Map(items.map((i) => [i.id, i.data]))
    for (const u of updates) {
      const data = dataById.get(u.id)
      if (!data) continue
      updateNodeData(u.id, { transform: { ...data.transform, position: u.position } })
    }
  }

  const distributeStartTime = (): void => {
    if (timeAwareIds.length < 3) return
    const { getNode, updateNodeData } = useGraphStore.getState()
    const sorted = timeAwareIds
      .map((id) => ({ id, t: (getNode(id)?.data as { startTime?: number } | undefined)?.startTime }))
      .filter((x): x is { id: string; t: number } => typeof x.t === 'number')
      .sort((a, b) => a.t - b.t)
    if (sorted.length < 3) return
    const first = sorted[0]!.t
    const last = sorted[sorted.length - 1]!.t
    const step = (last - first) / (sorted.length - 1)
    snapshot(`Distribute start times (${sorted.length} nodes)`)
    for (let i = 0; i < sorted.length; i++) {
      updateNodeData(sorted[i]!.id, { startTime: first + i * step })
    }
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-white/10 text-xs font-semibold text-white/70 uppercase tracking-wider">
        {selectedNodeIds.length} nodes selected
      </div>

      <div className="px-3 py-2 border-b border-white/10 flex flex-wrap gap-1.5">
        {Object.entries(counts).map(([type, n]) => (
          <span key={type} className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-micro text-white/70">
            <span className="font-semibold text-white/90">{n}</span>
            {type}
            {n === 1 ? '' : 's'}
          </span>
        ))}
      </div>

      {timeAwareIds.length > 0 && (
        <div className="px-3 py-2 border-b border-white/10">
          <div className="text-micro uppercase tracking-wider text-white/40 mb-1.5">Start time</div>
          <div className="flex gap-1">
            <button onClick={() => nudgeStartTime(-1)} className={BTN}>−1s</button>
            <button onClick={() => nudgeStartTime(-0.1)} className={BTN}>−0.1s</button>
            <button onClick={() => nudgeStartTime(0.1)} className={BTN}>+0.1s</button>
            <button onClick={() => nudgeStartTime(1)} className={BTN}>+1s</button>
          </div>
        </div>
      )}

      {formationIds.length > 0 && (
        <div className="px-3 py-2 border-b border-white/10">
          <div className="text-micro uppercase tracking-wider text-white/40 mb-1.5">Altitude (formations)</div>
          <div className="flex gap-1">
            <button onClick={() => nudgeAltitude(-5)} className={BTN}>−5m</button>
            <button onClick={() => nudgeAltitude(-1)} className={BTN}>−1m</button>
            <button onClick={() => nudgeAltitude(1)} className={BTN}>+1m</button>
            <button onClick={() => nudgeAltitude(5)} className={BTN}>+5m</button>
          </div>
        </div>
      )}

      {timeAwareIds.length >= 2 && (
        <div className="px-3 py-2 border-b border-white/10">
          <div className="text-micro uppercase tracking-wider text-white/40 mb-1.5">Align / distribute</div>
          <div className="flex gap-1">
            <button onClick={alignStartTime} className={BTN} title="Set every selected start time to the earliest in the selection">
              Align starts
            </button>
            <button
              onClick={distributeStartTime}
              disabled={timeAwareIds.length < 3}
              className={`${BTN} disabled:opacity-30 disabled:cursor-not-allowed`}
              title={timeAwareIds.length < 3 ? 'Need at least 3 nodes to distribute' : 'Distribute start times evenly between earliest and latest'}
            >
              Distribute
            </button>
          </div>
        </div>
      )}

      {formationIds.length >= 2 && (
        <div className="px-3 py-2 border-b border-white/10">
          <div className="text-micro uppercase tracking-wider text-white/40 mb-1.5">Align positions</div>
          <div className="flex gap-1">
            <button onClick={() => alignPositionAxis('x')} className={BTN} title="Set each formation's X to the selection's mean X">Align X</button>
            <button onClick={() => alignPositionAxis('y')} className={BTN} title="Set each formation's Y to the selection's mean Y (altitude)">Align Y</button>
            <button onClick={() => alignPositionAxis('z')} className={BTN} title="Set each formation's Z to the selection's mean Z">Align Z</button>
          </div>
        </div>
      )}

      {formationIds.length >= 3 && (
        <div className="px-3 py-2 border-b border-white/10">
          <div className="text-micro uppercase tracking-wider text-white/40 mb-1.5">Distribute positions</div>
          <div className="flex gap-1">
            <button onClick={() => distributePositionAxis('x')} className={BTN} title="Space the formations evenly between min and max X">Dist X</button>
            <button onClick={() => distributePositionAxis('y')} className={BTN} title="Space the formations evenly between min and max Y">Dist Y</button>
            <button onClick={() => distributePositionAxis('z')} className={BTN} title="Space the formations evenly between min and max Z">Dist Z</button>
          </div>
        </div>
      )}

      <div className="px-3 py-2">
        <button
          onClick={deleteSelected}
          className="w-full px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
        >
          Delete Selected
        </button>
      </div>
    </div>
  )
}
