// ============================================================================
// Editor bindings — every keyboard shortcut, declared against the registry.
// Replaces the three legacy window listeners (App.tsx globals,
// useCanvasKeyboard, GizmoKeyboardShortcuts). All actions read stores via
// getState() so registration happens once, from the app shell.
// KeyboardShortcutsOverlay renders from listShortcuts() — these labels ARE
// the user-facing docs.
// ============================================================================

import { registerShortcut, setScopeResolver, installShortcutListener, type ShortcutScope } from './shortcutRegistry'
import { useGraphStore } from '../stores/graphStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useHistoryStore } from '../stores/historyStore'
import { usePlayheadStore } from '../stores/playheadStore'
import { useViewStore } from '../stores/viewStore'
import { useUiModeStore } from '../stores/uiModeStore'
import { usePointEditorStore } from '../components/viewport/PointEditor'
import { activeSelectionDomain } from '../stores/selectionDomain'
import { deleteSelected, duplicateSelected, toggleLockSelected } from '../stores/editorActions'
import { setClipboard, getClipboard } from '../stores/clipboardStore'
import { dispatchCameraPreset } from '../components/viewport/ViewportOverlays'
import { toast } from '../components/Toast'
import type { ShowNode, ShowEdge } from '../graph/types'

function resolveScopes(): ShortcutScope[] {
  const scopes: ShortcutScope[] = ['global']
  const mode = useUiModeStore.getState().mode
  if (mode === 'graph' || useUiModeStore.getState().graphDockOpen) scopes.push('graph')
  if (mode === 'build') scopes.push('viewport')
  if (usePointEditorStore.getState().isActive) scopes.push('point-edit')
  return scopes
}

/** Copy the current node selection (plus inner edges) to the clipboard.
 *  Returns what was picked so cut can reuse it. */
function copySelection(): { nodes: ShowNode[]; edges: ShowEdge[] } | null {
  const { selectedNodeIds } = useSelectionStore.getState()
  if (selectedNodeIds.length === 0) return null
  const { nodes, edges } = useGraphStore.getState()
  const idSet = new Set(selectedNodeIds)
  const pickedNodes: ShowNode[] = []
  let originX = Infinity, originY = Infinity
  for (const id of selectedNodeIds) {
    const n = nodes.find((nn) => nn.id === id)
    if (!n) continue
    pickedNodes.push(JSON.parse(JSON.stringify(n)) as ShowNode)
    originX = Math.min(originX, n.position.x)
    originY = Math.min(originY, n.position.y)
  }
  const pickedEdges: ShowEdge[] = edges
    .filter((eg) => idSet.has(eg.source) && idSet.has(eg.target))
    .map((eg) => JSON.parse(JSON.stringify(eg)) as ShowEdge)
  setClipboard({
    nodes: pickedNodes,
    edges: pickedEdges,
    origin: { x: isFinite(originX) ? originX : 0, y: isFinite(originY) ? originY : 0 },
    timestamp: Date.now(),
  })
  return { nodes: pickedNodes, edges: pickedEdges }
}

/** Actions owned by the App shell (dialog/palette toggles). */
export interface AppShellActions {
  save: () => void
  saveAs: () => void
  openFile: () => void
  showExport: () => void
  toggleSearch: () => void
  toggleHistory: () => void
  toggleShortcutsOverlay: () => void
}

/**
 * Register everything + install the single window listener. Returns a
 * cleanup that removes all of it (called on App unmount / HMR).
 */
