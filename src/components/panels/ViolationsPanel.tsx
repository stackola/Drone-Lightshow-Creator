// ============================================================================
// Violations Panel — Show-wide physics violation scanner with auto-fix
// S14-10: Multi-fix dropdown per violation
// S14-13: "Make It Work" button
// S15-12: Expanded constraints display
// ============================================================================

import { useMemo, useState } from 'react'
import { useGraphStore } from '../../stores/graphStore'
import { useProjectStore } from '../../stores/projectStore'
import { useFormationStore } from '../../stores/formationStore'
import { useHistoryStore } from '../../stores/historyStore'
import { CheckCircle2 } from 'lucide-react'
import { useSelectionStore } from '../../stores/selectionStore'
import { validateShowPhysics, type PhysicsViolation } from '../../graph/physicsValidator'
import { getFixOptionsForViolation, computeFixAllPatches, computeAutoTiming, type ViolationFixOption } from '../../graph/autoFix'
import { getIdleBehavior } from '../../registries/idleBehaviors'

export function ViolationsPanel({ precomputedViolations }: { precomputedViolations?: PhysicsViolation[] } = {}) {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const constraints = useProjectStore((s) => s.constraints)
  const generatedPoints = useFormationStore((s) => s.generatedPoints)
  const applyViolationFixes = useGraphStore((s) => s.applyViolationFixes)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const updateEdgeTransition = useGraphStore((s) => s.updateEdgeTransition)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const selectNodes = useSelectionStore((s) => s.selectNodes)

  const [expandedViolation, setExpandedViolation] = useState<string | null>(null)
  const [hoveredFixNodeId, setHoveredFixNodeId] = useState<string | null>(null)

  // S22-06: Virtual scrolling — limit rendered violations for performance
  const MAX_VISIBLE = 50
  const [showAll, setShowAll] = useState(false)

  const graph = useMemo(() => ({ nodes, edges }), [nodes, edges])

  const computedViolations = useMemo(() => {
    if (precomputedViolations) return precomputedViolations
    return validateShowPhysics(graph, constraints, generatedPoints)
  }, [precomputedViolations, graph, constraints, generatedPoints])
  const violations = computedViolations

  const errorCount = violations.filter((v) => v.severity === 'error').length
  const warningCount = violations.filter((v) => v.severity === 'warning').length

  const handleFix = (violation: PhysicsViolation) => {
    if (!violation.fix) return
    snapshot(`Fix ${violation.type}`)
    applyViolationFixes([{
      type: violation.fix.type,
      nodeId: violation.fix.nodeId,
      edgeId: violation.fix.edgeId,
      delta: violation.fix.delta,
    }])
  }

  const applyFixPatches = (patches: ReturnType<ViolationFixOption['computePatches']>) => {
    for (const patch of patches) {
      if (patch.edgeId) {
        updateEdgeTransition(patch.edgeId, patch.patch as Record<string, unknown>)
      } else if (patch.nodeId) {
        updateNodeData(patch.nodeId, patch.patch as Record<string, unknown>)
      }
    }
  }

  const handleApplyFixOption = (option: ViolationFixOption) => {
    snapshot(`Fix: ${option.label}`)
    applyFixPatches(option.computePatches(graph))
  }

  const handleFixAll = () => {
    const fixable = violations.filter((v) => v.fix !== null)
    if (fixable.length === 0) return
    snapshot(`Fix ${fixable.length} violation${fixable.length === 1 ? '' : 's'}`)
    applyViolationFixes(
      fixable.map((v) => ({
        type: v.fix!.type,
        nodeId: v.fix!.nodeId,
        edgeId: v.fix!.edgeId,
        delta: v.fix!.delta,
      }))
    )
  }

  const handleMakeItWork = () => {
    snapshot('Make It Work')
    applyFixPatches(computeAutoTiming(graph, constraints, generatedPoints))
    applyFixPatches(computeFixAllPatches(violations, graph, constraints, generatedPoints))
    const fixable = violations.filter((v) => v.fix !== null)
    if (fixable.length > 0) {
      applyViolationFixes(
        fixable.map((v) => ({ type: v.fix!.type, nodeId: v.fix!.nodeId, edgeId: v.fix!.edgeId, delta: v.fix!.delta }))
      )
    }
  }

  // S14-10: Get fix options for expanded violation
  const expandedOptions = useMemo(() => {
    if (!expandedViolation) return []
    const v = violations.find((vv) => vv.id === expandedViolation)
    if (!v) return []
    return getFixOptionsForViolation(v, graph, constraints, generatedPoints)
  }, [expandedViolation, violations, graph, constraints, generatedPoints])

  const formations = useFormationStore((s) => s.formations)
  const getNodeLabel = (nodeId: string): string => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return nodeId
    const typeName = node.type.charAt(0).toUpperCase() + node.type.slice(1)
    // Resolve to a friendly display name where one exists (formation
    // name, transition strategy name, idle behaviour name), else fall
    // back to the truncated id prefix as before.
    let name: string | null = null
    if (node.type === 'formation') {
      const fd = node.data as { formationId: string | null }
      name = fd.formationId ? formations.find((f) => f.id === fd.formationId)?.name ?? null : null
    } else if (node.type === 'idle') {
      const id = node.data as { behavior: string }
      name = getIdleBehavior(id.behavior)?.name ?? null
    }
    return `${typeName} (${name ?? nodeId.slice(0, 8)})`
  }

  return (
    <div className="h-full flex flex-col text-white/80">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Physics</span>
          {errorCount > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-micro font-bold rounded">{errorCount}</span>
          )}
          {warningCount > 0 && (
            <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-micro font-bold rounded">{warningCount}</span>
          )}
          {violations.length === 0 && (
            <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-micro font-bold rounded">OK</span>
          )}
        </div>
        <div className="flex gap-1">
          {violations.length > 0 && (
            <button onClick={handleMakeItWork}
              className="px-2 py-0.5 bg-green-600/30 hover:bg-green-600/50 text-green-300 text-micro font-semibold rounded transition-colors">
              Make It Work
            </button>
          )}
          {violations.some((v) => v.fix) && (
            <button onClick={handleFixAll}
              className="px-2 py-0.5 bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 text-micro font-semibold rounded transition-colors">
              Fix All
            </button>
          )}
        </div>
      </div>

      {/* Violations list */}
      <div className="flex-1 overflow-y-auto">
        {violations.length === 0 ? (
          <div className="px-3 py-6 flex flex-col items-center justify-center gap-2 text-center">
            <CheckCircle2 size={24} className="text-emerald-500/60" aria-hidden="true" />
            <div className="text-xs font-medium text-white/70">Physics validates clean</div>
            <div className="text-micro text-white/30 max-w-[240px] leading-relaxed">
              Every transition meets the drone-pool's velocity + acceleration budget. This show is ready to bake.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {(showAll ? violations : violations.slice(0, MAX_VISIBLE)).map((v) => (
              <div key={v.id} className="px-3 py-2 hover:bg-white/5 cursor-pointer transition-colors"
                onClick={() => selectNodes([v.nodeId])}>
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 text-xs flex-shrink-0 ${v.severity === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
                    {v.severity === 'error' ? '●' : '▲'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs">
                      <span className="text-white/40">{getNodeLabel(v.nodeId)}</span>
                      {' — '}
                      <span className={v.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}>{v.message}</span>
                    </div>
                    <div className="text-micro text-white/30 mt-0.5 leading-tight">{v.detail}</div>

                    {/* S14-10: Fix options */}
                    <div className="flex items-center gap-1 mt-1">
                      {v.fix && (
                        <button onClick={(e) => { e.stopPropagation(); handleFix(v) }}
                          className="px-2 py-0.5 bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 text-micro font-medium rounded transition-colors">
                          {v.fix.description}
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setExpandedViolation(expandedViolation === v.id ? null : v.id) }}
                        className="px-1.5 py-0.5 text-white/30 hover:text-white/60 text-micro transition-colors">
                        {expandedViolation === v.id ? '▼' : '▶'} options
                      </button>
                    </div>

                    {/* S14-10: Expanded fix options dropdown */}
                    {expandedViolation === v.id && expandedOptions.length > 0 && (
                      <div className="mt-1 ml-2 space-y-1">
                        {expandedOptions.map((opt) => (
                          <button key={opt.id}
                            onClick={(e) => { e.stopPropagation(); handleApplyFixOption(opt) }}
                            onMouseEnter={() => {
                              const patches = opt.computePatches(graph)
                              const firstNodeId = patches.find((p) => p.nodeId)?.nodeId
                              if (firstNodeId) {
                                setHoveredFixNodeId(firstNodeId)
                                selectNodes([firstNodeId])
                              }
                            }}
                            onMouseLeave={() => setHoveredFixNodeId(null)}
                            className={`w-full text-left px-2 py-1 rounded transition-colors ${hoveredFixNodeId && opt.computePatches(graph).some(p => p.nodeId === hoveredFixNodeId) ? 'bg-cyan-500/20 ring-1 ring-cyan-500/30' : 'bg-white/5 hover:bg-white/10'}`}>
                            <div className="text-micro text-white/70">{opt.label}</div>
                            <div className="text-[9px] text-white/30">{opt.description} <span className={`font-semibold ${opt.impact === 'minimal' ? 'text-green-400/50' : opt.impact === 'moderate' ? 'text-yellow-400/50' : 'text-red-400/50'}`}>{opt.impact}</span></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {violations.length > MAX_VISIBLE && !showAll && (
              <div className="px-3 py-2 text-center">
                <button
                  onClick={() => setShowAll(true)}
                  className="px-3 py-1 text-micro text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 rounded transition-colors"
                >
                  Show all {violations.length} violations
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* S15-12: Constraints summary */}
      <div className="px-3 py-2 border-t border-white/10 text-micro text-white/25 space-y-0.5">
        <div className="font-semibold text-white/40 mb-1">Constraints</div>
        <div className="grid grid-cols-2 gap-x-3">
          <div>Velocity: {constraints.maxVelocity} m/s</div>
          <div>Accel: {constraints.maxAcceleration} m/s²</div>
          <div>Min dist: {constraints.minDroneDistance} m</div>
          <div>Jerk: {constraints.maxJerk} m/s³</div>
          <div>Alt: {constraints.altitudeMin}–{constraints.altitudeMax} m</div>
          <div>Geofence: {constraints.geofenceRadius} m</div>
          <div>Ascent: {constraints.maxAscentRate} m/s</div>
          <div>Descent: {constraints.maxDescentRate} m/s</div>
          <div>Wind: {constraints.windSpeed} m/s</div>
          <div>GPS: ±{constraints.gpsAccuracy} m</div>
          <div>Battery: {Math.round(constraints.batteryReserve * 100)}% reserve</div>
          <div>Flight: {Math.round(constraints.maxFlightTime / 60)} min</div>
        </div>
      </div>
    </div>
  )
}
