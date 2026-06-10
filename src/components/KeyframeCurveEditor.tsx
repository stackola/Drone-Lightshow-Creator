// ============================================================================
// S19: Keyframe Curve Editor — Visual curve editing with Bezier handles
// S19-01: Timeline strip, S19-02: Curve editor, S19-03: Multi-property
// S19-04: Bezier handles, S19-05: Selection, S19-06: Copy/paste
// S19-07: Snapping, S19-08: Value readout, S19-09: Presets
// ============================================================================

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useGraphStore } from '../stores/graphStore'
import { useHistoryStore } from '../stores/historyStore'
import { usePlayheadStore } from '../stores/playheadStore'
import type { FormationNodeData, TransformKeyframe } from '../graph/types'
import { applyEasing, type EasingType, type CubicBezierConfig, DEFAULT_BEZIER } from '../graph/easing'
import { EasingSelect } from './inspectors/EasingSelect'
import { ACCENT_PRIMARY, ACCENT_PRIMARY_DEEP, ACCENT_HIGHLIGHT, AXIS_LANE_COLORS } from '../ui/colors'

// S4 step 7 — module-level keyframe clipboard. Lives outside React so a
// user can copy from one KeyframeCurveEditor and paste into another
// formation's editor. The minTime is captured at copy-time so paste can
// reposition the cluster relative to the paste target.
let keyframeClipboard: { keyframes: TransformKeyframe[]; minTime: number } | null = null

interface KeyframeCurveEditorProps {
  nodeId: string
}

type CurveProperty = 'pos-x' | 'pos-y' | 'pos-z' | 'rot-x' | 'rot-y' | 'rot-z' | 'scale-x' | 'scale-y' | 'scale-z'

const PROPERTIES: { id: CurveProperty; label: string; color: string }[] = [
  { id: 'pos-x', label: 'Pos X', color: AXIS_LANE_COLORS['pos-x'] },
  { id: 'pos-y', label: 'Pos Y', color: AXIS_LANE_COLORS['pos-y'] },
  { id: 'pos-z', label: 'Pos Z', color: AXIS_LANE_COLORS['pos-z'] },
  { id: 'rot-x', label: 'Rot X', color: AXIS_LANE_COLORS['rot-x'] },
  { id: 'rot-y', label: 'Rot Y', color: AXIS_LANE_COLORS['rot-y'] },
  { id: 'rot-z', label: 'Rot Z', color: AXIS_LANE_COLORS['rot-z'] },
  { id: 'scale-x', label: 'Scale X', color: AXIS_LANE_COLORS['scale-x'] },
  { id: 'scale-y', label: 'Scale Y', color: AXIS_LANE_COLORS['scale-y'] },
  { id: 'scale-z', label: 'Scale Z', color: AXIS_LANE_COLORS['scale-z'] },
]

function getKeyframeValue(kf: TransformKeyframe, prop: CurveProperty): number {
  switch (prop) {
    case 'pos-x': return kf.transform.position.x
    case 'pos-y': return kf.transform.position.y
    case 'pos-z': return kf.transform.position.z
    case 'rot-x': return kf.transform.rotation.x * 180 / Math.PI
    case 'rot-y': return kf.transform.rotation.y * 180 / Math.PI
    case 'rot-z': return kf.transform.rotation.z * 180 / Math.PI
    case 'scale-x': return kf.transform.scale.x
    case 'scale-y': return kf.transform.scale.y
    case 'scale-z': return kf.transform.scale.z
  }
}

/** Reverse of `getKeyframeValue` — returns a transform patch that sets the
 *  given property to `value` without disturbing the others. Rotations are
 *  input as degrees and stored as radians. S4 step 3 (2026-05-21). */
function patchForValue(
  prop: CurveProperty,
  base: TransformKeyframe['transform'],
  value: number,
): TransformKeyframe['transform'] {
  const t = {
    position: { ...base.position },
    rotation: { ...base.rotation },
    scale: { ...base.scale },
  }
  const radians = value * Math.PI / 180
  switch (prop) {
    case 'pos-x': t.position.x = value; break
    case 'pos-y': t.position.y = value; break
    case 'pos-z': t.position.z = value; break
    case 'rot-x': t.rotation.x = radians; break
    case 'rot-y': t.rotation.y = radians; break
    case 'rot-z': t.rotation.z = radians; break
    case 'scale-x': t.scale.x = Math.max(0.01, value); break
    case 'scale-y': t.scale.y = Math.max(0.01, value); break
    case 'scale-z': t.scale.z = Math.max(0.01, value); break
  }
  return t
}