export function installEditorShortcuts(app: AppShellActions): () => void {
  setScopeResolver(resolveScopes)
  const un: Array<() => void> = [installShortcutListener()]
  const r = (...args: Parameters<typeof registerShortcut>) => un.push(registerShortcut(...args))

  // ── File / panels (App shell) ─────────────────────────────────────────
  r({ id: 'save', chord: 'ctrl+s', scope: 'global', category: 'File', label: 'Save project', action: (e) => { e.preventDefault(); app.save() } })
  r({ id: 'save-as', chord: 'ctrl+shift+s', scope: 'global', category: 'File', label: 'Save project as…', action: (e) => { e.preventDefault(); app.saveAs() } })
  r({ id: 'open', chord: 'ctrl+o', scope: 'global', category: 'File', label: 'Open project file', action: (e) => { e.preventDefault(); app.openFile() } })
  r({ id: 'export', chord: 'ctrl+e', scope: 'global', category: 'File', label: 'Export show', action: (e) => { e.preventDefault(); app.showExport() } })
  r({ id: 'ai-tab', chord: 'ctrl+i', scope: 'global', category: 'Panels', label: 'Open AI assistant tab', action: (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('switch-inspector-tab', { detail: 'ai' })) } })
  r({ id: 'command-palette', chord: 'ctrl+k', scope: 'global', category: 'Panels', label: 'Command palette', action: (e) => { e.preventDefault(); app.toggleSearch() } })
  r({ id: 'history-palette', chord: 'ctrl+shift+h', scope: 'global', category: 'Panels', label: 'History palette', action: (e) => { e.preventDefault(); app.toggleHistory() } })
  r({ id: 'shortcuts-overlay', chord: '?', scope: 'global', category: 'Panels', label: 'Keyboard shortcuts', action: (e) => { e.preventDefault(); app.toggleShortcutsOverlay() } })
  r({ id: 'toggle-ui', chord: 'ctrl+\\', scope: 'global', category: 'Panels', label: 'Hide / show UI panels', action: (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('toggle-ui-focus')) } })

  // ── History ───────────────────────────────────────────────────────────
  r({ id: 'undo', chord: 'ctrl+z', scope: 'global', category: 'History', label: 'Undo', action: (e) => {
    e.preventDefault()
    const label = useHistoryStore.getState().labelForNextUndo()
    useHistoryStore.getState().undo()
    if (label) toast.info(`Undo: ${label}`, { duration: 1500 })
  } })
  const redo = (e: KeyboardEvent) => {
    e.preventDefault()
    const label = useHistoryStore.getState().labelForNextRedo()
    useHistoryStore.getState().redo()
    if (label) toast.info(`Redo: ${label}`, { duration: 1500 })
  }
  r({ id: 'redo', chord: 'ctrl+shift+z', scope: 'global', category: 'History', label: 'Redo', action: redo })
  r({ id: 'redo-y', chord: 'ctrl+y', scope: 'global', category: 'History', label: 'Redo', action: redo })

  // ── Editing ───────────────────────────────────────────────────────────
  r({ id: 'delete', chord: 'delete', scope: 'global', category: 'Editing', label: 'Delete selection', action: (e) => { e.preventDefault(); deleteSelected() } })
  r({ id: 'duplicate', chord: 'ctrl+d', scope: 'global', category: 'Editing', label: 'Duplicate selection', action: (e) => { e.preventDefault(); duplicateSelected() } })
  r({ id: 'lock', chord: 'ctrl+l', scope: 'global', category: 'Editing', label: 'Lock / unlock selection', action: (e) => { e.preventDefault(); toggleLockSelected() } })
  r({ id: 'mute', chord: 'ctrl+h', scope: 'global', category: 'Editing', label: 'Mute / unmute selection', action: (e) => {
    const { selectedNodeIds } = useSelectionStore.getState()
    if (selectedNodeIds.length === 0) return
    e.preventDefault()
    const { nodes, updateNodeData } = useGraphStore.getState()
    const targets = selectedNodeIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is NonNullable<typeof n> => n != null && (n.type === 'formation' || n.type === 'idle'))
    if (targets.length === 0) return
    const muteCount = targets.filter((n) => (n.data as { muted?: boolean }).muted).length
    const nextMuted = muteCount < targets.length / 2
    useHistoryStore.getState().snapshot(`${nextMuted ? 'Mute' : 'Unmute'} ${targets.length} node${targets.length === 1 ? '' : 's'}`)
    for (const n of targets) updateNodeData(n.id, { muted: nextMuted })
  } })
  r({ id: 'select-all', chord: 'ctrl+a', scope: 'global', category: 'Editing', label: 'Select all nodes', action: (e) => {
    e.preventDefault()
    useSelectionStore.getState().setSelection(useGraphStore.getState().nodes.map((n) => n.id), [])
  } })

  // ── Grouping (graph surface) ──────────────────────────────────────────
  r({ id: 'group', chord: 'ctrl+g', scope: 'graph', category: 'Editing', label: 'Group selection', action: (e) => {
    const { selectedNodeIds, setSelection } = useSelectionStore.getState()
    if (selectedNodeIds.length === 0) return
    e.preventDefault()
    const addGroup = useGraphStore.getState().addGroup
    useHistoryStore.getState().snapshot(`Group ${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? '' : 's'}`)
    const label = selectedNodeIds.length === 1 ? 'Group' : `Group of ${selectedNodeIds.length}`
    const groupId = addGroup(label, '#3b82f6', selectedNodeIds)
    setSelection([groupId], [])
    toast.info(`Grouped ${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? '' : 's'}`, { duration: 2000 })
  } })
  r({ id: 'ungroup', chord: 'ctrl+shift+g', scope: 'graph', category: 'Editing', label: 'Ungroup selection', action: (e) => {
    const { selectedNodeIds } = useSelectionStore.getState()
    if (selectedNodeIds.length === 0) return
    e.preventDefault()
    const { nodes, removeNode } = useGraphStore.getState()
    const groupTargets = selectedNodeIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is NonNullable<typeof n> => n != null && n.type === 'group')
    const children = nodes.filter((n) => n.parentId && groupTargets.some((g) => g.id === n.parentId))
    if (children.length + groupTargets.length === 0) return
    useHistoryStore.getState().snapshot(`Ungroup ${groupTargets.length} group${groupTargets.length === 1 ? '' : 's'}`)
    for (const child of children) {
      useGraphStore.setState((s) => {
        const target = s.nodes.find((nn) => nn.id === child.id)
        if (target) target.parentId = null
      })
    }
    for (const group of groupTargets) removeNode(group.id)
    toast.info(`Ungrouped ${groupTargets.length} group${groupTargets.length === 1 ? '' : 's'}`, { duration: 2000 })
  } })

  // ── Clipboard ─────────────────────────────────────────────────────────
  r({ id: 'copy', chord: 'ctrl+c', scope: 'global', category: 'Clipboard', label: 'Copy selection', action: (e) => {
    const picked = copySelection()
    if (!picked) return
    e.preventDefault()
    toast.info(`Copied ${picked.nodes.length} node${picked.nodes.length === 1 ? '' : 's'}${picked.edges.length ? ` + ${picked.edges.length} edge${picked.edges.length === 1 ? '' : 's'}` : ''}`)
  } })
  r({ id: 'cut', chord: 'ctrl+x', scope: 'global', category: 'Clipboard', label: 'Cut selection', action: (e) => {
    const picked = copySelection()
    if (!picked) return
    e.preventDefault()
    useHistoryStore.getState().snapshot(`Cut ${picked.nodes.length} node${picked.nodes.length === 1 ? '' : 's'}`)
    const removeNode = useGraphStore.getState().removeNode
    for (const n of picked.nodes) {
      if (n.type === 'launch' || n.type === 'land') continue
      removeNode(n.id)
    }
    useSelectionStore.getState().setSelection([], [])
  } })
  r({ id: 'paste', chord: 'ctrl+v', scope: 'global', category: 'Clipboard', label: 'Paste', action: (e) => {
    const clip = getClipboard()
    if (!clip) return
    e.preventDefault()
    useHistoryStore.getState().snapshot(`Paste ${clip.nodes.length} node${clip.nodes.length === 1 ? '' : 's'}`)
    const { addNode, addEdge } = useGraphStore.getState()
    const idMap = new Map<string, string>()
    for (const n of clip.nodes) {
      const cloned = JSON.parse(JSON.stringify(n.data))
      if (cloned.idleConfigs) {
        for (const cfg of cloned.idleConfigs) {
          if (cfg.id) cfg.id = `idle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        }
      }
      idMap.set(n.id, addNode(n.type, { x: n.position.x + 40, y: n.position.y + 40 }, cloned))
    }
    let linked = 0
    for (const eg of clip.edges) {
      const src = idMap.get(eg.source)
      const tgt = idMap.get(eg.target)
      if (!src || !tgt) continue
      if (addEdge(src, eg.sourcePort, tgt, eg.targetPort, eg.edgeType, eg.allocation)) linked++
    }
    useSelectionStore.getState().setSelection(Array.from(idMap.values()), [])
    toast.success(`Pasted ${idMap.size} node${idMap.size === 1 ? '' : 's'}${linked ? ` + ${linked} edge${linked === 1 ? '' : 's'}` : ''}`, { duration: 1500 })
  } })

  // ── Playback ──────────────────────────────────────────────────────────
  r({ id: 'stop', chord: 'ctrl+space', scope: 'global', category: 'Playback', label: 'Stop (reset to 0:00)', action: (e) => {
    e.preventDefault()
    usePlayheadStore.getState().setPlaying(false)
    usePlayheadStore.getState().setCurrentTime(0)
  } })
  r({ id: 'play-pause', chord: 'space', scope: 'global', category: 'Playback', label: 'Play / pause', action: (e) => {
    e.preventDefault()
    const p = usePlayheadStore.getState()
    p.setPlaying(!p.isPlaying)
  } })
  const arrowNudge = (dir: 1 | -1, step: number) => (e: KeyboardEvent) => {
    e.preventDefault()
    const { selectedNodeIds, selectedEdgeIds } = useSelectionStore.getState()
    if (selectedNodeIds.length > 0) {
      const { nodes, updateNodeData } = useGraphStore.getState()
      const targets = selectedNodeIds
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is NonNullable<typeof n> =>
          n != null && (n.type === 'launch' || n.type === 'formation' || n.type === 'idle'))
      if (targets.length > 0) {
        useHistoryStore.getState().snapshot(`Nudge start time (${targets.length} node${targets.length === 1 ? '' : 's'})`)
        for (const n of targets) {
          const data = n.data as { startTime: number }
          updateNodeData(n.id, { startTime: Math.max(0, data.startTime + dir * step) })
        }
      }
      return
    }
    if (selectedEdgeIds.length > 0) return
    const playhead = usePlayheadStore.getState()
    playhead.setCurrentTime(Math.max(0, playhead.currentTime + dir * step))
  }
  r({ id: 'scrub-left', chord: 'arrowleft', scope: 'global', category: 'Playback', label: 'Scrub / nudge −0.1 s', action: arrowNudge(-1, 0.1) })
  r({ id: 'scrub-right', chord: 'arrowright', scope: 'global', category: 'Playback', label: 'Scrub / nudge +0.1 s', action: arrowNudge(1, 0.1) })
  r({ id: 'scrub-left-big', chord: 'shift+arrowleft', scope: 'global', category: 'Playback', label: 'Scrub / nudge −1 s', action: arrowNudge(-1, 1) })
  r({ id: 'scrub-right-big', chord: 'shift+arrowright', scope: 'global', category: 'Playback', label: 'Scrub / nudge +1 s', action: arrowNudge(1, 1) })

  // ── Gizmo & camera (3D stage) ─────────────────────────────────────────
  r({ id: 'gizmo-translate', chord: 'w', scope: 'global', category: 'Gizmo & Camera', label: 'Gizmo: translate', action: () => useViewStore.getState().setGizmoMode('translate') })
  r({ id: 'gizmo-rotate', chord: 'e', scope: 'global', category: 'Gizmo & Camera', label: 'Gizmo: rotate', action: () => useViewStore.getState().setGizmoMode('rotate') })
  r({ id: 'gizmo-scale', chord: 'r', scope: 'global', category: 'Gizmo & Camera', label: 'Gizmo: scale', action: () => useViewStore.getState().setGizmoMode('scale') })
  r({ id: 'snap-plane', chord: 'p', scope: 'global', category: 'Gizmo & Camera', label: 'Toggle snap plane', action: () => useViewStore.getState().toggleSnapPlane() })
  r({ id: 'ground-toggle', chord: 'g g', scope: 'global', category: 'Gizmo & Camera', label: 'Toggle ground (double-tap G)', action: (e) => { e.preventDefault(); useViewStore.getState().toggleGround() } })
  r({ id: 'frame-selection', chord: 'f', scope: 'global', category: 'Gizmo & Camera', label: 'Frame selected formation', action: () => window.dispatchEvent(new CustomEvent('frame-selection')) })
  const PRESETS: Record<string, { position: [number, number, number]; target: [number, number, number] }> = {
    '1': { position: [0, 30, 40], target: [0, 5, 0] },
    '2': { position: [0, 10, 60], target: [0, 10, 0] },
    '3': { position: [60, 10, 0], target: [0, 10, 0] },
    '4': { position: [0, 60, 0.01], target: [0, 0, 0] },
  }
  const LABELS: Record<string, string> = { '1': 'perspective', '2': 'front', '3': 'side', '4': 'top' }
  for (const k of ['1', '2', '3', '4']) {
    r({ id: `camera-${k}`, chord: k, scope: 'global', category: 'Gizmo & Camera', label: `Camera: ${LABELS[k]}`, action: (e) => {
      e.preventDefault()
      dispatchCameraPreset(PRESETS[k]!)
    } })
  }

  // ── Escape — selection-domain aware ───────────────────────────────────
  r({ id: 'escape', chord: 'escape', scope: 'global', category: 'Editing', label: 'Exit mode / clear selection', action: () => {
    const domain = activeSelectionDomain()
    if (domain === 'points') {
      usePointEditorStore.getState().exitEditMode()
      return
    }
    if (domain === 'graph') useSelectionStore.getState().setSelection([], [])
    // 'plane' / 'audience' own their own Escape semantics on their surfaces.
  } })

  return () => {
    un.forEach((u) => u())
  }
}
