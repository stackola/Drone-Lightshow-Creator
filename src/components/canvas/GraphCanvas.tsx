// ============================================================================
// GraphCanvas — React Flow Wrapper (View Adapter)
// ============================================================================
// ARCHITECTURAL LAW: React Flow is a VIEW ADAPTER. It does not own graph state.
// 1. graphStore is the single source of truth for nodes and edges.
// 2. On every render, we derive React Flow nodes/edges from graphStore.
// 3. React Flow callbacks dispatch to graphStore actions — never the reverse.
// 4. We never read React Flow internal state to determine graph truth.
// ============================================================================

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  useReactFlow,
  applyNodeChanges,
  type Node as RFNode,
  type Edge as RFEdge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  type IsValidConnection,
  type NodeTypes,
  type EdgeTypes,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useViewStore } from '../../stores/viewStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import type { LaunchNodeData, FormationNodeData } from '../../graph/types'
import { isValidConnection as checkPortValid } from '../../graph/ports'

import { CanvasToolbar } from './CanvasToolbar'
import { EmptyState } from './EmptyState'
import { LaunchNode } from './nodes/LaunchNode'
import { FormationNode } from './nodes/FormationNode'
import { IdleNode } from './nodes/IdleNode'
import { LandNode } from './nodes/LandNode'
import { GroupNode } from './nodes/GroupNode'
import { FlowEdge } from './edges/FlowEdge'
import { AttachmentEdge } from './edges/AttachmentEdge'
import { ContextMenu } from './ContextMenu'
import { TimeRuler } from './overlays/TimeRuler'
import { Playhead } from './overlays/Playhead'
import { deriveRFNodes, deriveRFEdges } from './deriveRFElements'
import { NODE_TYPE_COLORS } from '../../ui/colors'

// --- Custom node types ---
const nodeTypes: NodeTypes = {
  launch: LaunchNode,
  formation: FormationNode,
  idle: IdleNode,
  land: LandNode,
  group: GroupNode,
}

// --- Custom edge types (Sprint 3) ---
const edgeTypes: EdgeTypes = {
  flow: FlowEdge,
  attachment: AttachmentEdge,
}

/**
 * @param fitViewOnInit React Flow's fit-on-init. The legacy dock wants it
 * (later-time nodes pulled into view); the shell's GraphSheet passes false
 * and sets its own head-of-show viewport — a full fit on a long show
 * bottoms out at minZoom and pushes the show's head off-screen.
 */
