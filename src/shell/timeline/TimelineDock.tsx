// ============================================================================
// TimelineDock — Phase 4 of the shell rebuild: the real timeline dock.
// Replaces the Phase-1 temporary (legacy TimelineRulerPanel + Transport-
// Controls) in AppShell's dock slot. Figma/AE-grade layout:
//   header  — transport (play/pause/stop/loop/time) left, audio + beat-snap
//             + speed right (ported from TransportControls + the legacy
//             ruler header)
//   body    — fixed 160px track-header column, then a scrollable lane area:
//             ruler (click-to-seek, shift/alt-click = loop out/in),
//             waveform + beat lanes, one row per deriveTracks() track with
//             draggable Clips and clickable TransitionSegments, a draggable
//             playhead, and drop-to-create for formation assets.
// Zoom: ctrl+wheel around the cursor via useTimelineViewport (shares
// viewStore.pxPerSecond with the graph canvas).
// ============================================================================

import { useCallback, useMemo, useRef } from 'react'
import {
  Play, Pause, Square, SkipBack, Repeat, Shuffle, ChevronFirst, ChevronLast, Music,
} from 'lucide-react'
import { useGraphStore } from '../../stores/graphStore'
import { useViewStore } from '../../stores/viewStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useAudioStore } from '../../stores/audioStore'
import { getTotalDuration } from '../../graph/timing'
import { deriveTracks } from '../../components/timeline/trackDerivation'
import { formatTime, getTickInterval, computeTicks } from '../../components/timeline/timelineMath'
import { WaveformLane, BeatMarkers, LoopRegion } from '../../components/viewport/WaveformLane'
import { wireNodeIntoFlow } from '../../graph/autoWire'
import { endFormationDrag } from '../../components/viewport/dragPreview'
import { toast } from '../../components/Toast'
import { Tooltip } from '../../components/Tooltip'
import type { FormationNodeData } from '../../graph/types'
import { Clip } from './Clip'
import { TransitionSegment } from './TransitionSegment'
import { useTimelineViewport } from './useTimelineViewport'

const RULER_HEIGHT = 22
const WAVEFORM_HEIGHT = 36
const LANES_TOP = RULER_HEIGHT + WAVEFORM_HEIGHT
const ROW_HEIGHT = 28
const CLIP_PAD = 3
const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 4]

