import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore, generateHomePositions } from './projectStore'

function resetStore() {
  useProjectStore.setState({
    meta: { id: 'test', name: 'Test', createdAt: '', modifiedAt: '' },
    dronePool: { droneCount: 100, launchLayout: 'grid', spacing: 2, homePositions: generateHomePositions(100, 'grid', 2) },
    constraints: { maxVelocity: 8, maxAcceleration: 4, minDroneDistance: 1.5, altitudeMin: 0, altitudeMax: 120, geofenceRadius: 200, maxFlightTime: 1200, windSpeed: 0, maxJerk: 20, maxAscentRate: 4, maxDescentRate: 3, windGustFactor: 1.5, safetyMarginVelocity: 0.1, safetyMarginSpacing: 0.5, batteryReserve: 0.15, gpsAccuracy: 1.5, geofencePolygon: [] },
  })
}

describe('S1-08: projectStore', () => {
  beforeEach(resetStore)

  it('setDroneCount regenerates home positions', () => {
    useProjectStore.getState().setDroneCount(50)
    const state = useProjectStore.getState()
    expect(state.dronePool.droneCount).toBe(50)
    expect(state.dronePool.homePositions).toHaveLength(50)
  })

  it('default constraints are present', () => {
    const c = useProjectStore.getState().constraints
    expect(c.maxVelocity).toBeGreaterThan(0)
    expect(c.minDroneDistance).toBeGreaterThan(0)
    expect(c.altitudeMax).toBeGreaterThan(c.altitudeMin)
  })

  it('generateHomePositions grid layout produces correct count', () => {
    const positions = generateHomePositions(25, 'grid', 2)
    expect(positions).toHaveLength(25)
    // Grid should be 5x5
    expect(positions[0]!.y).toBe(0) // Ground level
  })

  it('generateHomePositions line layout', () => {
    const positions = generateHomePositions(10, 'line', 2)
    expect(positions).toHaveLength(10)
    // All z should be 0
    for (const p of positions) {
      expect(p.z).toBe(0)
    }
  })

  it('generateHomePositions circle layout', () => {
    const positions = generateHomePositions(10, 'circle', 2)
    expect(positions).toHaveLength(10)
    // All at ground level
    for (const p of positions) {
      expect(p.y).toBe(0)
    }
  })
})
