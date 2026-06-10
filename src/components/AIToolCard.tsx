// ============================================================================
// S29-06 to S29-10: AI Tool Call Card — collapsible execution display
// L3 (2026-05-21): Per-tool rich body slots — registry previews for create /
// set tools, structured fix-diff for fix_all_violations.
// ============================================================================

import { useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Check, X, Loader, Wrench } from 'lucide-react'
import type { ToolCallResult } from '../stores/aiChatStore'
import { useSelectionStore } from '../stores/selectionStore'
import { RegistryItemPreview } from './RegistryItemPreview'

// ── S29-07: Human-readable tool call summaries ──────────────────────────────

function getToolSummary(tc: ToolCallResult): string {
  const d = tc.output.data as Record<string, unknown> | undefined
  const inp = tc.input

  switch (tc.toolName) {
    case 'create_formation':
      return `Created "${inp.name}" — ${inp.generatorId}, ${d?.pointCount ?? '?'} pts`
    case 'create_formation_from_text':
      return `Created text "${inp.text}" — ${d?.pointCount ?? '?'} pts`
    case 'update_formation':
      return `Updated formation ${String(inp.formationId).slice(0, 12)}`
    case 'delete_formation':
      return `Deleted formation`
    case 'set_formation_points':
      return `Set ${(inp.points as unknown[])?.length ?? '?'} custom points`
    case 'add_launch_node':
      return `Added launch — ${inp.droneCount} drones`
    case 'add_formation_node':
      return `Added formation node`
    case 'add_transition_node':
      return `Added ${inp.strategyId} transition — ${inp.duration}s`
    case 'add_idle_node':
      return `Added ${inp.behavior} idle — ${inp.duration}s`
    case 'add_land_node':
      return `Added land node`
    case 'connect_nodes':
      return tc.output.success ? `Connected nodes` : `Connection failed`
    case 'remove_node':
      return `Removed node`
    case 'remove_edge':
      return `Removed edge`
    case 'update_node_timing':
      return `Updated timing on ${String(inp.nodeId).slice(0, 12)}`
    case 'update_node_transform':
      return `Updated transform on ${String(inp.nodeId).slice(0, 12)}`
    case 'add_keyframe':
      return `Added keyframe at t=${inp.time}s`
    case 'remove_keyframe':
      return `Removed keyframe #${inp.keyframeIndex}`
    case 'set_color_program':
      return `Set color: ${inp.colorProgramId}`
    case 'set_transition_strategy':
      return `Set strategy: ${inp.strategyId}`
    case 'add_attached_idle':
      return `Added ${inp.behavior} idle to formation`
    case 'fix_all_violations':
      return `Fixed ${(d as { fixedCount?: number })?.fixedCount ?? 0} violations`
    case 'auto_time_show':
      return `Auto-timed ${(d as { adjustedNodeCount?: number })?.adjustedNodeCount ?? 0} nodes`
    case 'push_timing':
      return `Pushed timing +${inp.deltaSeconds}s`
    case 'set_drone_count':
      return `Set drone count to ${(d as { droneCount?: number })?.droneCount ?? inp.count}`
    case 'update_constraints':
      return `Updated constraints`
    case 'clear_graph':
      return `Cleared entire show`
    case 'get_show_summary':
    case 'get_graph':
    case 'get_node':
    case 'get_timing':
    case 'get_formations':
    case 'get_formation_points':
    case 'get_violations':
    case 'get_constraints':
    case 'get_drone_pool':
    case 'evaluate_at_time':
    case 'get_available_generators':
    case 'get_available_transitions':
    case 'get_available_idle_behaviors':
    case 'get_available_color_programs':
      return `Read: ${tc.toolName.replace('get_', '').replace(/_/g, ' ')}`
    default:
      return tc.toolName
  }
}

// ── S29-10: Extract nodeId from tool result for click-to-select ─────────────

function extractNodeId(tc: ToolCallResult): string | null {
  const d = tc.output.data as Record<string, unknown> | undefined
  if (d?.nodeId) return d.nodeId as string
  if (tc.input.nodeId) return tc.input.nodeId as string
  if (tc.input.formationNodeId) return tc.input.formationNodeId as string
  return null
}

// ── S29-06: AIToolCard component ────────────────────────────────────────────

