// ============================================================================
// AI Formation Generator — Class A Feature
// ============================================================================
// Lets the AI create fully animated per-drone formations from text descriptions.
// The AI directly computes Vec3 positions and Color3 values for each drone
// at each keyframe time, producing rich animated formations.
//
// Two tools:
//   1. generate_custom_formation — AI computes a static point cloud
//   2. generate_animated_formation — AI computes per-drone keyframed animation
//      with position + color tracks, playback mode, and full 3D motion
//
// These tools accept the raw data (points/tracks) as parameters. The AI
// fills these out using its spatial reasoning capabilities.
// ============================================================================

import { useFormationStore } from '../stores/formationStore'
import { registerTool } from './aiToolEngine'
import type { Vec3 } from '../graph/types'
import type { AnimatedFormationDef, DroneTrack, PositionKeyframe, ColorKeyframe, PlaybackConfig } from '../graph/animatedFormation'

// ── generate_custom_formation — static point cloud from AI ──────────────────

registerTool({
  name: 'generate_custom_formation',
  description: `Generate a custom formation by directly specifying 3D positions for each drone. Use this when no built-in generator matches the desired shape (e.g., logos, letters, custom symbols, artistic shapes).

You must compute the {x, y, z} positions yourself based on the user's description. Think spatially:
- x = left/right, y = up/down (altitude), z = forward/backward
- Typical formation spans: 10-30m wide, centered near origin
- Minimum spacing between drones: ~1.5m
- y=0 is ground level, formations are typically at y=0 (altitude is set by the formation node)

For text/logos: arrange drones along the outline of each character/shape.
For symbols: use parametric curves, geometric constructions, or sampled paths.
For abstract shapes: use mathematical functions or artistic arrangements.`,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Formation name (e.g., "BMW Logo", "Spiral Galaxy")' },
      points: {
        type: 'array',
        description: 'Array of {x, y, z} positions for each drone. Length determines drone count.',
        items: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X position (meters, left/right)' },
            y: { type: 'number', description: 'Y position (meters, up/down relative to formation center)' },
            z: { type: 'number', description: 'Z position (meters, forward/backward)' },
          },
        },
      },
      tags: {
        type: 'array',
        description: 'Optional tags for categorization',
        items: { type: 'string' },
      },
    },
    required: ['name', 'points'],
  },
  isWriteTool: true,
  execute: (params) => {
    const name = params.name as string
    const points = params.points as Vec3[]
    const tags = (params.tags as string[]) ?? ['AI-generated']

    if (!points || points.length === 0) {
      return { success: false, error: 'Points array is empty. Provide at least 1 drone position.' }
    }

    // Validate and sanitize points
    const sanitized: Vec3[] = points.map((p) => ({
      x: typeof p.x === 'number' ? p.x : 0,
      y: typeof p.y === 'number' ? p.y : 0,
      z: typeof p.z === 'number' ? p.z : 0,
    }))

    // Create formation via store
    const store = useFormationStore.getState()
    const id = store.addFormation(name, 'grid', { count: sanitized.length, cols: 1, spacing: 1 })
    useFormationStore.setState((s) => {
      s.generatedPoints.set(id, sanitized)
      const f = s.formations.find((f) => f.id === id)
      if (f) {
        f.pointCount = sanitized.length
        f.tags = tags
      }
    })

    return {
      success: true,
      data: {
        formationId: id,
        name,
        droneCount: sanitized.length,
        bounds: computeBounds(sanitized),
      },
    }
  },
})

// ── generate_animated_formation — full per-drone animation from AI ──────────

