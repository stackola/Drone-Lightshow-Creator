// ============================================================================
// Slice 3 Step 6: Demo validation + coverage tests.
//
// For each registered demo:
//   - seed() it into fresh stores
//   - assert validateShowPhysics returns zero `severity: 'error'` violations
//     (warnings are allowed)
//   - assert total duration is within ±15% of META.lengthSeconds (catches drift
//     if someone alters a dwell or transition)
//
// Coverage regression: every registered transition / idle behavior / formation
// generator / animated formation / color program must appear in at least one
// demo's `showcases` list.
// ============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initRegistries } from '../../registries/init'
import { DEMO_REGISTRY } from './index'
import { useGraphStore } from '../../stores/graphStore'
import { useProjectStore } from '../../stores/projectStore'
import { useFormationStore } from '../../stores/formationStore'
import { validateShowPhysics } from '../../graph/physicsValidator'
import { getTotalDuration } from '../../graph/timing'
import { getAllTransitions } from '../../registries/transitions'
import { getAllIdleBehaviors } from '../../registries/idleBehaviors'
import { getAllGenerators } from '../../registries/generators'
import { getAllColorPrograms } from '../../graph/colorPrograms'
import { getLibraryFormations } from '../../registries/formationLibrary'

beforeAll(() => initRegistries())

beforeEach(() => {
  // Each demo seed calls resetProject() which loads an empty graph — clean slate per test.
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
})

describe('Slice 3 Step 6: demo physics validity', () => {
  for (const demo of DEMO_REGISTRY) {
    it(`${demo.id}: validateShowPhysics emits no error-severity violations`, () => {
      demo.seed()
      const { nodes, edges } = useGraphStore.getState()
      const constraints = useProjectStore.getState().constraints
      const formations = useFormationStore.getState().generatedPoints
      const homePositions = useProjectStore.getState().dronePool.homePositions
      const violations = validateShowPhysics({ nodes, edges }, constraints, formations, homePositions)
      // Engine auto-extends transitions to satisfy minRequired (smart auto-fit), and the
      // collision check filters out density-at-rest false positives — so any error here is
      // a real motion-induced violation worth fixing.
      const errors = violations.filter((v) => v.severity === 'error')
      if (errors.length > 0) {
        const summary = errors.map((e) => `  - ${e.id}: ${e.message}`).join('\n')
        throw new Error(`${demo.id} has ${errors.length} error-severity violations:\n${summary}`)
      }
      expect(errors).toHaveLength(0)
    })
  }
})

// Stricter sibling — warnings also matter because they surface as the
// numeric badge on the Physics tab, and a freshly-loaded demo with a
// warning is a bad first-load impression. As of 2026-05-21 all 8
// shipped demos pass this stricter check; if you add a new demo, run
// `pnpm vitest run src/app/demos/demos.test.ts` and fix any warnings
// before merging. Common pitfalls (and how earlier demos fixed them):
//   - Heart curve cusp at t=π crowds adjacent drones — keep count ≤ 80.
//   - Star outerRadius governs perimeter; spacing ≈ 2πr × scale / count.
//   - Sphere fibonacci spacing ≈ 2.7·r/√n.
//   - kf() defaults missing position axes to 0; if you only want
//     rotation, still pass `{ y: <altitude> }` to preserve the floor.
//   - Bottom of heart/star is far below formation centre; bump altitude
//     to keep the lowest drone above the 0m geofence floor.
describe('Demo physics validity (warnings count too)', () => {
  for (const demo of DEMO_REGISTRY) {
    it(`${demo.id}: validateShowPhysics emits no violations of any severity`, () => {
      demo.seed()
      const { nodes, edges } = useGraphStore.getState()
      const constraints = useProjectStore.getState().constraints
      const formations = useFormationStore.getState().generatedPoints
      const homePositions = useProjectStore.getState().dronePool.homePositions
      const violations = validateShowPhysics({ nodes, edges }, constraints, formations, homePositions)
      if (violations.length > 0) {
        const summary = violations.map((v) => `  - [${v.severity}] ${v.id}: ${v.message}`).join('\n')
        throw new Error(`${demo.id} ships with ${violations.length} violation(s):\n${summary}`)
      }
      expect(violations).toHaveLength(0)
    })
  }
})

describe('Slice 3 Step 6: demo length stays close to declared length', () => {
  for (const demo of DEMO_REGISTRY) {
    it(`${demo.id}: total duration within ±25% of META.lengthSeconds`, () => {
      demo.seed()
      const { nodes, edges } = useGraphStore.getState()
      const total = getTotalDuration({ nodes, edges })
      // ±25% tolerance — accommodates cascade-push from auto-extended transitions
      // (a long-distance transition can stretch the show legally).
      const min = demo.lengthSeconds * 0.75
      const max = demo.lengthSeconds * 1.4
      expect(total).toBeGreaterThanOrEqual(min)
      expect(total).toBeLessThanOrEqual(max)
    })
  }
})

describe('Slice 3 Step 6: every registered feature appears in at least one demo', () => {
  // Aggregate showcase lists across every demo.
  function showcaseSet(): Set<string> {
    const set = new Set<string>()
    for (const demo of DEMO_REGISTRY) {
      for (const item of demo.showcases) set.add(item)
    }
    return set
  }

  it('every transition strategy has demo coverage', () => {
    const showcases = showcaseSet()
    const missing = getAllTransitions()
      .map((t) => t.id)
      .filter((id) => !showcases.has(`transition:${id}`))
    if (missing.length > 0) {
      throw new Error(`Transitions with no demo coverage: ${missing.join(', ')}. Add to a demo's showcases list.`)
    }
    expect(missing).toEqual([])
  })

  it('every idle behavior has demo coverage', () => {
    const showcases = showcaseSet()
    const missing = getAllIdleBehaviors()
      .map((b) => b.id)
      .filter((id) => !showcases.has(`idle:${id}`))
    if (missing.length > 0) {
      throw new Error(`Idle behaviors with no demo coverage: ${missing.join(', ')}`)
    }
    expect(missing).toEqual([])
  })

  it('every formation generator has demo coverage', () => {
    const showcases = showcaseSet()
    const missing = getAllGenerators()
      .map((g) => g.id)
      .filter((id) => !showcases.has(`generator:${id}`))
    if (missing.length > 0) {
      throw new Error(`Generators with no demo coverage: ${missing.join(', ')}`)
    }
    expect(missing).toEqual([])
  })

  it('every color program has demo coverage', () => {
    const showcases = showcaseSet()
    const missing = getAllColorPrograms()
      .map((p) => p.id)
      .filter((id) => !showcases.has(`color:${id}`))
    if (missing.length > 0) {
      throw new Error(`Color programs with no demo coverage: ${missing.join(', ')}`)
    }
    expect(missing).toEqual([])
  })

  it('every animated library formation has demo coverage', () => {
    const showcases = showcaseSet()
    const missing = getLibraryFormations()
      .map((e) => e.id)
      .filter((id) => !showcases.has(`animated:${id}`))
    if (missing.length > 0) {
      throw new Error(`Animated formations with no demo coverage: ${missing.join(', ')}`)
    }
    expect(missing).toEqual([])
  })
})
