// AI Engine — 4 tools for formation generation + system prompt
// Tools: set_formation, modify_drones, get_state, validate

import { useFormationStore, type Drone, type PositionKeyframe, type ColorKeyframe } from '../stores/formationStore'
import { validate } from './validator'

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
  execute: (params: Record<string, unknown>) => ToolResult
}

const FPS = 24

// ── Tools ───────────────────────────────────────────────────────────────────

const tools: ToolDef[] = [
  {
    name: 'set_formation',
    description: `Set the entire drone formation. You compute all drone positions and colors. Replaces any existing formation.

Time is in seconds (converted to frames at 24 FPS internally). Positions in meters (ENU: X=East, Y=North, Z=Up). Colors RGBW 0-255 (W = white LED, additive with RGB).

Keep drone count ≤ 50 for animated formations (you must output every track). For static shapes you can use more — just provide one position keyframe per drone.

IMPORTANT: You must compute actual numbers. Output real coordinates for every drone.`,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Formation name' },
        drones: {
          type: 'array',
          description: 'One entry per drone. Array length = drone count.',
          items: {
            type: 'object',
            properties: {
              positionKeyframes: {
                type: 'array', description: 'Position over time',
                items: { type: 'object', properties: { time: { type: 'number', description: 'seconds' }, x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
              },
              colorKeyframes: {
                type: 'array', description: 'Color over time (RGBW 0-255). Optional.',
                items: { type: 'object', properties: { time: { type: 'number' }, r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' }, w: { type: 'number' } } },
              },
            },
          },
        },
      },
      required: ['name', 'drones'],
    },
    execute: (params) => {
      const name = params.name as string
      const rawDrones = params.drones as Array<{
        positionKeyframes?: Array<{ time: number; x: number; y: number; z: number }>
        colorKeyframes?: Array<{ time: number; r: number; g: number; b: number; w: number }>
      }>

      if (!rawDrones?.length) return { success: false, error: 'No drones provided' }

      const drones: Drone[] = rawDrones.map((rd, i) => ({
        id: i,
        positionKeyframes: (rd.positionKeyframes ?? []).map((pk) => ({
          frame: Math.round((pk.time ?? 0) * FPS),
          x: pk.x ?? 0, y: pk.y ?? 0, z: pk.z ?? 0,
        })).sort((a, b) => a.frame - b.frame),
        colorKeyframes: (rd.colorKeyframes ?? []).map((ck) => ({
          frame: Math.round((ck.time ?? 0) * FPS),
          r: Math.round(Math.max(0, Math.min(255, ck.r ?? 255))),
          g: Math.round(Math.max(0, Math.min(255, ck.g ?? 255))),
          b: Math.round(Math.max(0, Math.min(255, ck.b ?? 255))),
          w: Math.round(Math.max(0, Math.min(255, ck.w ?? 0))),
        })).sort((a, b) => a.frame - b.frame),
      }))

      const store = useFormationStore.getState()
      store.setFormation(name, drones)

      // Auto-validate
      const violations = validate(drones, store.physicsLimits)
      useFormationStore.setState({ violations })

      return {
        success: true,
        data: {
          droneCount: drones.length,
          totalFrames: store.totalFrames,
          durationSeconds: +(store.totalFrames / FPS).toFixed(2),
          violations: violations.length,
          violationSummary: violations.length > 0
            ? violations.slice(0, 5).map((v) => `drone ${v.drone} frame ${v.frame}: ${v.type} ${v.value} > ${v.limit}`).join('; ')
            : 'All checks passed',
        },
      }
    },
  },

  {
    name: 'modify_drones',
    description: `Modify specific drones or transform all drones. Use for refinements like 'make it bigger', 'change colors', 'spin faster'.

For transformAll: scaleXYZ multiplies all positions, rotateZDegrees rotates around vertical axis, translateX/Y/Z shifts positions.`,
    input_schema: {
      type: 'object',
      properties: {
        modifications: {
          type: 'array', description: 'Per-drone changes (optional)',
          items: {
            type: 'object', properties: {
              droneIndex: { type: 'number' },
              positionKeyframes: { type: 'array', items: { type: 'object', properties: { time: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } } },
              colorKeyframes: { type: 'array', items: { type: 'object', properties: { time: { type: 'number' }, r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' }, w: { type: 'number' } } } },
            },
          },
        },
        transformAll: {
          type: 'object', description: 'Apply to ALL drones',
          properties: {
            scaleXYZ: { type: 'number' }, rotateZDegrees: { type: 'number' },
            translateX: { type: 'number' }, translateY: { type: 'number' }, translateZ: { type: 'number' },
          },
        },
      },
    },
    execute: (params) => {
      const store = useFormationStore.getState()
      if (store.drones.length === 0) return { success: false, error: 'No formation loaded. Call set_formation first.' }

      const mods = params.modifications as Array<{ droneIndex: number; positionKeyframes?: Array<{ time: number; x: number; y: number; z: number }>; colorKeyframes?: Array<{ time: number; r: number; g: number; b: number; w: number }> }> | undefined
      if (mods?.length) {
        store.modifyDrones(mods.map((m) => ({
          droneIndex: m.droneIndex,
          positionKeyframes: m.positionKeyframes?.map((pk) => ({ frame: Math.round(pk.time * FPS), x: pk.x, y: pk.y, z: pk.z })),
          colorKeyframes: m.colorKeyframes?.map((ck) => ({ frame: Math.round(ck.time * FPS), r: Math.round(ck.r), g: Math.round(ck.g), b: Math.round(ck.b), w: Math.round(ck.w) })),
        })))
      }

      const t = params.transformAll as { scaleXYZ?: number; rotateZDegrees?: number; translateX?: number; translateY?: number; translateZ?: number } | undefined
      if (t) store.transformAll(t)

      // Re-validate
      const violations = validate(useFormationStore.getState().drones, store.physicsLimits)
      useFormationStore.setState({ violations })

      return { success: true, data: { droneCount: store.drones.length, violations: violations.length } }
    },
  },

  {
    name: 'get_state',
    description: 'Get current formation summary: drone count, duration, bounds, validation status.',
    input_schema: { type: 'object', properties: {} },
    execute: () => {
      const { drones, totalFrames, name, violations } = useFormationStore.getState()
      if (drones.length === 0) return { success: true, data: { empty: true, message: 'No formation loaded' } }

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const d of drones) for (const kf of d.positionKeyframes) {
        if (kf.x < minX) minX = kf.x; if (kf.x > maxX) maxX = kf.x
        if (kf.y < minY) minY = kf.y; if (kf.y > maxY) maxY = kf.y
        if (kf.z < minZ) minZ = kf.z; if (kf.z > maxZ) maxZ = kf.z
      }

      return {
        success: true,
        data: {
          name, droneCount: drones.length,
          durationSeconds: +(totalFrames / FPS).toFixed(2),
          totalFrames,
          bounds: { minX: +minX.toFixed(1), maxX: +maxX.toFixed(1), minY: +minY.toFixed(1), maxY: +maxY.toFixed(1), minZ: +minZ.toFixed(1), maxZ: +maxZ.toFixed(1) },
          hasAnimation: drones.some((d) => d.positionKeyframes.length > 1),
          hasColors: drones.some((d) => d.colorKeyframes.length > 0),
          violations: violations.length,
        },
      }
    },
  },

  {
    name: 'validate',
    description: 'Run physics validation (velocity, acceleration, spacing). Returns violations if any.',
    input_schema: { type: 'object', properties: {} },
    execute: () => {
      const { drones, physicsLimits } = useFormationStore.getState()
      if (drones.length === 0) return { success: true, data: { valid: true, violations: [] } }
      const violations = validate(drones, physicsLimits)
      useFormationStore.setState({ violations })
      return { success: true, data: { valid: violations.length === 0, count: violations.length, violations: violations.slice(0, 20) } }
    },
  },
]

// ── Public API ──────────────────────────────────────────────────────────────

export function getToolDefinitions() {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
}

export function executeTool(name: string, params: Record<string, unknown>): ToolResult {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { success: false, error: `Unknown tool: ${name}` }
  try {
    return tool.execute(params)
  } catch (e) {
    return { success: false, error: `Tool error: ${(e as Error).message}` }
  }
}

export function getSystemPrompt(): string {
  return `You create drone light show formations. You directly compute 3D positions and colors for each drone.

Coordinate system: ENU (East-North-Up). X=East, Y=North, Z=Up. Units: meters.
Time: specify in seconds (converted to frames at 24 FPS internally).
Colors: RGBW, each 0-255. R/G/B are color LEDs, W is a separate white LED (additive — adds brightness to all channels). For pure white use R=0,G=0,B=0,W=255. For pure colors set W=0.

Physics limits (must pass validation):
- Max horizontal velocity: 3.5 m/s
- Max vertical velocity: 3.5 m/s (up and down)
- Max acceleration: 1.5 m/s²
- Min drone spacing: 1.5 meters

Design approach:
1. Think about the shape geometrically. Break it into curves/lines/circles.
2. Sample points along those curves at ≥1.5m spacing.
3. For animation: compute each drone's position at multiple times (2-4 keyframes minimum).
4. For spinning: rotate positions around Z axis: x'=x*cos(θ)-y*sin(θ), y'=x*sin(θ)+y*cos(θ)
5. For colors: assign RGBW based on position, index, or time.
6. After set_formation, check the violation count in the response. If violations > 0, call validate for details and fix.
7. Keep drone count ≤ 50 for animated formations.

IMPORTANT: Compute actual coordinates. Don't describe — calculate. Output real numbers for every drone.`
}