export function KeyframeCurveEditor({ nodeId }: KeyframeCurveEditorProps) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateKeyframe = useGraphStore((s) => s.updateKeyframe)
  const addKeyframe = useGraphStore((s) => s.addKeyframe)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const playheadGlobal = usePlayheadStore((s) => s.currentTime)
  const svgRef = useRef<SVGSVGElement>(null)
  const [visibleProps, setVisibleProps] = useState<Set<CurveProperty>>(new Set(['pos-x', 'pos-y', 'pos-z']))
  // S19-05: Selection state (replaces hoveredKf)
  const [selectedKf, setSelectedKf] = useState<Set<number>>(new Set())
  const [hoveredKf, setHoveredKf] = useState<number | null>(null)
  const dragRef = useRef<{ idx: number; startTime: number; startX: number; moved: boolean } | null>(null)
  // S4 step 12 — bezier handle drag state. `which` says which control point
  // we're dragging (p1 controls the outgoing tangent from kf0; p2 the
  // incoming tangent to kf1). `startConfig` is captured at drag-start so the
  // entire drag composes one undo entry.
  const bezDragRef = useRef<{ kfIdx: number; which: 'p1' | 'p2'; startConfig: CubicBezierConfig } | null>(null)

  if (!node || node.type !== 'formation') return null
  const data = node.data as FormationNodeData
  const { keyframes, duration } = data
  const playheadLocal = playheadGlobal - data.startTime

  const w = 300, h = 150, pad = 20

  // S4 step 9 — per-property value axis. Each visible curve normalizes to
  // ITS OWN min/max so e.g. "Pos Y" (0..10) and "Rot Y" (0..360) both fill
  // the vertical extent instead of one flattening the other.
  const ranges = useMemo(() => {
    const baseKf: TransformKeyframe = { time: 0, transform: data.transform, easing: 'linear' }
    const allKfs = [baseKf, ...keyframes]
    const m = new Map<CurveProperty, { min: number; max: number }>()
    for (const prop of visibleProps) {
      let min = Infinity, max = -Infinity
      for (const kf of allKfs) {
        const v = getKeyframeValue(kf, prop)
        if (v < min) min = v
        if (v > max) max = v
      }
      if (min === max) { min -= 1; max += 1 }
      m.set(prop, { min, max })
    }
    return m
  }, [keyframes, data.transform, visibleProps])

  const toX = (time: number): number => pad + (time / Math.max(0.1, duration)) * (w - 2 * pad)
  const toYFor = (value: number, prop: CurveProperty): number => {
    const r = ranges.get(prop) ?? { min: 0, max: 1 }
    return h - pad - ((value - r.min) / (r.max - r.min)) * (h - 2 * pad)
  }

  // Build SVG paths for each visible property
  const paths = useMemo(() => {
    const result: { prop: CurveProperty; d: string; color: string }[] = []
    const baseKf: TransformKeyframe = { time: 0, transform: data.transform, easing: 'linear' }
    const allKfs = [baseKf, ...keyframes]

    for (const prop of visibleProps) {
      const propDef = PROPERTIES.find((p) => p.id === prop)
      if (!propDef) continue
      const steps = 60
      const points: string[] = []
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * duration
        // Find surrounding keyframes and interpolate
        let kfIdx = 0
        while (kfIdx < allKfs.length - 1 && allKfs[kfIdx + 1]!.time <= t) kfIdx++
        const kf0 = allKfs[kfIdx]!
        const kf1 = allKfs[kfIdx + 1] ?? kf0
        const localT = kf1.time > kf0.time ? (t - kf0.time) / (kf1.time - kf0.time) : 0
        // S4 step 12: thread `bezierConfig` through so a keyframe with
        // easing='cubic-bezier' renders the actual configured curve, not the
        // default. The renderer was previously stripping this info.
        const eased = applyEasing(localT, kf1.easing, undefined, kf1.bezierConfig)
        const v0 = getKeyframeValue(kf0, prop)
        const v1 = getKeyframeValue(kf1, prop)
        const value = v0 + (v1 - v0) * eased
        const x = toX(t).toFixed(1)
        const y = toYFor(value, prop).toFixed(1)
        points.push(`${i === 0 ? 'M' : 'L'}${x},${y}`)
      }
      result.push({ prop, d: points.join(' '), color: propDef.color })
    }
    return result
  }, [keyframes, data.transform, duration, visibleProps, ranges])

  const toggleProp = useCallback((prop: CurveProperty) => {
    setVisibleProps((prev) => {
      const next = new Set(prev)
      if (next.has(prop)) next.delete(prop)
      else next.add(prop)
      return next
    })
  }, [])

  // S19-05: Click handler for keyframe selection
  const handleKfClick = useCallback((idx: number, e: React.MouseEvent) => {
    // If a drag actually moved the keyframe, swallow the click (don't toggle selection).
    if (dragRef.current?.moved) return
    if (e.shiftKey) {
      setSelectedKf((prev) => {
        const next = new Set(prev)
        if (next.has(idx)) next.delete(idx)
        else next.add(idx)
        return next
      })
    } else {
      setSelectedKf(new Set([idx]))
    }
  }, [])

  // S4 step 1 + step 3 — drag a keyframe diamond. Horizontal motion changes
  // `time`. When exactly ONE property is visible, vertical motion also
  // changes that property's value (mapped to the current axis range). With
  // multiple properties visible, vertical motion is ignored (ambiguous).
  // Hold Shift while dragging horizontally → snap to the playhead (when it
  // sits inside this formation's local time window).
  // Snapshot is fired once on drag-start so the entire drag is one undo.
  const beginDrag = useCallback((idx: number, e: React.PointerEvent<SVGGElement>) => {
    if (!keyframes[idx]) return
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    const kf = keyframes[idx]!
    const startTime = kf.time
    const startY = e.clientY
    const visible = Array.from(visibleProps)
    const soloProp: CurveProperty | null = visible.length === 1 ? visible[0]! : null
    const startValue = soloProp ? getKeyframeValue(kf, soloProp) : 0
    const playheadLocal = usePlayheadStore.getState().currentTime - data.startTime
    dragRef.current = { idx, startTime, startX: e.clientX, moved: false }
    snapshot(soloProp ? 'Edit Keyframe Value' : 'Move Keyframe')

    const onMove = (ev: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const rect = svg.getBoundingClientRect()
      // S4 step 10 — work in viewBox units consistently. The SVG renders
      // with `w-full` (variable physical width) but the math uses pad=20
      // and usableW = w - 2*pad from the viewBox space.
      const vbScaleX = w / Math.max(1, rect.width)
      const vbScaleY = h / Math.max(1, rect.height)
      const px = (ev.clientX - rect.left) * vbScaleX
      const usableW = w - 2 * pad
      const t = ((px - pad) / Math.max(1, usableW)) * duration
      let clampedT = Math.max(0, Math.min(duration, t))
      if (ev.shiftKey && playheadLocal >= 0 && playheadLocal <= duration) {
        const snapTolerance = Math.max(0.05, duration * 0.03)
        if (Math.abs(clampedT - playheadLocal) <= snapTolerance) {
          clampedT = playheadLocal
        }
      }
      if (Math.abs(ev.clientX - drag.startX) > 2 || Math.abs(ev.clientY - startY) > 2) {
        drag.moved = true
      }

      const patch: Partial<TransformKeyframe> = { time: +clampedT.toFixed(2) }

      // Vertical → value (single-property mode). Convert dy to viewBox units
      // first so the drag feels 1:1 regardless of the rendered SVG height.
      if (soloProp) {
        const range = ranges.get(soloProp) ?? { min: 0, max: 1 }
        const usableH = h - 2 * pad
        const dyVb = (ev.clientY - startY) * vbScaleY
        const dyValue = -(dyVb / Math.max(1, usableH)) * (range.max - range.min)
        const next = startValue + dyValue
        const t2 = patchForValue(soloProp, kf.transform, next)
        Object.assign(patch, { transform: t2 })
      }

      updateKeyframe(nodeId, drag.idx, patch)
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [keyframes, duration, nodeId, snapshot, updateKeyframe, visibleProps, ranges, data.startTime])

  // S4 step 2 — double-click empty curve area to add a keyframe there. We
  // sample the surrounding curve to pick a sensible default transform —
  // matches the interpolated value at that t, so the curve doesn't visually
  // jump when the new keyframe is inserted.
  const handleSvgDoubleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    // S4 step 10 — viewBox-unit math (rect.width is screen px).
    const px = ((e.clientX - rect.left) / Math.max(1, rect.width)) * w
    const usableW = w - 2 * pad
    if (px < pad || px > pad + usableW) return
    const t = ((px - pad) / usableW) * duration
    if (t <= 0 || t >= duration) return
    addKeyframe(nodeId, +t.toFixed(2), data.transform, 'ease-in-out')
  }, [duration, nodeId, addKeyframe, data.transform])

  // S4 step 4 — keyboard Delete / Backspace removes selected keyframes.
  // Hover the curve area then press Delete; clears selection after.
  const removeKeyframe = useGraphStore((s) => s.removeKeyframe)
  const [hoverFocus, setHoverFocus] = useState(false)

  // S4 step 6 — marquee selection. Pointer-down on empty curve area begins a
  // rectangle; release selects all keyframes whose diamond x sits inside the
  // x-range of the box. (Diamonds are on a fixed y so a 1-D check would
  // suffice, but we use the rectangle to feel right.)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const beginMarquee = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    // Only react to primary-button drags on the SVG itself (not on a child
    // <g> for a keyframe diamond — those stop propagation in beginDrag).
    if (e.button !== 0) return
    if ((e.target as Element).tagName !== 'svg') return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    // S4 step 10 — marquee coords live in viewBox space so the rendered
    // rectangle and the hit-test against keyframe diamond positions both
    // agree, regardless of the SVG's physical width.
    const sx = w / Math.max(1, rect.width)
    const sy = h / Math.max(1, rect.height)
    const startX = (e.clientX - rect.left) * sx
    const startY = (e.clientY - rect.top) * sy
    setMarquee({ x0: startX, y0: startY, x1: startX, y1: startY })
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      const r = svg.getBoundingClientRect()
      const sx2 = w / Math.max(1, r.width)
      const sy2 = h / Math.max(1, r.height)
      const x = Math.max(0, Math.min(w, (ev.clientX - r.left) * sx2))
      const y = Math.max(0, Math.min(h, (ev.clientY - r.top) * sy2))
      if (Math.abs(x - startX) > 2 || Math.abs(y - startY) > 2) moved = true
      setMarquee({ x0: startX, y0: startY, x1: x, y1: y })
    }
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!moved) {
        // Click on empty SVG, not a drag — clear selection.
        setMarquee(null)
        setSelectedKf(new Set())
        return
      }
      const r = svg.getBoundingClientRect()
      const sx2 = w / Math.max(1, r.width)
      const endX = Math.max(0, Math.min(w, (ev.clientX - r.left) * sx2))
      const minX = Math.min(startX, endX)
      const maxX = Math.max(startX, endX)
      // Selection = every keyframe whose diamond falls inside [minX, maxX]
      // in viewBox space. toX() already returns viewBox units. Shift = additive.
      const inBox = new Set<number>()
      keyframes.forEach((kf, idx) => {
        const x = toX(kf.time)
        if (x >= minX && x <= maxX) inBox.add(idx)
      })
      setSelectedKf((prev) => {
        if (ev.shiftKey) {
          const next = new Set(prev)
          for (const idx of inBox) next.add(idx)
          return next
        }
        return inBox
      })
      setMarquee(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [keyframes, toX])
  useEffect(() => {
    if (!hoverFocus) return
    const onKey = (e: KeyboardEvent): void => {
      // Don't capture when the user is typing in an input field.
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return

      // S4 step 4 — Delete / Backspace removes selected keyframes.
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKf.size > 0) {
        e.preventDefault()
        snapshot(`Delete ${selectedKf.size} keyframe${selectedKf.size === 1 ? '' : 's'}`)
        const sorted = [...selectedKf].sort((a, b) => b - a)
        for (const idx of sorted) removeKeyframe(nodeId, idx)
        setSelectedKf(new Set())
        return
      }

      const mod = e.ctrlKey || e.metaKey

      // S4 step 7a — Ctrl/Cmd+A selects every keyframe in this editor.
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        if (keyframes.length === 0) return
        setSelectedKf(new Set(keyframes.map((_, idx) => idx)))
        return
      }

      // S4 step 7b — Ctrl/Cmd+C copies selected keyframes to the module clipboard.
      if (mod && (e.key === 'c' || e.key === 'C')) {
        if (selectedKf.size === 0) return
        e.preventDefault()
        const picked = [...selectedKf].sort((a, b) => a - b)
          .map((idx) => keyframes[idx])
          .filter((kf): kf is TransformKeyframe => !!kf)
        if (picked.length === 0) return
        const minTime = Math.min(...picked.map((k) => k.time))
        keyframeClipboard = {
          keyframes: picked.map((k) => ({ time: k.time, easing: k.easing, transform: k.transform })),
          minTime,
        }
        return
      }

      // S4 step 7c — Ctrl/Cmd+V pastes clipboard at the playhead (when it's
      // inside this formation's window) or appended after the rightmost
      // existing keyframe otherwise. The cluster keeps its internal spacing.
      if (mod && (e.key === 'v' || e.key === 'V')) {
        if (!keyframeClipboard || keyframeClipboard.keyframes.length === 0) return
        e.preventDefault()
        const phLocal = playheadGlobal - data.startTime
        const insideWindow = phLocal >= 0 && phLocal <= duration
        const fallback = keyframes.length > 0
          ? Math.min(duration - 0.01, Math.max(...keyframes.map((k) => k.time)) + 0.1)
          : 0
        const anchor = insideWindow ? phLocal : fallback
        const offset = anchor - keyframeClipboard.minTime
        snapshot(`Paste ${keyframeClipboard.keyframes.length} keyframe${keyframeClipboard.keyframes.length === 1 ? '' : 's'}`)
        for (const k of keyframeClipboard.keyframes) {
          const t = Math.max(0, Math.min(duration, +(k.time + offset).toFixed(2)))
          addKeyframe(nodeId, t, k.transform, k.easing)
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hoverFocus, selectedKf, keyframes, duration, nodeId, removeKeyframe, addKeyframe, snapshot, playheadGlobal, data.startTime])

  // S4 step 8 — apply easing. Scoped to selection when one exists, else
  // applied to every keyframe in this formation. The popover exposes the
  // full 31-easing palette (was 3 before).
  const applyEasingTo = useCallback((easing: EasingType) => {
    const targets = selectedKf.size > 0
      ? [...selectedKf]
      : keyframes.map((_, idx) => idx)
    if (targets.length === 0) return
    snapshot(`Set easing on ${targets.length} keyframe${targets.length === 1 ? '' : 's'}`)
    for (const idx of targets) {
      updateKeyframe(nodeId, idx, { easing })
    }
  }, [nodeId, keyframes, selectedKf, snapshot, updateKeyframe])

  // S4 step 12 — bezier handle positions for cubic-bezier keyframes. For each
  // keyframe `kf` with easing='cubic-bezier', the curve segment from the
  // previous keyframe `kf0` to `kf` is shaped by `kf.bezierConfig`. The
  // control points P1=(x1,y1) and P2=(x2,y2) live in normalized [0,1]² for
  // the easing, but we map them into the segment's actual screen-space
  // coordinates for visualization. Only renders for the first visible
  // property — the handles ARE the bezierConfig (per-keyframe, not
  // per-property), so we just need one anchor curve to display them on.
  const bezierHandles = useMemo(() => {
    const baseKf: TransformKeyframe = { time: 0, transform: data.transform, easing: 'linear' }
    const allKfs = [baseKf, ...keyframes]
    const firstProp = Array.from(visibleProps)[0]
    if (!firstProp) return []
    const out: Array<{ kfIdx: number; kf0X: number; kf0Y: number; kf1X: number; kf1Y: number; p1X: number; p1Y: number; p2X: number; p2Y: number; config: CubicBezierConfig }> = []
    for (let i = 1; i < allKfs.length; i++) {
      const kf = allKfs[i]!
      if (kf.easing !== 'cubic-bezier') continue
      const kf0 = allKfs[i - 1]!
      const cfg = kf.bezierConfig ?? DEFAULT_BEZIER
      const dt = kf.time - kf0.time
      const v0 = getKeyframeValue(kf0, firstProp)
      const v1 = getKeyframeValue(kf, firstProp)
      const dv = v1 - v0
      out.push({
        kfIdx: i - 1, // index in `keyframes` (not allKfs): the kf in question is `keyframes[kfIdx]`
        kf0X: toX(kf0.time),
        kf0Y: toYFor(v0, firstProp),
        kf1X: toX(kf.time),
        kf1Y: toYFor(v1, firstProp),
        p1X: toX(kf0.time + cfg.x1 * dt),
        p1Y: toYFor(v0 + cfg.y1 * dv, firstProp),
        p2X: toX(kf0.time + cfg.x2 * dt),
        p2Y: toYFor(v0 + cfg.y2 * dv, firstProp),
        config: cfg,
      })
    }
    return out
  }, [keyframes, data.transform, visibleProps, ranges, duration])

  // S4 step 12 — drag a bezier control point. The screen position maps back
  // to normalized [0,1]² (x clamped to keep the curve monotonic; y free, so
  // overshoot eases are reachable). Snapshot fires once on drag-start.
  const beginBezierDrag = useCallback((kfIdx: number, which: 'p1' | 'p2', e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation()
    const kf = keyframes[kfIdx]
    if (!kf) return
    const svg = svgRef.current
    if (!svg) return
    const allKfs = [{ time: 0, transform: data.transform, easing: 'linear' as const }, ...keyframes]
    const kf0 = allKfs[kfIdx]!
    const dt = kf.time - kf0.time
    if (dt <= 0) return
    const firstProp = Array.from(visibleProps)[0]
    if (!firstProp) return
    const v0 = getKeyframeValue(kf0, firstProp)
    const v1 = getKeyframeValue(kf, firstProp)
    const dv = v1 - v0
    if (dv === 0) return
    const startConfig = kf.bezierConfig ?? DEFAULT_BEZIER
    bezDragRef.current = { kfIdx, which, startConfig }
    snapshot(`Set keyframe Bézier handle ${which}`)
    const onMove = (ev: PointerEvent): void => {
      const drag = bezDragRef.current
      if (!drag) return
      const rect = svg.getBoundingClientRect()
      const vbScaleX = w / Math.max(1, rect.width)
      const vbScaleY = h / Math.max(1, rect.height)
      const pxView = (ev.clientX - rect.left) * vbScaleX
      const pyView = (ev.clientY - rect.top) * vbScaleY
      // Invert toX / toYFor:
      //   pxView = pad + (t / duration) * (w - 2*pad)
      //   → tForX  = (pxView - pad) / (w - 2*pad) * duration
      //   → nx     = (tForX - kf0.time) / dt
      const tForX = ((pxView - pad) / Math.max(1, w - 2 * pad)) * Math.max(0.0001, duration)
      let nx = (tForX - kf0.time) / dt
      // x is clamped to [0, 1] — required by cubic-bezier monotonicity.
      nx = Math.max(0, Math.min(1, nx))
      //   pyView = h - pad - ((v - r.min) / (r.max - r.min)) * (h - 2*pad)
      //   → vForY = r.min + ((h - pad - pyView) / (h - 2*pad)) * (r.max - r.min)
      const r = ranges.get(firstProp) ?? { min: 0, max: 1 }
      const vForY = r.min + ((h - pad - pyView) / Math.max(1, h - 2 * pad)) * (r.max - r.min)
      const ny = (vForY - v0) / dv
      // y is intentionally NOT clamped — anticipation/overshoot easings need
      // y outside [0,1].
      const patch: CubicBezierConfig = drag.which === 'p1'
        ? { ...drag.startConfig, x1: +nx.toFixed(4), y1: +ny.toFixed(4) }
        : { ...drag.startConfig, x2: +nx.toFixed(4), y2: +ny.toFixed(4) }
      updateKeyframe(nodeId, drag.kfIdx, { bezierConfig: patch })
    }
    const onUp = (): void => {
      bezDragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [keyframes, data.transform, visibleProps, ranges, duration, nodeId, snapshot, updateKeyframe])

  // S4: snap each selected keyframe's time to the playhead. Useful for
  // pinning a series of edits to specific musical beats — much faster than
  // shift-dragging each diamond individually.
  const snapSelectedToPlayhead = useCallback(() => {
    if (selectedKf.size === 0) return
    const localT = usePlayheadStore.getState().currentTime - data.startTime
    if (localT < 0 || localT > duration) return
    snapshot(`Snap ${selectedKf.size} keyframe${selectedKf.size === 1 ? '' : 's'} to playhead`)
    for (const idx of selectedKf) {
      updateKeyframe(nodeId, idx, { time: localT })
    }
  }, [nodeId, selectedKf, duration, data.startTime, snapshot, updateKeyframe])

  return (
    <div className="border border-white/10 rounded bg-surface-raised/50">
      {/* Property toggles */}
      <div className="flex flex-wrap gap-1 p-1 border-b border-white/10">
        {PROPERTIES.map((p) => (
          <button key={p.id} onClick={() => toggleProp(p.id)}
            className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
              visibleProps.has(p.id) ? 'text-white' : 'text-white/20'
            }`} style={{ backgroundColor: visibleProps.has(p.id) ? p.color + '30' : 'transparent' }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* SVG curve view */}
      <svg
        ref={svgRef}
        width={w}
        height={h}
        className="w-full"
        viewBox={`0 0 ${w} ${h}`}
        onDoubleClick={handleSvgDoubleClick}
        onPointerDown={beginMarquee}
        onMouseEnter={() => setHoverFocus(true)}
        onMouseLeave={() => setHoverFocus(false)}
        tabIndex={0}
      >
        {/* Grid */}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="white" strokeOpacity={0.1} />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="white" strokeOpacity={0.1} />

        {/* S4 — playhead overlay (visible only when playhead sits inside this formation's window) */}
        {playheadLocal >= 0 && playheadLocal <= duration && (
          <line
            x1={toX(playheadLocal)}
            y1={pad}
            x2={toX(playheadLocal)}
            y2={h - pad}
            stroke={ACCENT_HIGHLIGHT}
            strokeOpacity={0.4}
            strokeWidth={1}
            strokeDasharray="2 2"
            pointerEvents="none"
          />
        )}

        {/* Curves */}
        {paths.map((p) => (
          <path key={p.prop} d={p.d} fill="none" stroke={p.color} strokeWidth={1.5} strokeLinecap="round" />
        ))}

        {/* S4 step 11 — per-curve range labels. Each visible prop gets a
            tiny "Label: min..max" row in the top-left, tinted by its colour.
            Helps disambiguate when a Pos Y curve and a Rot Y curve share
            the canvas at very different scales (S4 step 9 set them up to). */}
        {paths.map((p, i) => {
          const propDef = PROPERTIES.find((q) => q.id === p.prop)
          const r = ranges.get(p.prop)
          if (!propDef || !r) return null
          const fmt = (v: number): string => {
            const abs = Math.abs(v)
            if (abs >= 100) return v.toFixed(0)
            if (abs >= 10) return v.toFixed(1)
            return v.toFixed(2)
          }
          return (
            <text
              key={`label-${p.prop}`}
              x={pad + 2}
              y={pad + 8 + i * 9}
              fill={propDef.color}
              fillOpacity={0.7}
              fontSize={8}
              pointerEvents="none"
            >
              {propDef.label}: {fmt(r.min)}..{fmt(r.max)}
            </text>
          )
        })}

        {/* S4 step 12 — Bézier tangent handles. One pair per cubic-bezier
            keyframe; drag a handle to reshape the segment ending at that
            keyframe. Anchored to the first visible property's curve. */}
        {bezierHandles.map((bh) => (
          <g key={`bz-${bh.kfIdx}`}>
            <line x1={bh.kf0X} y1={bh.kf0Y} x2={bh.p1X} y2={bh.p1Y} stroke={ACCENT_PRIMARY} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 2" />
            <line x1={bh.kf1X} y1={bh.kf1Y} x2={bh.p2X} y2={bh.p2Y} stroke={ACCENT_PRIMARY} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 2" />
            <circle
              cx={bh.p1X} cy={bh.p1Y} r={4}
              fill={ACCENT_PRIMARY} stroke={ACCENT_PRIMARY_DEEP} strokeWidth={1}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => beginBezierDrag(bh.kfIdx, 'p1', e)}
            >
              <title>{`Outgoing tangent (x1=${bh.config.x1.toFixed(2)}, y1=${bh.config.y1.toFixed(2)})`}</title>
            </circle>
            <circle
              cx={bh.p2X} cy={bh.p2Y} r={4}
              fill={ACCENT_PRIMARY} stroke={ACCENT_PRIMARY_DEEP} strokeWidth={1}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => beginBezierDrag(bh.kfIdx, 'p2', e)}
            >
              <title>{`Incoming tangent (x2=${bh.config.x2.toFixed(2)}, y2=${bh.config.y2.toFixed(2)})`}</title>
            </circle>
          </g>
        ))}

        {/* Keyframe diamonds */}
        {keyframes.map((kf, idx) => {
          const x = toX(kf.time)
          const isSelected = selectedKf.has(idx)
          // S19-08: Get value for first visible property for readout
          const firstVisibleProp = Array.from(visibleProps)[0]
          const valueReadout = firstVisibleProp ? getKeyframeValue(kf, firstVisibleProp).toFixed(2) : null
          const propLabel = firstVisibleProp ? PROPERTIES.find((p) => p.id === firstVisibleProp)?.label : null
          return (
            <g key={idx}
              onMouseEnter={() => setHoveredKf(idx)}
              onMouseLeave={() => setHoveredKf(null)}
              onClick={(e) => handleKfClick(idx, e)}
              onPointerDown={(e) => beginDrag(idx, e)}
              style={{ cursor: 'ew-resize' }}
            >
              {/* S4 step 1 — keyframes are now draggable on the time axis. */}
              <rect x={x - 4} y={h / 2 - 4} width={8} height={8}
                fill={isSelected ? ACCENT_HIGHLIGHT : 'white'} fillOpacity={isSelected ? 1 : 0.8}
                transform={`rotate(45 ${x} ${h / 2})`} className="cursor-ew-resize" />
              {hoveredKf === idx && (
                <text x={x} y={h / 2 - 10} textAnchor="middle" fill="white" fontSize={9} fillOpacity={0.7}>
                  t={kf.time.toFixed(1)}s{valueReadout != null ? ` ${propLabel}=${valueReadout}` : ''}
                </text>
              )}
            </g>
          )
        })}

        {/* S4 step 6 — marquee rectangle (drawn last so it sits above the curves) */}
        {marquee && (
          <rect
            x={Math.min(marquee.x0, marquee.x1)}
            y={Math.min(marquee.y0, marquee.y1)}
            width={Math.abs(marquee.x1 - marquee.x0)}
            height={Math.abs(marquee.y1 - marquee.y0)}
            fill="#38bdf8"
            fillOpacity={0.1}
            stroke="#38bdf8"
            strokeOpacity={0.6}
            strokeWidth={1}
            strokeDasharray="2 2"
            pointerEvents="none"
          />
        )}
      </svg>

      {/* S4 step 8 — easing applicator. Popover shows all 31 easings.
          Scope chip indicates whether changes hit selection or all keyframes. */}
      <div className="flex items-center gap-2 p-1 border-t border-white/10">
        <span className="text-[9px] uppercase tracking-wider text-white/40 px-1">
          Set easing on {selectedKf.size > 0 ? `${selectedKf.size} selected` : 'all'}
        </span>
        <div className="flex-1">
          <EasingSelect value="linear" onChange={applyEasingTo} />
        </div>
        {/* S4 — snap selection times to playhead. Disabled when nothing's
            selected; greyed when the playhead sits outside the formation's
            local window so the snap would be a no-op. */}
        <button
          type="button"
          onClick={snapSelectedToPlayhead}
          disabled={selectedKf.size === 0 || playheadLocal < 0 || playheadLocal > duration}
          className="px-2 py-0.5 text-micro rounded bg-white/5 hover:bg-white/10 text-white/70 disabled:opacity-30 disabled:cursor-not-allowed"
          title={selectedKf.size === 0
            ? 'Select keyframes to enable'
            : (playheadLocal < 0 || playheadLocal > duration)
            ? 'Move the playhead inside this formation first'
            : `Set time = ${playheadLocal.toFixed(2)}s on ${selectedKf.size} selected keyframe${selectedKf.size === 1 ? '' : 's'}`}
        >
          Snap to playhead
        </button>
      </div>
    </div>
  )
}
