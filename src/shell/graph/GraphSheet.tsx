// ============================================================================
// GraphSheet — the node-graph as a slide-up sheet over the stage, replacing
// the legacy bottom dock. Hosts the existing GraphCanvas untouched.
// Pinned open in Graph mode; toggled via graphDockOpen in Build mode.
// ============================================================================

import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { GraphCanvas } from '../../components/canvas/GraphCanvas'
import { useUiModeStore } from '../../stores/uiModeStore'
import { useGraphStore } from '../../stores/graphStore'
import { IconButton } from '../../components/ui'
import { X } from 'lucide-react'

/** GraphCanvas's fitView only fires on RF init — in the sheet the canvas
 * mounts before the project loads, so nothing fits. Once nodes exist, show
 * the HEAD of the show (launch end) rather than fitting the whole graph:
 * shows are timeline-shaped (node x = time), so a full fit on a long show
 * bottoms out at minZoom and pushes the start off-screen. */
function FitOnOpen() {
  const { setViewport } = useReactFlow()
  const hasNodes = useGraphStore((s) => s.nodes.length > 0)
  const didFit = useRef(false)
  useEffect(() => {
    if (!hasNodes || didFit.current) return
    didFit.current = true
    const raf = requestAnimationFrame(() => {
      const nodes = useGraphStore.getState().nodes
      const minX = Math.min(...nodes.map((n) => n.position.x))
      const minY = Math.min(...nodes.map((n) => n.position.y))
      void setViewport({ x: 32 - minX * 0.75, y: 48 - minY * 0.75, zoom: 0.75 }, { duration: 200 })
    })
    return () => cancelAnimationFrame(raf)
  }, [hasNodes, setViewport])
  return null
}

export function GraphSheet() {
  const mode = useUiModeStore((s) => s.mode)
  const graphDockOpen = useUiModeStore((s) => s.graphDockOpen)
  const setMode = useUiModeStore((s) => s.setMode)
  const toggleGraphDock = useUiModeStore((s) => s.toggleGraphDock)

  const pinned = mode === 'graph'
  const open = pinned || graphDockOpen
  if (!open) return null

  return (
    <div
      data-testid="graph-sheet"
      className="animate-panel-in absolute inset-x-0 bottom-0 z-30 bg-surface-raised/95 backdrop-blur-sm border-t border-white/10 shadow-2xl flex flex-col"
      style={{ height: '60%' }}
    >
      <div className="flex items-center justify-between px-3 py-1 border-b border-white/10 flex-shrink-0">
        <div className="text-micro uppercase tracking-wider text-white/40">Show graph</div>
        <IconButton
          aria-label="Close graph sheet"
          onClick={() => (pinned ? setMode('build') : toggleGraphDock())}
        >
          <X size={12} />
        </IconButton>
      </div>
      <div className="flex-1 min-h-0">
        <ErrorBoundary panelName="Graph Canvas">
          {/* Compact overlay: no fit-on-init (head-of-show viewport below)
              and no minimap (the TimelineDock is the show overview). */}
          <GraphCanvas fitViewOnInit={false} showMinimap={false} />
          <FitOnOpen />
        </ErrorBoundary>
      </div>
    </div>
  )
}
