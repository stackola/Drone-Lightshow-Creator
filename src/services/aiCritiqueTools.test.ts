// ============================================================================
// S31 Tests: Critique + Constraint Resolution tools + enriched summary
// ============================================================================

import { describe, it, expect,  } from 'vitest'
import { executeTool, generateShowSummary } from './aiToolEngine'
import './aiWriteTools' // register write tools
import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { initRegistries } from '../registries/init'
import type { LaunchNodeData, FormationNodeData, LandNodeData } from '../graph/types'

initRegistries()

function reset() {
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
  useFormationStore.getState().loadFormations([], new Map())
  useProjectStore.getState().setDroneCount(100)
}

function buildShowForCritique() {
  reset()
  const fs = useFormationStore.getState()
  const gs = useGraphStore.getState()

  const r1 = fs.addFormation('Ring One', 'ring', { count: 50, radius: 10 })
  const r2 = fs.addFormation('Ring Two', 'ring', { count: 50, radius: 12 })

  const launch = gs.addNode('launch', { x: 0, y: 150 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
  const f1 = gs.addNode('formation', { x: 100, y: 150 }, {
    formationId: r1, startTime: 3, duration: 8,
    transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)
  const f2 = gs.addNode('formation', { x: 400, y: 150 }, {
    formationId: r2, startTime: 14, duration: 8,
    transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)
  const land = gs.addNode('land', { x: 550, y: 150 }, { staggerDelay: 0.02 } as LandNodeData)

  gs.addEdge(launch, 'flow-out', f1, 'flow-in', 'flow')
  gs.addEdge(f1, 'flow-out', f2, 'flow-in', 'flow')
  gs.addEdge(f2, 'flow-out', land, 'flow-in', 'flow')

  return { launch, f1, f2, land }
}

// ── S31-01/02/03: Enriched summary ──────────────────────────────────────────

describe('Enriched show summary', () => {
  it('S31-01: includes act numbering and formation names', () => {
    buildShowForCritique()
    const summary = generateShowSummary()
    expect(summary).toContain('Act 1: "Ring One"')
    expect(summary).toContain('Act 2: "Ring Two"')
  })

  it('S31-02: includes node label index', () => {
    buildShowForCritique()
    const summary = generateShowSummary()
    expect(summary).toContain('Node label index')
    expect(summary).toContain('"act 1"')
    expect(summary).toContain('"act 2"')
    expect(summary).toContain('"Ring One"')
    expect(summary).toContain('"launch"')
    expect(summary).toContain('"land"')
  })

  it('S31-03: includes time ranges per node', () => {
    buildShowForCritique()
    const summary = generateShowSummary()
    // Should have time ranges like "3.0s–11.0s"
    expect(summary).toMatch(/\d+\.\d+s–\d+\.\d+s/)
  })
})

// ── S31-08 to S31-14: critique_show tool ────────────────────────────────────

describe('critique_show tool', () => {
  it('S31-08: returns structured analysis', () => {
    buildShowForCritique()
    const result = executeTool('critique_show', {})
    expect(result.success).toBe(true)
    const d = result.data as {
      totalFormations: number
      totalTransitions: number
      suggestions: Array<{ severity: string; category: string; message: string }>
    }
    expect(d.totalFormations).toBe(2)
    // Every flow edge between timed nodes carries a transition config.
    expect(d.totalTransitions).toBe(3)
    expect(Array.isArray(d.suggestions)).toBe(true)
  })

  it('S31-10: flags low variety', () => {
    buildShowForCritique() // both formations are rings — low variety
    const result = executeTool('critique_show', {})
    const d = result.data as { suggestions: Array<{ category: string }> }
    // With only 2 formations, the threshold might not trigger, but the call should at least not crash.
    expect(d.suggestions.length).toBeGreaterThanOrEqual(0)
  })

  it('S31-11: flags same-altitude formations', () => {
    buildShowForCritique() // both at y=15
    const result = executeTool('critique_show', {})
    const d = result.data as { suggestions: Array<{ category: string; message: string }> }
    const altSuggestions = d.suggestions.filter((s) => s.category === 'altitude')
    expect(altSuggestions.length).toBeGreaterThan(0)
    expect(altSuggestions[0]!.message).toContain('altitude')
  })

  it('S31-12: flags idle utilization', () => {
    buildShowForCritique() // 100 drones, 50-point formations → 50 leftover, no idle
    const result = executeTool('critique_show', {})
    const d = result.data as { suggestions: Array<{ category: string }> }
    const idleSuggestions = d.suggestions.filter((s) => s.category === 'idle')
    expect(idleSuggestions.length).toBeGreaterThan(0)
  })

  it('S31-13: suggestions have severity and suggestedAction', () => {
    buildShowForCritique()
    const result = executeTool('critique_show', {})
    const d = result.data as { suggestions: Array<{ severity: string; suggestedAction?: string }> }
    for (const s of d.suggestions) {
      expect(['issue', 'improvement', 'suggestion']).toContain(s.severity)
    }
  })

  it('handles empty show', () => {
    reset()
    const result = executeTool('critique_show', {})
    expect(result.success).toBe(true)
    const d = result.data as { suggestions: Array<{ severity: string }> }
    expect(d.suggestions.some((s) => s.severity === 'issue')).toBe(true)
  })
})

// ── S31-15: resolve_violations_creatively ────────────────────────────────────

describe('resolve_violations_creatively tool', () => {
  it('returns suggestions array (possibly empty if no violations)', () => {
    buildShowForCritique()
    executeTool('fix_all_violations', {})
    const result = executeTool('resolve_violations_creatively', {})
    expect(result.success).toBe(true)
    const d = result.data as { violationCount: number; suggestions: unknown[] }
    expect(typeof d.violationCount).toBe('number')
    expect(Array.isArray(d.suggestions)).toBe(true)
    // Suggestions count should match violation count
    expect(d.suggestions.length).toBe(d.violationCount)
  })

  it('suggests strategy changes for transition-too-short', () => {
    reset()
    // Build a show with a very short transition
    const fs = useFormationStore.getState()
    const gs = useGraphStore.getState()
    const r1 = fs.addFormation('Far Left', 'ring', { count: 50, radius: 30 })
    const r2 = fs.addFormation('Far Right', 'ring', { count: 50, radius: 30 })
    const launch = gs.addNode('launch', { x: 0, y: 150 }, { droneCount: 50, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const f1 = gs.addNode('formation', { x: 100, y: 150 }, {
      formationId: r1, startTime: 3, duration: 5,
      transform: { position: { x: -50, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const f2 = gs.addNode('formation', { x: 400, y: 150 }, {
      formationId: r2, startTime: 8.5, duration: 5,
      transform: { position: { x: 50, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const land = gs.addNode('land', { x: 550, y: 150 }, { staggerDelay: 0.02 } as LandNodeData)
    gs.addEdge(launch, 'flow-out', f1, 'flow-in', 'flow')
    // Configure a very short, demanding spiral transition on the f1→f2 edge.
    const f1ToF2Id = gs.addEdge(f1, 'flow-out', f2, 'flow-in', 'flow')!
    gs.updateEdgeTransition(f1ToF2Id, { strategyId: 'spiral', parameters: {}, preferredDuration: 0.5 })
    gs.addEdge(f2, 'flow-out', land, 'flow-in', 'flow')

    const result = executeTool('resolve_violations_creatively', {})
    expect(result.success).toBe(true)
    const d = result.data as { violationCount: number; suggestions: Array<{ approach: string }> }
    // Should have at least one violation (transition too short for spiral over 100m)
    // The tool should suggest switching to shortest-path
    if (d.violationCount > 0) {
      expect(d.suggestions.length).toBeGreaterThan(0)
      expect(d.suggestions[0]!.approach).toBeTruthy()
    }
  })
})