interface AIToolCardProps {
  toolCall: ToolCallResult
  isExecuting?: boolean
}

export function AIToolCard({ toolCall, isExecuting }: AIToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  const selectNodes = useSelectionStore((s) => s.selectNodes)

  const summary = getToolSummary(toolCall)
  const nodeId = extractNodeId(toolCall)
  const isRead = toolCall.toolName.startsWith('get_') || toolCall.toolName === 'evaluate_at_time'

  // S29-10: Click to select node
  const handleClick = useCallback(() => {
    if (nodeId) selectNodes([nodeId])
  }, [nodeId, selectNodes])

  return (
    <div className={`my-1 rounded border text-caption ${
      toolCall.output.success
        ? 'border-white/10 bg-white/[0.02]'
        : 'border-red-500/20 bg-red-900/10'
    }`}>
      {/* Header — always visible */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* S29-08: Status indicator */}
        {isExecuting ? (
          <Loader size={11} className="animate-spin text-blue-400 flex-shrink-0" />
        ) : toolCall.output.success ? (
          <Check size={11} className="text-green-400 flex-shrink-0" />
        ) : (
          <X size={11} className="text-red-400 flex-shrink-0" />
        )}

        <Wrench size={10} className={`flex-shrink-0 ${isRead ? 'text-white/20' : 'text-blue-400/60'}`} />

        <span className="flex-1 text-white/60 truncate">{summary}</span>

        {toolCall.durationMs > 0 && (
          <span className="text-white/20 text-[9px] flex-shrink-0">{toolCall.durationMs}ms</span>
        )}

        {/* S29-10: Node link */}
        {nodeId && (
          <button
            onClick={(e) => { e.stopPropagation(); handleClick() }}
            className="text-cyan-400/50 hover:text-cyan-400 text-[9px] px-1 flex-shrink-0"
            title="Select node"
          >
            select
          </button>
        )}

        {expanded ? <ChevronDown size={12} className="text-white/30" /> : <ChevronRight size={12} className="text-white/30" />}
      </div>

      {/* L3 — per-tool rich body. Always visible (not gated by expand) for
          the small set of tools where seeing the artifact at a glance is the
          whole point. */}
      <ToolBody toolCall={toolCall} />

      {/* Expanded: input params + output */}
      {expanded && (
        <div className="px-2 pb-2 space-y-1 border-t border-white/5">
          {Object.keys(toolCall.input).length > 0 && (
            <div>
              <div className="text-[9px] text-white/30 mt-1">Input:</div>
              <pre className="text-[9px] text-white/40 bg-black/20 rounded px-1.5 py-1 overflow-x-auto max-h-24 overflow-y-auto">
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <div className="text-[9px] text-white/30">Output:</div>
            <pre className={`text-[9px] rounded px-1.5 py-1 overflow-x-auto max-h-32 overflow-y-auto ${
              toolCall.output.success ? 'text-white/40 bg-black/20' : 'text-red-300/60 bg-red-900/10'
            }`}>
              {toolCall.output.success
                ? JSON.stringify(toolCall.output.data, null, 2)?.slice(0, 500)
                : toolCall.output.error}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── L3: per-tool body slots ────────────────────────────────────────────────

interface ToolBodyProps {
  toolCall: ToolCallResult
}

function ToolBody({ toolCall }: ToolBodyProps): JSX.Element | null {
  if (!toolCall.output.success) return null
  const body = renderToolBody(toolCall)
  if (body) return body
  // L3 fallback: if the per-tool case returned null (data missing, edge case),
  // render a one-line "done" summary so the card never appears as an empty
  // success placeholder. The full JSON stays available behind the expand
  // chevron.
  const inp = toolCall.input
  const data = toolCall.output.data as Record<string, unknown> | undefined
  const target = (data?.nodeId as string | undefined) ?? (inp.nodeId as string | undefined) ?? (inp.formationId as string | undefined)
  const message = (data?.message as string | undefined) ?? (target ? `nodeId ${target.slice(0, 12)}` : 'done')
  return (
    <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 flex items-center gap-1.5">
      <Check size={10} className="text-emerald-400/70 flex-shrink-0" />
      <span className="truncate">{message}</span>
    </div>
  )
}

function renderToolBody(toolCall: ToolCallResult): JSX.Element | null {
  const inp = toolCall.input
  const data = toolCall.output.data as Record<string, unknown> | undefined

  switch (toolCall.toolName) {
    case 'create_formation':
    case 'update_formation': {
      const generatorId = (inp.generatorId as string | undefined) ?? (data?.generatorId as string | undefined)
      const params = (inp.parameters as Record<string, number> | undefined) ?? (data?.parameters as Record<string, number> | undefined)
      if (!generatorId) return null
      return (
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-white/5">
          <RegistryItemPreview kind="generator" id={generatorId} params={params} size={48} />
          <div className="flex-1 min-w-0 text-micro text-white/40 space-y-0.5">
            <div className="text-white/60 truncate">{inp.name as string ?? generatorId}</div>
            {data?.pointCount !== undefined && <div>{String(data.pointCount)} points</div>}
            {generatorId && <div className="capitalize">{generatorId}</div>}
          </div>
        </div>
      )
    }
    case 'add_transition_node': {
      const strategyId = inp.strategyId as string | undefined
      if (!strategyId) return null
      return (
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-white/5">
          <RegistryItemPreview kind="transition" id={strategyId} size={48} />
          <div className="flex-1 min-w-0 text-micro text-white/40 space-y-0.5">
            <div className="text-white/60 capitalize">{strategyId}</div>
            {inp.duration !== undefined && <div>{String(inp.duration)}s</div>}
          </div>
        </div>
      )
    }
    case 'add_idle_node':
    case 'add_attached_idle': {
      const behavior = inp.behavior as string | undefined
      if (!behavior) return null
      return (
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-white/5">
          <RegistryItemPreview kind="idle" id={behavior} params={{ radius: inp.radius as number, speed: inp.speed as number, altitude: inp.altitude as number }} size={48} />
          <div className="flex-1 min-w-0 text-micro text-white/40 space-y-0.5">
            <div className="text-white/60 capitalize">{behavior}</div>
            {inp.radius !== undefined && <div>r={String(inp.radius)} · s={String(inp.speed)}</div>}
          </div>
        </div>
      )
    }
    case 'set_color_program': {
      const id = inp.colorProgramId as string | undefined
      if (!id) return null
      return (
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-white/5">
          <RegistryItemPreview kind="color" id={id} size={48} />
          <div className="flex-1 min-w-0 text-micro text-white/40">
            <div className="text-white/60">{id}</div>
          </div>
        </div>
      )
    }
    case 'fix_all_violations': {
      const fixedCount = (data?.fixedCount as number | undefined) ?? 0
      const remaining = (data?.remainingViolations as Array<{ message?: string }> | undefined) ?? []
      const applied = (data?.appliedFixes as Array<{ description?: string }> | undefined) ?? []
      return (
        <div className="px-2 py-1.5 border-t border-white/5 space-y-1">
          <div className="flex items-center gap-3 text-micro">
            <span className="text-emerald-400/80">{fixedCount} fixed</span>
            <span className={remaining.length ? 'text-amber-400/80' : 'text-white/30'}>{remaining.length} remain</span>
          </div>
          {applied.length > 0 && (
            <ul className="text-micro text-white/40 space-y-0.5 max-h-20 overflow-y-auto">
              {applied.slice(0, 6).map((f, i) => (
                <li key={i} className="truncate">✓ {f.description ?? 'fix applied'}</li>
              ))}
              {applied.length > 6 && (
                <li className="text-white/20">+ {applied.length - 6} more</li>
              )}
            </ul>
          )}
        </div>
      )
    }
    case 'add_keyframe': {
      const t = inp.time as number | undefined
      if (t === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 flex items-center gap-2">
          <div className="flex-1 h-1 bg-white/10 rounded relative">
            <div className="absolute h-3 w-1 bg-cyan-400 -top-1 rounded" style={{ left: `${Math.max(0, Math.min(100, t * 10))}%` }} />
          </div>
          <span className="text-white/60">t={t}s</span>
        </div>
      )
    }
    case 'auto_time_show': {
      const adjustedCount = (data?.adjustedNodeCount as number | undefined) ?? 0
      const totalDuration = data?.totalDuration as number | undefined
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 flex items-center justify-between gap-2">
          <span>{adjustedCount} node{adjustedCount === 1 ? '' : 's'} re-timed</span>
          {totalDuration !== undefined && <span className="text-white/60">total {totalDuration.toFixed(1)}s</span>}
        </div>
      )
    }
    case 'push_timing': {
      const d = inp.deltaSeconds as number | undefined
      if (d === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 flex items-center gap-2">
          <span>{d > 0 ? '+' : ''}{d.toFixed(1)}s</span>
          <span className="text-white/30">downstream shifted</span>
        </div>
      )
    }
    case 'set_drone_count': {
      const n = (data?.droneCount as number | undefined) ?? (inp.count as number | undefined)
      if (n === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 flex items-center justify-between">
          <span>Drone pool now</span>
          <span className="text-white/70 font-mono">{n}</span>
        </div>
      )
    }
    case 'update_node_transform': {
      const pos = inp.position as { x?: number; y?: number; z?: number } | undefined
      if (!pos) return null
      const parts: string[] = []
      if (pos.x !== undefined) parts.push(`x=${pos.x}`)
      if (pos.y !== undefined) parts.push(`y=${pos.y}`)
      if (pos.z !== undefined) parts.push(`z=${pos.z}`)
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 font-mono">
          {parts.join(' · ')}
        </div>
      )
    }
    case 'update_node_timing': {
      const start = inp.startTime as number | undefined
      const dur = inp.duration as number | undefined
      const parts: string[] = []
      if (start !== undefined) parts.push(`start=${start.toFixed(1)}s`)
      if (dur !== undefined) parts.push(`dur=${dur.toFixed(1)}s`)
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 font-mono">
          {parts.join(' · ')}
        </div>
      )
    }
    case 'critique_show':
    case 'critique_formation': {
      const score = data?.score as number | undefined
      const suggestion = data?.suggestion as string | undefined
      if (score === undefined && !suggestion) return null
      const tone = score === undefined ? 'text-white/40' : score >= 7 ? 'text-emerald-300' : score >= 4 ? 'text-amber-300' : 'text-red-300'
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 space-y-1">
          {score !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-white/30">Score</span>
              <span className={`font-bold ${tone}`}>{score}/10</span>
            </div>
          )}
          {suggestion && <div className="text-white/60 leading-snug">{suggestion}</div>}
        </div>
      )
    }
    case 'create_formation_from_text': {
      const text = inp.text as string | undefined
      const pointCount = data?.pointCount as number | undefined
      if (!text) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 flex items-center gap-2">
          <div className="flex-1 font-display text-base text-white/80 truncate leading-tight">{`"${text}"`}</div>
          {pointCount !== undefined && <span className="text-micro text-white/40 flex-shrink-0">{pointCount} pts</span>}
        </div>
      )
    }
    case 'set_formation_points': {
      const count = (inp.points as unknown[] | undefined)?.length
      if (count === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 flex items-center justify-between">
          <span>Custom positions</span>
          <span className="text-white/70 font-mono">{count} pts</span>
        </div>
      )
    }
    case 'set_transition_strategy': {
      const strategyId = inp.strategyId as string | undefined
      if (!strategyId) return null
      return (
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-white/5">
          <RegistryItemPreview kind="transition" id={strategyId} size={48} />
          <div className="flex-1 min-w-0 text-micro text-white/40">
            <div className="text-white/60 capitalize">{strategyId}</div>
            <div className="text-white/30">strategy applied</div>
          </div>
        </div>
      )
    }
    case 'update_constraints': {
      const fields = Object.keys(inp).filter((k) => k !== 'nodeId')
      if (fields.length === 0) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 font-mono">
          {fields.slice(0, 3).map((k) => `${k}=${String(inp[k as keyof typeof inp])}`).join(' · ')}
          {fields.length > 3 && <span className="text-white/30"> · +{fields.length - 3} more</span>}
        </div>
      )
    }
    case 'add_launch_node':
    case 'add_formation_node':
    case 'add_land_node':
    case 'connect_nodes':
    case 'remove_node':
    case 'remove_edge': {
      // Compact default treatment — show the affected nodeId if available.
      const target = (data?.nodeId as string | undefined) ?? (inp.nodeId as string | undefined) ?? (inp.formationNodeId as string | undefined)
      if (!target) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/30 font-mono truncate">
          {target}
        </div>
      )
    }
    case 'get_violations': {
      const violations = (data?.violations ?? data as unknown) as Array<{ severity?: string; message?: string }> | undefined
      if (!Array.isArray(violations)) return null
      const errors = violations.filter((v) => v.severity === 'error').length
      const warns = violations.filter((v) => v.severity === 'warning').length
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro flex items-center gap-3">
          <span className={errors > 0 ? 'text-red-400' : 'text-white/30'}>{errors} error{errors === 1 ? '' : 's'}</span>
          <span className={warns > 0 ? 'text-amber-400' : 'text-white/30'}>{warns} warning{warns === 1 ? '' : 's'}</span>
          {violations.length === 0 && <span className="text-emerald-400">No violations</span>}
        </div>
      )
    }
    case 'get_show_summary': {
      const droneCount = data?.droneCount as number | undefined
      const nodeCount = data?.nodeCount as number | undefined
      const duration = data?.duration as number | undefined
      if (droneCount === undefined && nodeCount === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/50 flex items-center gap-3 font-mono">
          {droneCount !== undefined && <span>{droneCount} drones</span>}
          {nodeCount !== undefined && <span>{nodeCount} nodes</span>}
          {duration !== undefined && <span>{duration.toFixed(1)}s</span>}
        </div>
      )
    }
    case 'evaluate_at_time': {
      const t = inp.time as number | undefined
      const sample = (data?.dronePositions as unknown[] | undefined)?.length
      if (t === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 flex items-center justify-between">
          <span>t = {t.toFixed(2)}s</span>
          {sample !== undefined && <span className="text-white/60 font-mono">{sample} drones sampled</span>}
        </div>
      )
    }
    case 'remove_keyframe': {
      const idx = inp.keyframeIndex as number | undefined
      if (idx === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40">
          Removed keyframe #{idx}
        </div>
      )
    }
    case 'clear_graph': {
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-red-300 flex items-center gap-2">
          <X size={11} className="flex-shrink-0" />
          <span>All nodes, edges, and formations removed.</span>
        </div>
      )
    }
    case 'delete_formation': {
      const id = inp.formationId as string | undefined
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 font-mono truncate">
          {id ?? 'formation deleted'}
        </div>
      )
    }
    case 'create_formation_from_svg': {
      const name = inp.name as string | undefined
      const concept = inp.concept as string | undefined
      const pointCount = data?.pointCount as number | undefined
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 space-y-0.5">
          {name && <div className="text-white/60">{name}</div>}
          {concept && <div className="italic">"{concept}"</div>}
          {pointCount !== undefined && <div className="font-mono">{pointCount} pts</div>}
        </div>
      )
    }
    case 'generate_custom_formation':
    case 'generate_animated_formation': {
      const desc = inp.description as string | undefined
      const pointCount = data?.pointCount as number | undefined
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 space-y-0.5">
          {desc && <div className="italic">"{desc}"</div>}
          {pointCount !== undefined && <div className="font-mono">{pointCount} pts</div>}
        </div>
      )
    }
    case 'get_graph': {
      const nodeCount = (data?.nodes as unknown[] | undefined)?.length
      const edgeCount = (data?.edges as unknown[] | undefined)?.length
      if (nodeCount === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/50 font-mono flex gap-3">
          <span>{nodeCount} nodes</span>
          {edgeCount !== undefined && <span>{edgeCount} edges</span>}
        </div>
      )
    }
    case 'get_node': {
      const nodeType = data?.type as string | undefined
      const nodeId = data?.id as string | undefined
      if (!nodeId) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 flex items-center gap-2">
          {nodeType && <span className={`px-1 rounded text-[9px] font-semibold ${
            nodeType === 'launch' ? 'bg-emerald-500/30 text-emerald-200' :
            nodeType === 'formation' ? 'bg-blue-500/30 text-blue-200' :
            nodeType === 'transition' ? 'bg-purple-500/30 text-purple-200' :
            nodeType === 'idle' ? 'bg-amber-500/30 text-amber-200' :
            nodeType === 'land' ? 'bg-red-500/30 text-red-200' :
            'bg-white/10 text-white/60'
          }`}>{nodeType}</span>}
          <span className="font-mono truncate">{nodeId}</span>
        </div>
      )
    }
    case 'get_timing': {
      const total = data?.totalDuration as number | undefined
      const nodeCount = (data?.nodes as unknown[] | undefined)?.length
      if (total === undefined && nodeCount === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/50 font-mono flex gap-3">
          {total !== undefined && <span>{total.toFixed(1)}s total</span>}
          {nodeCount !== undefined && <span>{nodeCount} nodes timed</span>}
        </div>
      )
    }
    case 'get_formations': {
      const formations = data as unknown as Array<{ id: string; name: string; pointCount: number; type?: string }> | undefined
      if (!Array.isArray(formations)) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 space-y-0.5 max-h-24 overflow-y-auto">
          <div className="text-white/60">{formations.length} formation{formations.length === 1 ? '' : 's'}</div>
          {formations.slice(0, 5).map((f) => (
            <div key={f.id} className="truncate">• {f.name} <span className="text-white/30">({f.pointCount} pts{f.type === 'animated' ? ', animated' : ''})</span></div>
          ))}
          {formations.length > 5 && <div className="text-white/30">+ {formations.length - 5} more</div>}
        </div>
      )
    }
    case 'get_formation_points': {
      const pts = data as unknown as Array<{ x: number; y: number; z: number }> | undefined
      if (!Array.isArray(pts)) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/50 font-mono">
          {pts.length} points
        </div>
      )
    }
    case 'get_constraints': {
      const c = data as Record<string, number> | undefined
      if (!c) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/50 font-mono flex flex-wrap gap-2">
          {c.maxVelocity !== undefined && <span>v={c.maxVelocity}m/s</span>}
          {c.maxAcceleration !== undefined && <span>a={c.maxAcceleration}m/s²</span>}
          {c.minDroneDistance !== undefined && <span>d={c.minDroneDistance}m</span>}
        </div>
      )
    }
    case 'get_drone_pool': {
      const count = data?.droneCount as number | undefined
      const layout = data?.launchLayout as string | undefined
      if (count === undefined) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/50 font-mono flex gap-3">
          <span>{count} drones</span>
          {layout && <span>{layout}</span>}
        </div>
      )
    }
    case 'get_available_generators':
    case 'get_available_transitions':
    case 'get_available_idle_behaviors':
    case 'get_available_color_programs': {
      const items = data as unknown as Array<{ id: string; name?: string }> | undefined
      if (!Array.isArray(items)) return null
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/50">
          <div className="flex flex-wrap gap-1">
            {items.slice(0, 12).map((it) => (
              <span key={it.id} className="px-1.5 py-0.5 rounded bg-white/5 text-white/70 text-micro">
                {it.name ?? it.id}
              </span>
            ))}
            {items.length > 12 && <span className="text-white/30">+ {items.length - 12} more</span>}
          </div>
        </div>
      )
    }
    case 'resolve_violations_creatively': {
      const summary = data?.summary as string | undefined
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/60 italic">
          {summary ?? 'Creative resolution applied.'}
        </div>
      )
    }
    case 'create_show_from_outline': {
      const acts = (data?.acts as unknown[] | undefined)?.length
      const nodes = data?.nodeCount as number | undefined
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/50 font-mono flex gap-3">
          {acts !== undefined && <span>{acts} acts</span>}
          {nodes !== undefined && <span>{nodes} nodes</span>}
        </div>
      )
    }
    case 'analyze_image_for_formation': {
      const status = data?.status as string | undefined
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/60">
          {status ?? 'Image analyzed; awaiting next steps.'}
        </div>
      )
    }
    case 'generate_music_synced_show':
    case 'generate_show_structure': {
      const desc = (inp.description ?? inp.theme ?? inp.style) as string | undefined
      const acts = (data?.acts as unknown[] | undefined)?.length
      return (
        <div className="px-2 py-1.5 border-t border-white/5 text-micro text-white/40 space-y-0.5">
          {desc && <div className="italic">"{desc}"</div>}
          {acts !== undefined && <div className="font-mono">{acts} acts generated</div>}
        </div>
      )
    }
    default:
      return null
  }
}
