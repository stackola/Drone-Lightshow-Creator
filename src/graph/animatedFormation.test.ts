import { describe, it, expect } from 'vitest'
import {
  computeAnimationTime,
  interpolateDronePosition,
  interpolateDroneColor,
  sampleAnimatedFormation,
  getAnimatedFormationRestPositions,
  DEFAULT_PLAYBACK,
} from './animatedFormation'
import type {
  PositionKeyframe,
  ColorKeyframe,
  AnimatedFormationDef,
  PlaybackConfig,
} from './animatedFormation'

// ---------------------------------------------------------------------------
// computeAnimationTime
// ---------------------------------------------------------------------------

describe('computeAnimationTime', () => {
  it('clamp: returns 0 before start', () => {
    expect(computeAnimationTime(-1, 10, DEFAULT_PLAYBACK)).toBe(0)
  })

  it('clamp: returns duration at end', () => {
    expect(computeAnimationTime(15, 10, DEFAULT_PLAYBACK)).toBe(10)
  })

  it('clamp: returns raw time in range', () => {
    expect(computeAnimationTime(5, 10, DEFAULT_PLAYBACK)).toBe(5)
  })

  it('clamp: speed multiplier', () => {
    const pb: PlaybackConfig = { ...DEFAULT_PLAYBACK, speed: 2 }
    expect(computeAnimationTime(3, 10, pb)).toBe(6)
  })

  it('clamp: speed clamps at duration', () => {
    const pb: PlaybackConfig = { ...DEFAULT_PLAYBACK, speed: 2 }
    expect(computeAnimationTime(6, 10, pb)).toBe(10)
  })

  it('loop: wraps around', () => {
    const pb: PlaybackConfig = { ...DEFAULT_PLAYBACK, mode: 'loop' }
    expect(computeAnimationTime(12, 10, pb)).toBeCloseTo(2, 5)
  })

  it('loop: wraps multiple times', () => {
    const pb: PlaybackConfig = { ...DEFAULT_PLAYBACK, mode: 'loop' }
    expect(computeAnimationTime(23, 10, pb)).toBeCloseTo(3, 5)
  })

  it('boomerang: forward half', () => {
    const pb: PlaybackConfig = { ...DEFAULT_PLAYBACK, mode: 'boomerang' }
    expect(computeAnimationTime(3, 10, pb)).toBeCloseTo(3, 5)
  })

  it('boomerang: reverse half', () => {
    const pb: PlaybackConfig = { ...DEFAULT_PLAYBACK, mode: 'boomerang' }
    expect(computeAnimationTime(13, 10, pb)).toBeCloseTo(7, 5)
  })

  it('boomerang: wraps full cycle', () => {
    const pb: PlaybackConfig = { ...DEFAULT_PLAYBACK, mode: 'boomerang' }
    // cycle = 20s; t=23 → wrapped=3 → forward
    expect(computeAnimationTime(23, 10, pb)).toBeCloseTo(3, 5)
  })

  it('trimIn shifts the window', () => {
    const pb: PlaybackConfig = { ...DEFAULT_PLAYBACK, trimIn: 2 }
    // localTime=0 → t = 0 - 2 = -2 → clamp to trimIn=2
    expect(computeAnimationTime(0, 10, pb)).toBe(2)
    // localTime=3 → t = 3 - 2 = 1 → trimIn + 1 = 3
    expect(computeAnimationTime(3, 10, pb)).toBe(3)
  })

  it('trimOut reduces effective duration', () => {
    const pb: PlaybackConfig = { ...DEFAULT_PLAYBACK, trimOut: 3 }
    // effective duration = 10 - 0 - 3 = 7
    // localTime=10 → clamped to 7
    expect(computeAnimationTime(10, 10, pb)).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// interpolateDronePosition
// ---------------------------------------------------------------------------

describe('interpolateDronePosition', () => {
  const kfs: PositionKeyframe[] = [
    { time: 0, value: { x: 0, y: 0, z: 0 }, easing: 'linear' },
    { time: 2, value: { x: 10, y: 0, z: 0 }, easing: 'linear' },
    { time: 4, value: { x: 10, y: 10, z: 0 }, easing: 'linear' },
  ]

  it('returns null for empty keyframes', () => {
    expect(interpolateDronePosition([], 0)).toBeNull()
  })

  it('returns single keyframe value', () => {
    expect(interpolateDronePosition([kfs[0]!], 5)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('clamps before first', () => {
    expect(interpolateDronePosition(kfs, -1)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('clamps after last', () => {
    expect(interpolateDronePosition(kfs, 10)).toEqual({ x: 10, y: 10, z: 0 })
  })

  it('lerps midway in first segment', () => {
    const p = interpolateDronePosition(kfs, 1)!
    expect(p.x).toBeCloseTo(5, 5)
    expect(p.y).toBeCloseTo(0, 5)
  })

  it('lerps midway in second segment', () => {
    const p = interpolateDronePosition(kfs, 3)!
    expect(p.x).toBeCloseTo(10, 5)
    expect(p.y).toBeCloseTo(5, 5)
  })

  it('step easing holds previous value', () => {
    const stepKfs: PositionKeyframe[] = [
      { time: 0, value: { x: 0, y: 0, z: 0 }, easing: 'linear' },
      { time: 2, value: { x: 10, y: 0, z: 0 }, easing: 'step' },
    ]
    const p = interpolateDronePosition(stepKfs, 1)!
    expect(p.x).toBeCloseTo(0, 5)
  })
})

// ---------------------------------------------------------------------------
// interpolateDroneColor
// ---------------------------------------------------------------------------

describe('interpolateDroneColor', () => {
  const kfs: ColorKeyframe[] = [
    { time: 0, value: { r: 1, g: 0, b: 0 }, mode: 'lerp' },
    { time: 2, value: { r: 0, g: 1, b: 0 }, mode: 'lerp' },
  ]

  it('returns null for empty keyframes', () => {
    expect(interpolateDroneColor([], 0)).toBeNull()
  })

  it('lerps colors', () => {
    const c = interpolateDroneColor(kfs, 1)!
    expect(c.r).toBeCloseTo(0.5, 5)
    expect(c.g).toBeCloseTo(0.5, 5)
  })

  it('step mode holds previous color', () => {
    const stepKfs: ColorKeyframe[] = [
      { time: 0, value: { r: 1, g: 0, b: 0 }, mode: 'lerp' },
      { time: 2, value: { r: 0, g: 1, b: 0 }, mode: 'step' },
    ]
    const c = interpolateDroneColor(stepKfs, 1)!
    expect(c.r).toBeCloseTo(1, 5)
    expect(c.g).toBeCloseTo(0, 5)
  })
})

// ---------------------------------------------------------------------------
// sampleAnimatedFormation
// ---------------------------------------------------------------------------

describe('sampleAnimatedFormation', () => {
  const def: AnimatedFormationDef = {
    duration: 4,
    droneCount: 2,
    tracks: [
      {
        positionKeyframes: [
          { time: 0, value: { x: 0, y: 0, z: 0 }, easing: 'linear' },
          { time: 4, value: { x: 10, y: 0, z: 0 }, easing: 'linear' },
        ],
        colorKeyframes: [
          { time: 0, value: { r: 1, g: 0, b: 0 }, mode: 'lerp' },
        ],
      },
      {
        positionKeyframes: [
          { time: 0, value: { x: 0, y: 5, z: 0 }, easing: 'linear' },
          { time: 4, value: { x: 0, y: 15, z: 0 }, easing: 'linear' },
        ],
        colorKeyframes: [],
      },
    ],
    playback: DEFAULT_PLAYBACK,
  }

  it('samples all drones at midpoint', () => {
    const { positions, colors } = sampleAnimatedFormation(def, 2)
    expect(positions[0]!.x).toBeCloseTo(5, 5)
    expect(positions[1]!.y).toBeCloseTo(10, 5)
    expect(colors[0]).toEqual({ r: 1, g: 0, b: 0 })
    expect(colors[1]).toBeNull()
  })

  it('handles loop playback', () => {
    const loopDef = { ...def, playback: { ...DEFAULT_PLAYBACK, mode: 'loop' as const } }
    const { positions } = sampleAnimatedFormation(loopDef, 6)
    // t=6, loop over 4s → animTime = 2
    expect(positions[0]!.x).toBeCloseTo(5, 5)
  })
})

// ---------------------------------------------------------------------------
// getAnimatedFormationRestPositions
// ---------------------------------------------------------------------------

describe('getAnimatedFormationRestPositions', () => {
  it('returns first keyframe positions', () => {
    const def: AnimatedFormationDef = {
      duration: 4,
      droneCount: 2,
      tracks: [
        {
          positionKeyframes: [{ time: 0, value: { x: 1, y: 2, z: 3 }, easing: 'linear' }],
          colorKeyframes: [],
        },
        {
          positionKeyframes: [{ time: 0, value: { x: 4, y: 5, z: 6 }, easing: 'linear' }],
          colorKeyframes: [],
        },
      ],
      playback: DEFAULT_PLAYBACK,
    }
    const pts = getAnimatedFormationRestPositions(def)
    expect(pts).toEqual([{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }])
  })

  it('returns origin for missing tracks', () => {
    const def: AnimatedFormationDef = {
      duration: 1,
      droneCount: 2,
      tracks: [
        { positionKeyframes: [{ time: 0, value: { x: 1, y: 0, z: 0 }, easing: 'linear' }], colorKeyframes: [] },
      ],
      playback: DEFAULT_PLAYBACK,
    }
    const pts = getAnimatedFormationRestPositions(def)
    expect(pts[1]).toEqual({ x: 0, y: 0, z: 0 })
  })
})
