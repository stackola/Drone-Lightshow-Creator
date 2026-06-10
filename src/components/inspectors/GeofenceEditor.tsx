// S15-09: Geofence polygon editor — 2D overhead view for editing boundary points

import { useState, useRef, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'

const SVG_SIZE = 250
const PADDING = 20
const VERTEX_RADIUS = 5
const HIT_RADIUS = 10

export function GeofenceEditor() {
  const constraints = useProjectStore((s) => s.constraints)
  const updateConstraints = useProjectStore((s) => s.updateConstraints)
  const polygon = constraints.geofencePolygon
  const radius = constraints.geofenceRadius

  const svgRef = useRef<SVGSVGElement>(null)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; z: number } | null>(null)

  // Scale: map world coordinates [-radius, radius] to SVG [PADDING, SVG_SIZE - PADDING]
  const usable = SVG_SIZE - 2 * PADDING
  const scale = usable / (2 * radius)

  const worldToScreen = useCallback(
    (wx: number, wz: number): { sx: number; sy: number } => ({
      sx: SVG_SIZE / 2 + wx * scale,
      sy: SVG_SIZE / 2 - wz * scale, // flip Z so +Z is up
    }),
    [scale],
  )

  const screenToWorld = useCallback(
    (sx: number, sy: number): { wx: number; wz: number } => ({
      wx: (sx - SVG_SIZE / 2) / scale,
      wz: -(sy - SVG_SIZE / 2) / scale,
    }),
    [scale],
  )

  const getSvgPoint = useCallback(
    (e: React.MouseEvent): { sx: number; sy: number } => {
      const svg = svgRef.current
      if (!svg) return { sx: 0, sy: 0 }
      const rect = svg.getBoundingClientRect()
      return {
        sx: e.clientX - rect.left,
        sy: e.clientY - rect.top,
      }
    },
    [],
  )

  const handleSvgClick = useCallback(
    (e: React.MouseEvent) => {
      if (draggingIdx !== null) return
      // Check if clicking on a vertex
      const { sx, sy } = getSvgPoint(e)
      for (let i = 0; i < polygon.length; i++) {
        const pt = polygon[i]!
        const s = worldToScreen(pt.x, pt.z)
        const dx = sx - s.sx
        const dy = sy - s.sy
        if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) return // handled by vertex click
      }
      // Add new vertex
      const { wx, wz } = screenToWorld(sx, sy)
      const newPolygon = [...polygon, { x: Math.round(wx * 10) / 10, y: 0, z: Math.round(wz * 10) / 10 }]
      updateConstraints({ geofencePolygon: newPolygon })
    },
    [polygon, draggingIdx, getSvgPoint, worldToScreen, screenToWorld, updateConstraints],
  )

  const handleVertexMouseDown = useCallback(
    (idx: number, e: React.MouseEvent) => {
      e.stopPropagation()
      setDraggingIdx(idx)

      const onMouseMove = (me: MouseEvent) => {
        const svg = svgRef.current
        if (!svg) return
        const rect = svg.getBoundingClientRect()
        const sx = me.clientX - rect.left
        const sy = me.clientY - rect.top
        const { wx, wz } = screenToWorld(sx, sy)
        const updated = [...polygon]
        updated[idx] = { x: Math.round(wx * 10) / 10, y: polygon[idx]!.y, z: Math.round(wz * 10) / 10 }
        updateConstraints({ geofencePolygon: updated })
      }

      const onMouseUp = () => {
        setDraggingIdx(null)
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [polygon, screenToWorld, updateConstraints],
  )

  const handleVertexClick = useCallback(
    (idx: number, e: React.MouseEvent) => {
      e.stopPropagation()
      // Remove vertex on click (if not dragging)
      if (draggingIdx !== null) return
      const newPolygon = polygon.filter((_, i) => i !== idx)
      updateConstraints({ geofencePolygon: newPolygon })
    },
    [polygon, draggingIdx, updateConstraints],
  )

  const handleVertexHover = useCallback(
    (idx: number | null) => {
      setHoveredIdx(idx)
      if (idx !== null && polygon[idx]) {
        setHoverPos({ x: polygon[idx]!.x, z: polygon[idx]!.z })
      } else {
        setHoverPos(null)
      }
    },
    [polygon],
  )

  // Build polygon path
  const pathPoints = polygon.map((pt) => {
    const s = worldToScreen(pt.x, pt.z)
    return `${s.sx},${s.sy}`
  })
  const pathD = pathPoints.length > 0 ? `M${pathPoints.join(' L')} Z` : ''

  // Radius circle
  const center = worldToScreen(0, 0)
  const radiusScreenPx = radius * scale

  return (
    <div className="mt-1">
      <div className="text-[9px] text-white/30 mb-1">
        Click to add point. Click vertex to remove. Drag to move.
      </div>
      <svg
        ref={svgRef}
        width={SVG_SIZE}
        height={SVG_SIZE}
        className="bg-surface-raised/50 rounded border border-white/5 cursor-crosshair"
        onClick={handleSvgClick}
      >
        {/* Grid lines */}
        <line x1={SVG_SIZE / 2} y1={PADDING} x2={SVG_SIZE / 2} y2={SVG_SIZE - PADDING} stroke="white" strokeOpacity={0.05} />
        <line x1={PADDING} y1={SVG_SIZE / 2} x2={SVG_SIZE - PADDING} y2={SVG_SIZE / 2} stroke="white" strokeOpacity={0.05} />

        {/* Axis labels */}
        <text x={SVG_SIZE - PADDING + 4} y={SVG_SIZE / 2 + 3} fontSize={8} fill="white" fillOpacity={0.15}>X</text>
        <text x={SVG_SIZE / 2 - 3} y={PADDING - 4} fontSize={8} fill="white" fillOpacity={0.15}>Z</text>

        {/* Radius reference circle */}
        <circle
          cx={center.sx}
          cy={center.sy}
          r={radiusScreenPx}
          fill="none"
          stroke="cyan"
          strokeOpacity={0.15}
          strokeDasharray="4 3"
        />
        <text x={center.sx + radiusScreenPx + 3} y={center.sy - 3} fontSize={8} fill="cyan" fillOpacity={0.25}>
          {radius}m
        </text>

        {/* Polygon fill + stroke */}
        {pathD && (
          <path
            d={pathD}
            fill="red"
            fillOpacity={0.12}
            stroke="red"
            strokeOpacity={0.5}
            strokeWidth={1.5}
          />
        )}

        {/* Edge lines for thin polygons */}
        {polygon.length === 2 && (() => {
          const a = worldToScreen(polygon[0]!.x, polygon[0]!.z)
          const b = worldToScreen(polygon[1]!.x, polygon[1]!.z)
          return <line x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="red" strokeOpacity={0.5} strokeWidth={1.5} />
        })()}

        {/* Vertices */}
        {polygon.map((pt, i) => {
          const s = worldToScreen(pt.x, pt.z)
          const isHovered = hoveredIdx === i
          return (
            <g key={i}>
              {/* Larger invisible hit area */}
              <circle
                cx={s.sx}
                cy={s.sy}
                r={HIT_RADIUS}
                fill="transparent"
                cursor="grab"
                onMouseDown={(e) => handleVertexMouseDown(i, e)}
                onClick={(e) => handleVertexClick(i, e)}
                onMouseEnter={() => handleVertexHover(i)}
                onMouseLeave={() => handleVertexHover(null)}
              />
              {/* Visible vertex */}
              <circle
                cx={s.sx}
                cy={s.sy}
                r={VERTEX_RADIUS}
                fill={isHovered ? '#ff4444' : '#ff6666'}
                stroke="white"
                strokeWidth={isHovered ? 1.5 : 0.5}
                strokeOpacity={isHovered ? 0.8 : 0.3}
                pointerEvents="none"
              />
              {/* X icon on hover */}
              {isHovered && draggingIdx === null && (
                <g pointerEvents="none">
                  <line x1={s.sx - 3} y1={s.sy - 3} x2={s.sx + 3} y2={s.sy + 3} stroke="white" strokeWidth={1.5} strokeOpacity={0.8} />
                  <line x1={s.sx + 3} y1={s.sy - 3} x2={s.sx - 3} y2={s.sy + 3} stroke="white" strokeWidth={1.5} strokeOpacity={0.8} />
                </g>
              )}
              {/* Coordinate label on hover */}
              {isHovered && hoverPos && (
                <text
                  x={s.sx + 10}
                  y={s.sy - 8}
                  fontSize={9}
                  fill="white"
                  fillOpacity={0.7}
                  pointerEvents="none"
                >
                  ({hoverPos.x}, {hoverPos.z})
                </text>
              )}
            </g>
          )
        })}

        {/* Vertex count */}
        <text x={4} y={12} fontSize={9} fill="white" fillOpacity={0.2}>
          {polygon.length} pts
        </text>
      </svg>
    </div>
  )
}
