// ============================================================================
// S30 Tests: Show Outline Builder
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { buildShowFromOutline, type ShowOutline } from './aiShowBuilder'
import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { initRegistries } from '../registries/init'

initRegistries()

function reset() {
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
  useFormationStore.getState().loadFormations([], new Map())
  useProjectStore.getState().setDroneCount(50)
}

describe('buildShowFromOutline', () => {
  beforeEach(reset)

  it('builds a minimal 1-act show', () => {
    const outline: ShowOutline = {
      name: 'Test Show',
      droneCount: 50,
      acts: [
        {
          label: 'Act 1',
          formations: [{
            name: 'Ring',
            generator: { type: 'ring', params: { count: 50, radius: 10 } },
            duration: 5,
            altitude: 15,
          }],
        },
      ],
    }

    const result = buildShowFromOutline(outline)
    expect(result.summary).toContain('Test Show')
    expect(result.summary).toContain('1 formations')
    expect(result.duration).toBeGreaterThan(0)

    // Should have launch + formation + land = 3 nodes
    const nodes = useGraphStore.getState().nodes
    expect(nodes.length).toBe(3)
    expect(nodes.filter((n) => n.type === 'launch').length).toBe(1)
    expect(nodes.filter((n) => n.type === 'formation').length).toBe(1)
    expect(nodes.filter((n) => n.type === 'land').length).toBe(1)

    // Should have 2 edges
    expect(useGraphStore.getState().edges.length).toBe(2)

    // Drone count should be set
    expect(useProjectStore.getState().dronePool.droneCount).toBe(50)
  })

  it('builds a multi-act show with transitions', () => {
    const outline: ShowOutline = {
      name: 'Multi Act',
      droneCount: 100,
      acts: [
        {
          label: 'Act 1 — Opening',
          formations: [{
            name: 'Opening Ring',
            generator: { type: 'ring', params: { count: 100, radius: 12 } },
            duration: 8,
            altitude: 15,
            colorProgramId: 'rainbow',
          }],
          transition: { strategyId: 'spiral', duration: 3 },
        },
        {
          label: 'Act 2 — Star',
          formations: [{
            name: 'Star',
            generator: { type: 'star', params: { count: 100, points_n: 5, outerRadius: 15, innerRadius: 6 } },
            duration: 10,
            altitude: 20,
          }],
          transition: { strategyId: 'explosion', parameters: { maxRadius: 15 }, duration: 4 },
        },
        {
          label: 'Act 3 — Finale',
          formations: [{
            name: 'Grand Sphere',
            generator: { type: 'sphere', params: { count: 100, radius: 18 } },
            duration: 12,
            altitude: 22,
            colorProgramId: 'chase-rgb',
          }],
        },
      ],
    }

    const result = buildShowFromOutline(outline)
    expect(result.summary).toContain('3 formations')
    expect(result.summary).toContain('2 transitions')
    expect(result.formationIds.size).toBe(3)

    const nodes = useGraphStore.getState().nodes
    // launch + 3 formations + land = 5 (transitions live on edges, not as nodes)
    expect(nodes.length).toBe(5)
    // Two flow edges should carry an explicit non-default transition config.
    const edges = useGraphStore.getState().edges
    const edgesWithTransition = edges.filter((e) => e.edgeType === 'flow' && e.transition !== undefined)
    expect(edgesWithTransition.length).toBeGreaterThanOrEqual(2)

    // Verify formations have correct color programs
    const formNodes = nodes.filter((n) => n.type === 'formation')
    const openingNode = formNodes.find((n) => {
      const fId = (n.data as { formationId: string }).formationId
      const form = useFormationStore.getState().getFormation(fId)
      return form?.name === 'Opening Ring'
    })
    expect(openingNode).toBeDefined()
    expect((openingNode!.data as { colorProgramId: string | null }).colorProgramId).toBe('rainbow')
  })

  it('applies keyframes', () => {
    const outline: ShowOutline = {
      name: 'Keyframe Test',
      droneCount: 50,
      acts: [{
        label: 'Act 1',
        formations: [{
          name: 'Animated Ring',
          generator: { type: 'ring', params: { count: 50, radius: 10 } },
          duration: 10,
          altitude: 15,
          keyframes: [
            { time: 5, rotation: { y: 3.14 }, easing: 'ease-in-out' },
            { time: 9, scale: { x: 1.5, y: 1.5, z: 1.5 } },
          ],
        }],
      }],
    }

    buildShowFromOutline(outline)
    const formNode = useGraphStore.getState().nodes.find((n) => n.type === 'formation')
    expect(formNode).toBeDefined()
    const kfs = (formNode!.data as { keyframes: unknown[] }).keyframes
    expect(kfs.length).toBe(2)
  })

  it('attaches idle behaviors', () => {
    const outline: ShowOutline = {
      name: 'Idle Test',
      droneCount: 100,
      acts: [{
        label: 'Act 1',
        formations: [{
          name: 'Ring with Sparkle',
          generator: { type: 'ring', params: { count: 50, radius: 10 } },
          duration: 8,
          altitude: 15,
          idleBehavior: { behavior: 'sparkle', radius: 5, speed: 1 },
        }],
      }],
    }

    buildShowFromOutline(outline)
    const formNode = useGraphStore.getState().nodes.find((n) => n.type === 'formation')
    const idleConfigs = (formNode!.data as { idleConfigs: unknown[] }).idleConfigs
    expect(idleConfigs.length).toBe(1)
  })

  it('returns summary with correct stats', () => {
    const outline: ShowOutline = {
      name: 'Summary Test',
      droneCount: 80,
      acts: [
        { label: 'A1', formations: [{ name: 'R1', generator: { type: 'ring', params: { count: 80, radius: 8 } }, duration: 6, altitude: 15 }], transition: { strategyId: 'morph', duration: 3 } },
        { label: 'A2', formations: [{ name: 'R2', generator: { type: 'sphere', params: { count: 80, radius: 10 } }, duration: 8, altitude: 20 }] },
      ],
    }

    const result = buildShowFromOutline(outline)
    expect(result.summary).toContain('Summary Test')
    expect(result.summary).toContain('2 formations')
    expect(result.summary).toContain('1 transitions')
    expect(result.summary).toContain('80 drones')
    expect(result.duration).toBeGreaterThan(15)
    expect(typeof result.violations).toBe('number')
  })
})
