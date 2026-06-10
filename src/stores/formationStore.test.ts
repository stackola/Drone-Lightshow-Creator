// Note: formationStore.addFormation calls into the generator registry, but
// we exercise the *non-generator* paths here (addAnimatedFormation,
// removeFormation, updateFormation, loadFormations, get*). The generator
// integration is already covered by registries/generators.test.ts.

import { describe, it, expect, beforeEach } from 'vitest'
import { useFormationStore } from './formationStore'
import type { AnimatedFormationDef } from '../graph/animatedFormation'

function reset() {
  useFormationStore.setState({
    formations: [],
    generatedPoints: new Map(),
    animatedDefs: new Map(),
  })
}

function makeAnimDef(droneCount = 3): AnimatedFormationDef {
  return {
    duration: 4,
    droneCount,
    tracks: Array.from({ length: droneCount }, (_, i) => ({
      positionKeyframes: [
        { time: 0, value: { x: i, y: 0, z: 0 }, easing: 'linear' as const },
        { time: 4, value: { x: i, y: 10, z: 0 }, easing: 'linear' as const },
      ],
      colorKeyframes: [{ time: 0, value: { r: 1, g: 1, b: 1 }, mode: 'lerp' as const }],
    })),
    playback: { mode: 'loop', speed: 1, trimIn: 0, trimOut: 0 },
  }
}

describe('formationStore', () => {
  beforeEach(reset)

  it('starts empty', () => {
    const s = useFormationStore.getState()
    expect(s.formations).toEqual([])
    expect(s.generatedPoints.size).toBe(0)
    expect(s.animatedDefs.size).toBe(0)
  })

  it('addAnimatedFormation registers def + rest positions + formation row', () => {
    const id = useFormationStore.getState().addAnimatedFormation('Shake', makeAnimDef(5))
    const s = useFormationStore.getState()
    expect(s.formations.length).toBe(1)
    expect(s.formations[0]?.id).toBe(id)
    expect(s.formations[0]?.type).toBe('animated')
    expect(s.formations[0]?.pointCount).toBe(5)
    expect(s.animatedDefs.has(id)).toBe(true)
    expect(s.generatedPoints.get(id)?.length).toBe(5)
  })

  it('removeFormation drops the row + cached points + animated def', () => {
    const id = useFormationStore.getState().addAnimatedFormation('X', makeAnimDef(2))
    useFormationStore.getState().removeFormation(id)
    const s = useFormationStore.getState()
    expect(s.formations.length).toBe(0)
    expect(s.generatedPoints.has(id)).toBe(false)
    expect(s.animatedDefs.has(id)).toBe(false)
  })

  it('updateFormation patches name/tags but ignores id (prevents reference corruption)', () => {
    const id = useFormationStore.getState().addAnimatedFormation('Original', makeAnimDef(2))
    useFormationStore.getState().updateFormation(id, { name: 'Renamed', tags: ['hero'] })
    // Try to corrupt the id — should be ignored.
    useFormationStore.getState().updateFormation(id, { id: 'malicious' } as never)
    const f = useFormationStore.getState().formations[0]!
    expect(f.id).toBe(id)
    expect(f.name).toBe('Renamed')
    expect(f.tags).toEqual(['hero'])
  })

  it('updateAnimatedDef refreshes rest positions and pointCount', () => {
    const id = useFormationStore.getState().addAnimatedFormation('X', makeAnimDef(2))
    useFormationStore.getState().updateAnimatedDef(id, makeAnimDef(7))
    const s = useFormationStore.getState()
    expect(s.formations[0]?.pointCount).toBe(7)
    expect(s.generatedPoints.get(id)?.length).toBe(7)
  })

  it('getFormation + getPoints + getAnimatedDef lookups round-trip', () => {
    const id = useFormationStore.getState().addAnimatedFormation('Hello', makeAnimDef(3))
    const s = useFormationStore.getState()
    expect(s.getFormation(id)?.name).toBe('Hello')
    expect(s.getPoints(id)?.length).toBe(3)
    expect(s.getAnimatedDef(id)?.duration).toBe(4)
    expect(s.getFormation('nope')).toBeUndefined()
  })

  it('regeneratePoints on an animated formation refreshes rest positions from the cached def', () => {
    const id = useFormationStore.getState().addAnimatedFormation('A', makeAnimDef(3))
    // Stomp the cached points to confirm regenerate recomputes them.
    useFormationStore.setState((s) => {
      s.generatedPoints.set(id, [])
    })
    expect(useFormationStore.getState().generatedPoints.get(id)?.length).toBe(0)
    useFormationStore.getState().regeneratePoints(id)
    expect(useFormationStore.getState().generatedPoints.get(id)?.length).toBe(3)
  })

  it('regeneratePoints on an unknown id is a no-op (no throw)', () => {
    expect(() => useFormationStore.getState().regeneratePoints('does-not-exist')).not.toThrow()
  })

  it('loadFormations replaces store contents wholesale', () => {
    useFormationStore.getState().addAnimatedFormation('A', makeAnimDef(2))
    useFormationStore.getState().loadFormations(
      [{ id: 'fresh', name: 'Loaded', type: 'static', generatorId: 'ring', parameters: { count: 50, radius: 5 }, pointCount: 50, tags: [] }],
      new Map([['fresh', Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0, z: 0 }))]]),
      new Map(),
    )
    const s = useFormationStore.getState()
    expect(s.formations.length).toBe(1)
    expect(s.formations[0]?.id).toBe('fresh')
    expect(s.generatedPoints.size).toBe(1)
    expect(s.animatedDefs.size).toBe(0)
  })
})
