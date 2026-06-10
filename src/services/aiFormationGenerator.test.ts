// ============================================================================
// Tests: AI Formation Generator — custom + animated formation tools
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { executeTool } from './aiToolEngine'
import './aiWriteTools' // registers all write tools including formation generator
import { useFormationStore } from '../stores/formationStore'
import { initRegistries } from '../registries/init'

initRegistries()

function reset() {
  useFormationStore.getState().loadFormations([], new Map())
}

describe('generate_custom_formation tool', () => {
  beforeEach(reset)

  it('creates a static formation from AI-provided points', () => {
    // Simulate AI computing a simple triangle
    const points = [
      { x: 0, y: 0, z: 10 },
      { x: -8.66, y: 0, z: -5 },
      { x: 8.66, y: 0, z: -5 },
    ]
    const result = executeTool('generate_custom_formation', {
      name: 'Triangle',
      points,
      tags: ['AI-generated', 'geometric'],
    })
    expect(result.success).toBe(true)
    const d = result.data as { formationId: string; droneCount: number; bounds: unknown }
    expect(d.droneCount).toBe(3)
    expect(d.formationId).toBeTruthy()

    // Verify points are stored
    const storedPts = useFormationStore.getState().getPoints(d.formationId)
    expect(storedPts!.length).toBe(3)
    expect(storedPts![0]!.x).toBe(0)
    expect(storedPts![0]!.z).toBe(10)
  })

  it('creates a ring of 50 drones from computed positions', () => {
    const n = 50
    const radius = 10
    const points = Array.from({ length: n }, (_, i) => ({
      x: Math.cos((i / n) * Math.PI * 2) * radius,
      y: 0,
      z: Math.sin((i / n) * Math.PI * 2) * radius,
    }))
    const result = executeTool('generate_custom_formation', { name: 'AI Ring', points })
    expect(result.success).toBe(true)
    expect((result.data as { droneCount: number }).droneCount).toBe(50)
  })

  it('rejects empty points array', () => {
    const result = executeTool('generate_custom_formation', { name: 'Empty', points: [] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('empty')
  })
})

describe('generate_animated_formation tool', () => {
  beforeEach(reset)

  it('creates a spinning ring animation', () => {
    const n = 10
    const radius = 8
    const duration = 10
    const tracks = Array.from({ length: n }, (_, i) => {
      const baseAngle = (i / n) * Math.PI * 2
      return {
        positionKeyframes: [
          { time: 0, value: { x: Math.cos(baseAngle) * radius, y: 0, z: Math.sin(baseAngle) * radius }, easing: 'linear' },
          { time: duration, value: { x: Math.cos(baseAngle + Math.PI * 2) * radius, y: 0, z: Math.sin(baseAngle + Math.PI * 2) * radius }, easing: 'linear' },
        ],
        colorKeyframes: [
          { time: 0, value: { r: 1, g: 0.2, b: 0.2 }, mode: 'lerp' },
          { time: duration / 2, value: { r: 0.2, g: 0.2, b: 1 }, mode: 'lerp' },
          { time: duration, value: { r: 1, g: 0.2, b: 0.2 }, mode: 'lerp' },
        ],
      }
    })

    const result = executeTool('generate_animated_formation', {
      name: 'Spinning Ring',
      duration,
      droneCount: n,
      playbackMode: 'loop',
      tracks,
    })
    expect(result.success).toBe(true)
    const d = result.data as {
      formationId: string
      droneCount: number
      totalPositionKeyframes: number
      totalColorKeyframes: number
      playbackMode: string
    }
    expect(d.droneCount).toBe(10)
    expect(d.totalPositionKeyframes).toBe(20) // 10 drones * 2 keyframes
    expect(d.totalColorKeyframes).toBe(30) // 10 drones * 3 keyframes
    expect(d.playbackMode).toBe('loop')

    // Verify it's stored as animated
    const form = useFormationStore.getState().getFormation(d.formationId)
    expect(form!.type).toBe('animated')
    const animDef = useFormationStore.getState().getAnimatedDef(d.formationId)
    expect(animDef!.duration).toBe(10)
    expect(animDef!.tracks.length).toBe(10)
    expect(animDef!.playback.mode).toBe('loop')
  })

  it('creates a color wave animation', () => {
    const n = 20
    const radius = 10
    const duration = 5
    const tracks = Array.from({ length: n }, (_, i) => {
      const angle = (i / n) * Math.PI * 2
      const delay = (i / n) * 2 // stagger color by 2 seconds
      return {
        positionKeyframes: [
          { time: 0, value: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius }, easing: 'linear' },
        ],
        colorKeyframes: [
          { time: delay, value: { r: 0, g: 1, b: 0 }, mode: 'lerp' },
          { time: delay + 1, value: { r: 1, g: 0, b: 0 }, mode: 'lerp' },
          { time: delay + 2, value: { r: 0, g: 1, b: 0 }, mode: 'lerp' },
        ],
      }
    })

    const result = executeTool('generate_animated_formation', {
      name: 'Color Wave',
      duration,
      droneCount: n,
      playbackMode: 'loop',
      tracks,
    })
    expect(result.success).toBe(true)
    expect((result.data as { totalColorKeyframes: number }).totalColorKeyframes).toBe(60) // 20*3
  })

  it('rejects mismatched track count', () => {
    const result = executeTool('generate_animated_formation', {
      name: 'Bad',
      duration: 5,
      droneCount: 10,
      tracks: [{ positionKeyframes: [], colorKeyframes: [] }], // only 1 track for 10 drones
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('must equal droneCount')
  })

  it('handles boomerang playback', () => {
    const tracks = Array.from({ length: 5 }, (_, i) => ({
      positionKeyframes: [
        { time: 0, value: { x: i * 3, y: 0, z: 0 }, easing: 'ease-in-out' },
        { time: 3, value: { x: i * 3, y: 5, z: 0 }, easing: 'ease-in-out' },
      ],
      colorKeyframes: [],
    }))

    const result = executeTool('generate_animated_formation', {
      name: 'Boomerang Pulse',
      duration: 3,
      droneCount: 5,
      playbackMode: 'boomerang',
      playbackSpeed: 2,
      tracks,
    })
    expect(result.success).toBe(true)
    const animDef = useFormationStore.getState().getAnimatedDef(
      (result.data as { formationId: string }).formationId,
    )
    expect(animDef!.playback.mode).toBe('boomerang')
    expect(animDef!.playback.speed).toBe(2)
  })
})