export function GraphCanvas({ fitViewOnInit = true, showMinimap = true }: { fitViewOnInit?: boolean; showMinimap?: boolean } = {}) {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const flowDiagnostics = useGraphStore((s) => s.flowDiagnostics)
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)
  const updateNodePosition = useGraphStore((s) => s.updateNodePosition)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const addEdge = useGraphStore((s) => s.addEdge)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const setSelection = useSelectionStore((s) => s.setSelection)
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const { screenToFlowPosition } = useReactFlow()

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null)

  // Editor-wide keyboard shortcuts live in LayoutShell (App.tsx) so Build
  // mode gets them too. Here we only close our context menu on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const getCachedTiming = useGraphStore((s) => s.getCachedTiming)
  const cachedTiming = useMemo(() => getCachedTiming(), [getCachedTiming, nodes, edges])
  const derivedRfNodes = useMemo(() => deriveRFNodes(nodes, pxPerSecond, edges, flowDiagnostics, currentTime, selectedNodeIds, cachedTiming), [nodes, pxPerSecond, edges, flowDiagnostics, currentTime, selectedNodeIds, cachedTiming])
  const [rfNodes, setRfNodes] = useState<RFNode[]>(derivedRfNodes)
  const isDraggingRef = useRef(false)

  // Sync derived nodes into local state when store changes (but not during drag)
  useEffect(() => {
    if (!isDraggingRef.current) {
      setRfNodes(derivedRfNodes)
    }
  }, [derivedRfNodes])

  const rfEdges = useMemo(() => deriveRFEdges(edges), [edges])

  // Handle node position changes from React Flow drag
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Track drag state
      for (const change of changes) {
        if (change.type === 'position') {
          if (change.dragging) {
            // First frame of a drag — snapshot history so the whole drag is
            // one Ctrl-Z entry. `isDraggingRef.current` is still false here
            // on the very first dragging-true change of a sequence.
            if (!isDraggingRef.current) {
              snapshot('Move Node')
            }
            isDraggingRef.current = true
          }
          if (change.dragging === false && change.position) {
            isDraggingRef.current = false
            // Sync derived nodes now that drag ended
            setRfNodes(derivedRfNodes)
            // Drag ended — commit to graphStore
            const node = nodes.find((n) => n.id === change.id)
            if (!node) continue

            updateNodePosition(change.id, {
              x: change.position.x,
              y: change.position.y,
            })

            // ARCHITECTURAL LAW: For timed nodes, derive startTime from canvas X
            if (node.type === 'launch' || node.type === 'formation' || node.type === 'idle') {
              const newStartTime = Math.max(0, change.position.x / pxPerSecond)
              updateNodeData(change.id, { startTime: newStartTime } as Partial<LaunchNodeData>)
            }

            // Auto-link: if a formation/launch is dropped near a downstream-compatible
            // timed node, connect them with a flow edge. The flow edge carries a
            // transition config by default (set in graphStore.addEdge), so no
            // separate node is created.
            if ((node.type === 'formation' || node.type === 'launch' || node.type === 'idle') && change.position) {
              const SNAP_DIST = 80 // pixels
              const hasOutEdge = edges.some((e) => e.source === change.id && e.edgeType === 'flow')
              if (!hasOutEdge) {
                for (const other of nodes) {
                  if (other.id === change.id) continue
                  if (other.type !== 'formation' && other.type !== 'land' && other.type !== 'idle') continue
                  const dx = other.position.x - change.position.x
                  const dy = Math.abs(other.position.y - change.position.y)
                  if (dx > 0 && dx < SNAP_DIST * 3 && dy < SNAP_DIST) {
                    const hasInEdge = edges.some((e) => e.target === other.id && e.edgeType === 'flow')
                    if (!hasInEdge) {
                      addEdge(change.id, 'flow-out', other.id, 'flow-in', 'flow')
                      break
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Apply all changes visually (including mid-drag position updates)
      setRfNodes((nds) => applyNodeChanges(changes, nds))
    },
    [nodes, pxPerSecond, updateNodePosition, updateNodeData, derivedRfNodes, snapshot],
  )

  // We don't let React Flow mutate edges directly
  const onEdgesChange: OnEdgesChange = useCallback(() => {
    // Edge changes go through graphStore, not React Flow
  }, [])

  // S3-03: Wire dragging + connection validation
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      const sourcePort = connection.sourceHandle ?? 'flow-out'
      const targetPort = connection.targetHandle ?? 'flow-in'
      // Determine edge type from port names
      const edgeType = sourcePort.includes('attach') || targetPort.includes('attach') ? 'attachment' : 'flow'
      addEdge(
        connection.source,
        sourcePort,
        connection.target,
        targetPort,
        edgeType,
      )
    },
    [addEdge],
  )

  // Real-time connection validation during drag
  const isValidConnectionCheck: IsValidConnection = useCallback(
    (connection: Connection | RFEdge) => {
      if (!connection.source || !connection.target) return false
      const sourcePort = connection.sourceHandle ?? 'flow-out'
      const targetPort = connection.targetHandle ?? 'flow-in'
      const graph = { nodes, edges }
      return checkPortValid(graph, connection.source, sourcePort, connection.target, targetPort).valid
    },
    [nodes, edges],
  )

  const selectNode = useSelectionStore((s) => s.selectNode)
  const selectEdge = useSelectionStore((s) => s.selectEdge)

  // Selection — shift/ctrl click for multi-select
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: RFNode) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        selectNode(node.id, true)
      } else {
        setSelection([node.id], [])
      }
    },
    [setSelection, selectNode],
  )

  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: RFEdge) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        selectEdge(edge.id, true)
      } else {
        setSelection([], [edge.id])
      }
    },
    [setSelection],
  )

  const onPaneClick = useCallback(() => {
    setSelection([], [])
    setContextMenu(null)
  }, [setSelection])

  // S17-03: Drag-and-drop from asset library
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    const formationId = e.dataTransfer.getData('application/droneshow-formation')
    if (!formationId) return
    e.preventDefault()
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const startTime = Math.max(0, position.x / pxPerSecond)
    useGraphStore.getState().addNode('formation', position, {
      formationId,
      startTime,
      duration: 5,
      transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [],
      colorProgramId: null,
      idleConfigs: [],
    } as FormationNodeData)
  }, [screenToFlowPosition, pxPerSecond])

  // S4-01: Context menu
  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault()
      const flowPos = screenToFlowPosition({ x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY })
      setContextMenu({
        x: (event as MouseEvent).clientX,
        y: (event as MouseEvent).clientY,
        canvasX: flowPos.x,
        canvasY: flowPos.y,
      })
    },
    [screenToFlowPosition],
  )

  return (
    <div className="w-full h-full relative" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnectionCheck}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(_e, node) => useSelectionStore.getState().setHoveredNode(node.id)}
        onNodeMouseLeave={() => useSelectionStore.getState().setHoveredNode(null)}
        onEdgeClick={onEdgeClick}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={fitViewOnInit}
        snapToGrid
        snapGrid={[10, 10]}
        defaultEdgeOptions={{ type: 'flow' }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        selectNodesOnDrag={false}
        // A-09 — marquee selection on shift-drag over empty canvas. React Flow
        // requires `selectionOnDrag` + a panning key so left-drag is reserved
        // for the rubber band. Shift held → marquee; bare drag → pan.
        selectionOnDrag={false}
        panOnDrag
        selectionKeyCode={'Shift'}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#334155" />
        {showMinimap && <MiniMap
          className="!bg-surface-raised/80 !border !border-white/15 backdrop-blur-sm"
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(n) => {
            switch (n.type) {
              case 'launch': return NODE_TYPE_COLORS.launch!
              case 'formation': return NODE_TYPE_COLORS.formation!
              case 'transition': return NODE_TYPE_COLORS.transition!
              case 'idle': return '#fbbf24'
              case 'land': return NODE_TYPE_COLORS.land!
              case 'group': return '#94a3b8'
              default: return '#64748b'
            }
          }}
          nodeStrokeColor="#0f172a"
          nodeStrokeWidth={1.5}
          maskColor="rgba(15, 23, 42, 0.65)"
        />}
        <Controls position="bottom-left" className="!bg-surface-hover !border-white/10 [&>button]:!bg-surface-active [&>button]:!border-white/10 [&>button]:!text-white/70" />
        <TimeRuler />
        <Playhead />
      </ReactFlow>
      <CanvasToolbar />
      {rfNodes.length === 0 && <EmptyState />}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canvasX={contextMenu.canvasX}
          canvasY={contextMenu.canvasY}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