registerTool({
  name: 'generate_animated_formation',
  description: `Generate a fully animated formation with per-drone position and color keyframes. This is the most powerful formation tool — each drone gets independent animation tracks.

Use this for:
- Spinning logos (drones rotate around center)
- Morphing shapes (drones move from one shape to another within the formation)
- Color-animated text (letters that change color in sequence)
- Pulsing/breathing effects with precise control
- Any complex choreography within a single formation

Each drone gets:
- Position keyframes: [{time, value: {x,y,z}, easing}] — where drones move
- Color keyframes: [{time, value: {r,g,b}, mode}] — how drones change color

Playback modes:
- "clamp": play once, hold last frame
- "loop": repeat forever (great for spinning)
- "boomerang": play forward then backward (great for pulsing)

Tips:
- For spinning: set each drone's position keyframes in a circle at t=0 and rotated at t=duration
- For color waves: stagger color keyframe times across drones by index
- Keep positions in a ~20m radius, y=0 centered (formation node controls altitude)
- Use 2-4 keyframes per track for smooth motion
- Duration 5-15s is typical`,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Formation name' },
      duration: { type: 'number', description: 'Animation duration in seconds' },
      droneCount: { type: 'number', description: 'Number of drones' },
      playbackMode: { type: 'string', description: 'clamp, loop, or boomerang', enum: ['clamp', 'loop', 'boomerang'] },
      playbackSpeed: { type: 'number', description: 'Speed multiplier (default 1)' },
      tracks: {
        type: 'array',
        description: 'One track per drone. Array length must equal droneCount.',
        items: {
          type: 'object',
          description: 'Animation track for one drone',
          properties: {
            positionKeyframes: {
              type: 'array',
              description: 'Position keyframes for this drone',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'number', description: 'Time in seconds' },
                  value: {
                    type: 'object',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' },
                      z: { type: 'number' },
                    },
                  },
                  easing: { type: 'string', description: 'linear, ease-in, ease-out, ease-in-out, step' },
                },
              },
            },
            colorKeyframes: {
              type: 'array',
              description: 'Color keyframes for this drone (optional)',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'number', description: 'Time in seconds' },
                  value: {
                    type: 'object',
                    properties: {
                      r: { type: 'number', description: '0-1' },
                      g: { type: 'number', description: '0-1' },
                      b: { type: 'number', description: '0-1' },
                    },
                  },
                  mode: { type: 'string', description: 'lerp or step', enum: ['lerp', 'step'] },
                },
              },
            },
          },
        },
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['name', 'duration', 'droneCount', 'tracks'],
  },
  isWriteTool: true,
  execute: (params) => {
    const name = params.name as string
    const duration = params.duration as number
    const droneCount = params.droneCount as number
    const rawTracks = params.tracks as Array<{
      positionKeyframes?: Array<{ time: number; value: Vec3; easing?: string }>
      colorKeyframes?: Array<{ time: number; value: { r: number; g: number; b: number }; mode?: string }>
    }>
    const playbackMode = (params.playbackMode as string) ?? 'clamp'
    const playbackSpeed = (params.playbackSpeed as number) ?? 1
    const tags = (params.tags as string[]) ?? ['AI-generated', 'animated']

    if (!rawTracks || rawTracks.length === 0) {
      return { success: false, error: 'Tracks array is empty.' }
    }

    if (rawTracks.length !== droneCount) {
      return { success: false, error: `Track count (${rawTracks.length}) must equal droneCount (${droneCount})` }
    }

    // Build AnimatedFormationDef
    const tracks: DroneTrack[] = rawTracks.map((rt) => ({
      positionKeyframes: (rt.positionKeyframes ?? []).map((pk) => ({
        time: pk.time,
        value: { x: pk.value?.x ?? 0, y: pk.value?.y ?? 0, z: pk.value?.z ?? 0 },
        easing: (pk.easing ?? 'linear') as PositionKeyframe['easing'],
      })),
      colorKeyframes: (rt.colorKeyframes ?? []).map((ck) => ({
        time: ck.time,
        value: { r: ck.value?.r ?? 1, g: ck.value?.g ?? 1, b: ck.value?.b ?? 1 },
        mode: (ck.mode ?? 'lerp') as ColorKeyframe['mode'],
      })),
    }))

    const playback: PlaybackConfig = {
      mode: playbackMode as PlaybackConfig['mode'],
      speed: Math.max(0.1, playbackSpeed),
      trimIn: 0,
      trimOut: 0,
    }

    const def: AnimatedFormationDef = {
      duration,
      droneCount,
      tracks,
      playback,
    }

    // Add to store
    const store = useFormationStore.getState()
    const id = store.addAnimatedFormation(name, def, tags)

    // Compute stats
    const totalPosKf = tracks.reduce((sum, t) => sum + t.positionKeyframes.length, 0)
    const totalColorKf = tracks.reduce((sum, t) => sum + t.colorKeyframes.length, 0)

    return {
      success: true,
      data: {
        formationId: id,
        name,
        droneCount,
        duration,
        playbackMode,
        totalPositionKeyframes: totalPosKf,
        totalColorKeyframes: totalColorKf,
        message: `Created animated formation "${name}" with ${droneCount} drones, ${totalPosKf} position keyframes, ${totalColorKf} color keyframes, ${duration}s duration, ${playbackMode} playback.`,
      },
    }
  },
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeBounds(points: Vec3[]): { min: Vec3; max: Vec3; span: Vec3 } {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    span: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
  }
}
