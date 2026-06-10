// ============================================================================
// Viewport Context Menu — right-click on the 3D stage. Brings the graph
// canvas's "Add Launch / Idle / Land" to Build mode (where the canvas isn't
// mounted) plus selection actions, so a complete show can be authored without
// ever leaving the stage.
//
// Split in two because the menu is DOM (outside the Canvas) but placement
// needs the live camera: the menu dispatches a `viewport-add-node` window
// event; `ViewportAddNodeListener` (inside the Canvas, mounted in
// SceneContents) raycasts the active build plane and creates the node.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { useGraphStore } from '../../stores/graphStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useHistoryStore } from '../../stores/historyStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { useViewStore } from '../../stores/viewStore'
import { usePlanesStore } from '../../stores/planesStore'
import { deleteSelected, duplicateSelected, toggleLockSelected } from '../../stores/editorActions'
import { defaultLaunchData, defaultIdleData, defaultLandData } from '../../graph/nodeDefaults'
import { wireNodeIntoFlow } from '../../graph/autoWire'
import { raycastClientToPlane } from './raycastToPlane'
import { usePointEditorStore } from './PointEditor'
import { toast } from '../Toast'

interface AddNodeDetail {
  type: 'launch' | 'idle' | 'land'
  clientX: number
  clientY: number
}

/** Inside-Canvas listener that places nodes for the DOM context menu. */
export function ViewportAddNodeListener() {
  const { camera, gl, raycaster } = useThree()

  useEffect(() => {
    function onAdd(e: Event) {
      const { type, clientX, clientY } = (e as CustomEvent<AddNodeDetail>).detail
      const startTime = Math.max(0, usePlayheadStore.getState().currentTime)
      const pxPerSecond = useViewStore.getState().pxPerSecond
      const canvasPos = { x: startTime * pxPerSecond, y: 0 }

      useHistoryStore.getState().snapshot(`Add ${type.charAt(0).toUpperCase()}${type.slice(1)}`)
      const store = useGraphStore.getState()
      let id: string
      if (type === 'launch') {
        id = store.addNode('launch', canvasPos, defaultLaunchData(startTime))
      } else if (type === 'land') {
        id = store.addNode('land', canvasPos, defaultLandData())
      } else {
        // Idle hovers around a world point — use the click point on the
        // active build plane when available.
        const plane = usePlanesStore.getState().getActivePlane()
        const hit = plane ? raycastClientToPlane(clientX, clientY, camera, gl.domElement, raycaster, plane) : null
        id = store.addNode('idle', canvasPos, defaultIdleData(startTime, hit?.world))
      }
      useSelectionStore.getState().setSelection([id], [])
      const wired = wireNodeIntoFlow(id)
      const label = type.charAt(0).toUpperCase() + type.slice(1)
      toast.success(wired ? `${label} added and wired into the show` : `${label} added`)
    }

    window.addEventListener('viewport-add-node', onAdd as EventListener)
    return () => window.removeEventListener('viewport-add-node', onAdd as EventListener)
  }, [camera, gl, raycaster])

  return null
}

interface MenuState {
  x: number
  y: number
}

/**
 * Context-menu state + handlers for a viewport container. Spread the returned
 * `onContextMenu`/`onPointerDown` onto the container div and render `menu`
 * inside it. Right-drag is orbit-pan; the menu only opens on a stationary
 * right-click (< 5 px of travel between press and the contextmenu event).
 */
export function useViewportContextMenu() {
  const [state, setState] = useState<MenuState | null>(null)
  const rightDownPos = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2) rightDownPos.current = { x: e.clientX, y: e.clientY }
  }, [])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const down = rightDownPos.current
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
    setState({ x: e.clientX, y: e.clientY })
  }, [])

  const close = useCallback(() => setState(null), [])

  const menu = state ? <ViewportMenu x={state.x} y={state.y} onClose={close} /> : null
  return { onContextMenu, onPointerDown, menu }
}

function ViewportMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const getNode = useGraphStore((s) => s.getNode)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const addItems: { label: string; type: AddNodeDetail['type']; color: string }[] = [
    { label: 'Add Launch', type: 'launch', color: 'text-emerald-400' },
    { label: 'Add Idle', type: 'idle', color: 'text-amber-400' },
    { label: 'Add Land', type: 'land', color: 'text-red-400' },
  ]

  const singleFormation =
    selectedNodeIds.length === 1 && getNode(selectedNodeIds[0]!)?.type === 'formation'
      ? selectedNodeIds[0]!
      : null

  const handleAdd = (type: AddNodeDetail['type']) => {
    window.dispatchEvent(
      new CustomEvent('viewport-add-node', { detail: { type, clientX: x, clientY: y } }),
    )
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        className="animate-panel-in fixed z-50 bg-surface-hover border border-white/10 rounded-lg shadow-xl py-1 min-w-[180px]"
        style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 280) }}
        role="menu"
      >
        <div className="px-3 py-1 text-micro uppercase tracking-wider text-white/30">
          Add at playhead
        </div>
        {addItems.map((item) => (
          <button
            key={item.type}
            className={`w-full px-3 py-1.5 text-left text-sm hover:bg-white/10 ${item.color} transition-colors`}
            onClick={() => handleAdd(item.type)}
          >
            {item.label}
          </button>
        ))}
        {selectedNodeIds.length > 0 && (
          <>
            <div className="my-1 border-t border-white/10" />
            <div className="px-3 py-1 text-micro uppercase tracking-wider text-white/30">
              Selection
            </div>
            {singleFormation && (
              <button
                className="w-full px-3 py-1.5 text-left text-sm text-cyan-300 hover:bg-white/10 transition-colors"
                onClick={() => {
                  // Point editor keys off the formation DEF id, not the node id.
                  const node = useGraphStore.getState().getNode(singleFormation)
                  const defId = (node?.data as { formationId?: string | null } | undefined)?.formationId
                  if (defId) usePointEditorStore.getState().enterEditMode(defId)
                  onClose()
                }}
              >
                Edit Points
              </button>
            )}
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-white/80 hover:bg-white/10 transition-colors"
              onClick={() => { duplicateSelected(); onClose() }}
            >
              Duplicate
            </button>
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-white/80 hover:bg-white/10 transition-colors"
              onClick={() => { toggleLockSelected(); onClose() }}
            >
              Lock / Unlock
            </button>
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-red-300 hover:bg-white/10 transition-colors"
              onClick={() => { deleteSelected(); onClose() }}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </>
  )
}