export function TimelineDock() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const { pxPerSecond, scrollRef } = useTimelineViewport()
  const beatSnap = useViewStore((s) => s.beatSnap)
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const setCurrentTime = usePlayheadStore((s) => s.setCurrentTime)
  const setLoopRange = usePlayheadStore((s) => s.setLoopRange)
  const snapToNearestBeat = useAudioStore((s) => s.snapToNearestBeat)
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds)
  const setSelection = useSelectionStore((s) => s.setSelection)
  const contentRef = useRef<HTMLDivElement>(null)

  // Timing comes from the graph store's cache (recomputed when nodes/edges
  // change — the memo deps track exactly that invalidation).
  // (deps are nodes/edges even though the getter reads the store directly)
  const timing = useMemo(() => useGraphStore.getState().getCachedTiming(), [nodes, edges])
  const edgeTiming = useMemo(() => useGraphStore.getState().getCachedEdgeTiming(), [nodes, edges])
  const totalDuration = useMemo(() => Math.max(10, getTotalDuration({ nodes, edges })), [nodes, edges])
  const tracks = useMemo(() => deriveTracks({ nodes, edges }), [nodes, edges])
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const trackIndexByNode = useMemo(() => {
    const map = new Map<string, number>()
    tracks.forEach((t, i) => t.nodeIds.forEach((id) => map.set(id, i)))
    return map
  }, [tracks])

  const totalPx = Math.max((totalDuration + 2) * pxPerSecond, 800)
  const contentHeight = LANES_TOP + Math.max(1, tracks.length) * ROW_HEIGHT

  /** Resolve a node's [start, duration] from the timing cache, falling back
   *  to authored data.startTime/duration when timing can't place it. */
  const rangeOf = useCallback((nodeId: string): { start: number; duration: number } | null => {
    const node = nodeById.get(nodeId)
    if (!node) return null
    const range = timing.get(nodeId)
    if (range) return { start: range.start, duration: Math.max(0, range.end - range.start) }
    const data = node.data as { startTime?: number; duration?: number }
    if (data.startTime === undefined) return null
    return { start: data.startTime, duration: data.duration ?? 5 }
  }, [nodeById, timing])

  const timeFromClientX = useCallback((clientX: number): number => {
    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, (clientX - rect.left) / pxPerSecond)
  }, [pxPerSecond])

  // --- Click-to-seek + loop semantics (parity with the legacy ruler) ------
  const onLaneClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.role !== 'lane-bg') return
    let t = timeFromClientX(e.clientX)
    if (beatSnap) t = snapToNearestBeat(t)
    if (e.shiftKey) {
      setLoopRange(usePlayheadStore.getState().loopStart, t)
    } else if (e.altKey) {
      setLoopRange(t, Math.max(t + 0.1, usePlayheadStore.getState().loopEnd))
    } else {
      setCurrentTime(t)
    }
  }, [timeFromClientX, beatSnap, snapToNearestBeat, setLoopRange, setCurrentTime])

  // --- Playhead scrub -----------------------------------------------------
  const onPlayheadPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])
  const onPlayheadPointerMove = useCallback((e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    let t = timeFromClientX(e.clientX)
    if (beatSnap) t = snapToNearestBeat(t)
    setCurrentTime(t)
  }, [timeFromClientX, beatSnap, snapToNearestBeat, setCurrentTime])
  const onPlayheadPointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  // --- Drop-to-create (asset panel → timeline) ----------------------------
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/droneshow-formation')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])
  const onDrop = useCallback((e: React.DragEvent) => {
    const formationId = e.dataTransfer.getData('application/droneshow-formation')
    endFormationDrag()
    if (!formationId) return
    e.preventDefault()
    let t = timeFromClientX(e.clientX)
    if (beatSnap) t = snapToNearestBeat(t)
    t = Math.round(t * 10) / 10
    useHistoryStore.getState().snapshot('Add formation on timeline')
    const id = useGraphStore.getState().addNode('formation', { x: t * pxPerSecond, y: 0 }, {
      formationId,
      startTime: t,
      duration: 5,
      transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [],
      colorProgramId: null,
      idleConfigs: [],
    } as FormationNodeData)
    setSelection([id], [])
    const wired = wireNodeIntoFlow(id)
    toast.success(wired ? `Formation added at ${t.toFixed(1)}s and wired into the show` : `Formation added at ${t.toFixed(1)}s`)
  }, [timeFromClientX, beatSnap, snapToNearestBeat, pxPerSecond, setSelection])

  // --- Ruler ticks ----------------------------------------------------------
  const ticks = useMemo(() => {
    const interval = getTickInterval(pxPerSecond)
    return computeTicks(0, totalDuration + 2, interval)
  }, [pxPerSecond, totalDuration])

  const hasClips = tracks.length > 0

  return (
    <div className="h-full flex flex-col select-none text-white/80" data-testid="timeline-dock">
      <DockHeader totalDuration={totalDuration} />
      <div className="flex-1 min-h-0 flex overflow-y-auto overflow-x-hidden">
        {/* Fixed track-header column */}
        <div className="w-40 flex-shrink-0 border-r border-white/10 bg-surface-raised/60">
          <div style={{ height: LANES_TOP }} className="border-b border-white/5 px-2 flex items-end pb-1 text-[9px] text-white/25 uppercase tracking-wider">
            Tracks
          </div>
          {tracks.map((track, i) => (
            <div
              key={track.id}
              style={{ height: ROW_HEIGHT }}
              className="px-2 flex items-center justify-between border-b border-white/5 text-micro"
            >
              <span className={track.kind === 'unwired' ? 'text-amber-300/70' : 'text-white/60'}>
                {track.kind === 'unwired' ? 'Unwired' : `Track ${i + 1}`}
              </span>
              <span className="text-white/25 text-[9px]">{track.nodeIds.length}</span>
            </div>
          ))}
          {!hasClips && (
            <div style={{ height: ROW_HEIGHT }} className="px-2 flex items-center text-micro text-white/25">
              No tracks
            </div>
          )}
        </div>

        {/* Scrollable lane area */}
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
          <div
            ref={contentRef}
            className="relative"
            style={{ width: totalPx, height: contentHeight, minHeight: '100%' }}
            data-role="lane-bg"
            onClick={onLaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {/* Ruler lane */}
            <div
              data-testid="timeline-ruler"
              data-role="lane-bg"
              className="absolute top-0 left-0 right-0 border-b border-white/10"
              style={{ height: RULER_HEIGHT }}
            >
              {ticks.map((tick) => (
                <div
                  key={tick.time}
                  data-role="lane-bg"
                  className={`absolute top-0 text-[9px] pl-1 border-l ${
                    tick.isMajor ? 'h-full border-white/25 text-white/60' : 'h-3/5 border-white/10 text-white/30'
                  }`}
                  style={{ left: tick.time * pxPerSecond }}
                >
                  {tick.isMajor ? formatTime(tick.time) : ''}
                </div>
              ))}
            </div>

            {/* Waveform + beats + loop region */}
            <div className="absolute left-0 right-0 border-b border-white/5" style={{ top: RULER_HEIGHT, height: WAVEFORM_HEIGHT }}>
              <WaveformLane totalDuration={totalDuration + 2} totalPx={totalPx} />
            </div>
            <BeatMarkers pxPerSecond={pxPerSecond} totalDuration={totalDuration + 2} />
            <LoopRegion pxPerSecond={pxPerSecond} />

            {/* Track rows */}
            {tracks.map((track, i) => {
              const rowTop = LANES_TOP + i * ROW_HEIGHT
              return (
                <div
                  key={track.id}
                  data-testid="timeline-track"
                  data-role="lane-bg"
                  className={`absolute left-0 right-0 border-b border-white/5 ${i % 2 === 1 ? 'bg-white/[0.02]' : ''}`}
                  style={{ top: rowTop, height: ROW_HEIGHT }}
                >
                  {track.nodeIds.map((nodeId) => {
                    const node = nodeById.get(nodeId)
                    const range = rangeOf(nodeId)
                    if (!node || !range) return null
                    return (
                      <Clip
                        key={nodeId}
                        node={node}
                        start={range.start}
                        duration={range.duration}
                        pxPerSecond={pxPerSecond}
                        selected={selectedNodeIds.includes(nodeId)}
                        top={CLIP_PAD}
                        height={ROW_HEIGHT - CLIP_PAD * 2}
                      />
                    )
                  })}
                </div>
              )
            })}

            {/* Transition segments — flow edges whose endpoints share a row */}
            {edges.map((edge) => {
              if (edge.edgeType !== 'flow' || !edge.transition) return null
              const srcTrack = trackIndexByNode.get(edge.source)
              const tgtTrack = trackIndexByNode.get(edge.target)
              if (srcTrack === undefined || srcTrack !== tgtTrack) return null
              const er = edgeTiming.get(edge.id)
              let gapStart: number
              let gapEnd: number
              if (er) {
                gapStart = er.start
                gapEnd = Math.max(er.end, er.start)
              } else {
                const src = timing.get(edge.source)
                const tgt = timing.get(edge.target)
                if (!src || !tgt) return null
                gapStart = src.end
                gapEnd = Math.max(tgt.start, gapStart)
              }
              return (
                <TransitionSegment
                  key={`tr-${edge.id}`}
                  edge={edge}
                  gapStart={gapStart}
                  gapEnd={gapEnd}
                  pxPerSecond={pxPerSecond}
                  selected={selectedEdgeIds.includes(edge.id)}
                  centerY={LANES_TOP + srcTrack * ROW_HEIGHT + ROW_HEIGHT / 2}
                />
              )
            })}

            {/* Playhead — draggable, spans every lane */}
            <div
              data-testid="timeline-playhead"
              className="absolute top-0 bottom-0 z-10 cursor-ew-resize"
              style={{ left: currentTime * pxPerSecond - 4, width: 9 }}
              onPointerDown={onPlayheadPointerDown}
              onPointerMove={onPlayheadPointerMove}
              onPointerUp={onPlayheadPointerUp}
            >
              <div className="absolute top-0 bottom-0 w-px bg-accent-primary" style={{ left: 4 }} />
              <div className="absolute top-0 w-2 h-2 bg-accent-primary rotate-45" style={{ left: 0.5 }} />
            </div>

            {/* Empty state */}
            {!hasClips && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-xs text-white/30">Drag a formation here or onto the stage</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// DockHeader — transport controls (left) + audio / beat-snap / speed (right).
// Ported from TransportControls + the legacy TimelineRulerPanel header; all
// aria-labels preserved so existing muscle memory / tests keep working.
// ============================================================================

function DockHeader({ totalDuration }: { totalDuration: number }) {
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const isPlaying = usePlayheadStore((s) => s.isPlaying)
  const playbackSpeed = usePlayheadStore((s) => s.playbackSpeed)
  const loopEnabled = usePlayheadStore((s) => s.loopEnabled)
  const loopMode = usePlayheadStore((s) => s.loopMode)
  const loopStart = usePlayheadStore((s) => s.loopStart)
  const loopEnd = usePlayheadStore((s) => s.loopEnd)
  const setLoopMode = usePlayheadStore((s) => s.setLoopMode)
  const setLoopRange = usePlayheadStore((s) => s.setLoopRange)
  const setCurrentTime = usePlayheadStore((s) => s.setCurrentTime)
  const setPlaying = usePlayheadStore((s) => s.setPlaying)
  const setPlaybackSpeed = usePlayheadStore((s) => s.setPlaybackSpeed)
  const toggleLoop = usePlayheadStore((s) => s.toggleLoop)
  const beatSnap = useViewStore((s) => s.beatSnap)
  const toggleBeatSnap = useViewStore((s) => s.toggleBeatSnap)
  const loadAudio = useAudioStore((s) => s.loadAudio)
  const clearAudio = useAudioStore((s) => s.clearAudio)
  const audioName = useAudioStore((s) => s.audioFileName)

  const onAudioPick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await loadAudio(file)
  }, [loadAudio])

  return (
    <div className="flex items-center gap-1.5 px-2 h-9 flex-shrink-0 border-b border-white/10 bg-surface-raised/80">
      <Tooltip label="Skip to start" side="top">
        <button
          className="p-1 text-white/60 hover:text-white/90 transition-colors"
          onClick={() => setCurrentTime(0)}
          aria-label="Skip to start"
        >
          <SkipBack size={14} />
        </button>
      </Tooltip>
      <Tooltip label={isPlaying ? 'Pause' : 'Play'} shortcut="Space" side="top">
        <button
          className={`p-1.5 rounded ${
            isPlaying ? 'bg-cyan-600 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white/90'
          } transition-colors`}
          onClick={() => setPlaying(!isPlaying)}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </Tooltip>
      <Tooltip label="Stop" side="top">
        <button
          className="p-1 text-white/60 hover:text-white/90 transition-colors"
          onClick={() => { setPlaying(false); setCurrentTime(0) }}
          aria-label="Stop"
        >
          <Square size={12} />
        </button>
      </Tooltip>
      <Tooltip label={loopEnabled ? `Looping (${loopMode}) — click to disable` : 'Enable loop · shift+click ruler sets out, alt+click sets in'} side="top">
        <button
          className={`p-1 transition-colors ${loopEnabled ? 'text-amber-300' : 'text-white/40 hover:text-white/80'}`}
          onClick={toggleLoop}
          aria-label="Toggle loop"
        >
          <Repeat size={12} />
        </button>
      </Tooltip>
      {loopEnabled && (
        <Tooltip label={loopMode === 'loop' ? 'Loop mode: wrap (click for ping-pong)' : 'Loop mode: ping-pong (click for wrap)'} side="top">
          <button
            className="p-1 transition-colors text-amber-300/80 hover:text-amber-200"
            onClick={() => setLoopMode(loopMode === 'loop' ? 'ping-pong' : 'loop')}
            aria-label="Loop mode"
          >
            <Shuffle size={12} />
          </button>
        </Tooltip>
      )}
      <Tooltip label={`Mark loop in (now ${loopStart.toFixed(1)}s)`} side="top">
        <button
          className="p-1 transition-colors text-white/40 hover:text-amber-300"
          onClick={() => setLoopRange(currentTime, loopEnd)}
          aria-label="Mark loop in"
        >
          <ChevronFirst size={12} />
        </button>
      </Tooltip>
      <Tooltip label={`Mark loop out (now ${loopEnd.toFixed(1)}s)`} side="top">
        <button
          className="p-1 transition-colors text-white/40 hover:text-amber-300"
          onClick={() => setLoopRange(loopStart, currentTime)}
          aria-label="Mark loop out"
        >
          <ChevronLast size={12} />
        </button>
      </Tooltip>

      {/* Time readout */}
      <div className="flex items-center gap-1 text-xs font-mono text-white/70 ml-1">
        <span className="text-white/90">{formatTime(currentTime)}</span>
        <span className="text-white/30">/</span>
        <span className="text-white/40">{formatTime(totalDuration)}</span>
      </div>

      <div className="flex-1" />

      {/* Audio + beat snap + speed */}
      <div className="flex items-center gap-1 text-micro text-white/40">
        <Music size={11} />
        <label className="cursor-pointer hover:text-white/70 max-w-[140px] truncate">
          {audioName ?? 'Load audio'}
          <input type="file" accept="audio/*" onChange={onAudioPick} className="hidden" />
        </label>
        {audioName && (
          <button onClick={clearAudio} className="text-red-400 hover:text-red-300 px-1" aria-label="Clear audio">
            ✕
          </button>
        )}
      </div>
      <Tooltip label="Snap node times to beats" side="top">
        <button
          onClick={toggleBeatSnap}
          className={`px-1.5 py-0.5 rounded text-micro ${
            beatSnap ? 'bg-accent-transition/30 text-fuchsia-200' : 'text-white/40 hover:bg-white/5 hover:text-white/70'
          }`}
          aria-label="Toggle beat snap"
        >
          Beat Snap
        </button>
      </Tooltip>
      <div className="flex items-center gap-1">
        <span className="text-micro text-white/40">Speed:</span>
        <select
          value={playbackSpeed}
          onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
          className="bg-surface-hover border border-white/10 rounded px-1.5 py-0.5 text-micro text-white/70 outline-none"
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>
      </div>
    </div>
  )
}
