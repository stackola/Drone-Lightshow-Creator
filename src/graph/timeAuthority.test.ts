import { describe, it, expect } from 'vitest'
import { getNodeTimeRange, setNodeTime, deriveCanvasX, deriveTimeFromCanvasX } from './timeAuthority'
import { makeLaunchNode, makeFormationNode, makeLandNode } from './helpers.test-utils'

describe('G-02: Time Authority', () => {
  it('getNodeTimeRange reads from data, not position', () => {
    const node = makeFormationNode({ id: 'f1' })
    node.position.x = 99999 // Wrong position — should not matter
    const range = getNodeTimeRange(node)
    expect(range).toEqual({ start: 3, end: 8 }) // from data: startTime=3, duration=5
  })

  it('getNodeTimeRange returns null for land nodes', () => {
    const node = makeLandNode({ id: 'l1' })
    expect(getNodeTimeRange(node)).toBeNull()
  })

  it('getNodeTimeRange works for launch nodes', () => {
    const node = makeLaunchNode({ id: 'la1' })
    const range = getNodeTimeRange(node)
    expect(range).not.toBeNull()
    expect(range!.start).toBe(0)
    // end = startTime + droneCount * staggerDelay = 0 + 100 * 0.02 = 2
    expect(range!.end).toBe(2)
  })

  it('setNodeTime updates data.startTime without touching position', () => {
    const node = makeFormationNode({ id: 'f1' })
    node.position.x = 200
    const updated = setNodeTime(node, 10)
    expect((updated.data as any).startTime).toBe(10)
    expect(updated.position.x).toBe(200) // Position unchanged
  })

  it('deriveCanvasX → deriveTimeFromCanvasX round-trip', () => {
    const pxPerSecond = 100
    const time = 7.5
    const x = deriveCanvasX(time, pxPerSecond)
    const roundTrip = deriveTimeFromCanvasX(x, pxPerSecond)
    expect(roundTrip).toBeCloseTo(time, 10)
  })

  it('deriveTimeFromCanvasX → deriveCanvasX round-trip', () => {
    const pxPerSecond = 80
    const x = 640
    const time = deriveTimeFromCanvasX(x, pxPerSecond)
    const roundTrip = deriveCanvasX(time, pxPerSecond)
    expect(roundTrip).toBeCloseTo(x, 10)
  })

  it('manually setting position.x does NOT affect getNodeTimeRange', () => {
    const node = makeFormationNode({ id: 'f1' })
    const before = getNodeTimeRange(node)
    node.position.x = -5000
    const after = getNodeTimeRange(node)
    expect(after).toEqual(before)
  })

  it('deriveCanvasX with zero time returns zero', () => {
    expect(deriveCanvasX(0, 100)).toBe(0)
  })
})
