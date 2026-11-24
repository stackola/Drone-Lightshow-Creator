// Schemas for everything the model sends back: tool inputs and structured
// outputs. Numeric ranges are described rather than enforced (structured
// outputs don't support numeric constraints); converters clamp instead.

import { z } from 'zod'

export const SHAPE_KINDS = ['circle', 'heart', 'star', 'polygon', 'grid', 'spiral', 'wave', 'sphere', 'torus', 'cube', 'helix', 'cone', 'text'] as const
export const EFFECT_KINDS = ['solid', 'gradient', 'rainbow', 'pulse', 'twinkle', 'chase', 'wave', 'flash', 'strobe', 'off', 'image'] as const

const hex = z.string().describe('Hex colour, e.g. "#ff3366"')

export const LightInput = z.object({
  effect: z.enum(EFFECT_KINDS).describe(
    'solid: one colour. gradient: color → color2 across the shape. rainbow: moving hues. pulse: color on each beat fading toward color2. ' +
      'twinkle: color with random color2 sparkles. chase: color2 highlight running along the shape over a color base. ' +
      'wave: color2 band sweeping across a color base. flash: color flash (on every N beats when beat_sync). strobe: color strobe. ' +
      'off: lights off (parked drones). image: colours of an imported image (image formations only).',
  ),
  color: hex.optional().describe('Main colour'),
  color2: hex.optional().describe('Second colour (gradient end, pulse rest, twinkle sparkle, chase/wave highlight)'),
  angle: z.number().optional().describe('Direction in degrees for gradient/rainbow/wave: 0 = left→right, 90 = bottom→top'),
  speed: z.number().optional().describe('rainbow cycles/s (0.05–0.5), chase laps/s (0.1–1), wave sweeps/s (0.2–1)'),
  rate: z.number().optional().describe('twinkle or strobe frequency in Hz (twinkle 0.5–3, strobe 4–12)'),
  period: z.number().optional().describe('pulse period in seconds when not beat-synced'),
  beat_sync: z.boolean().optional().describe('pulse/flash on the music beat (requires music)'),
  every: z.number().optional().describe('flash every N beats: 1 = every beat, 4 = every bar'),
  decay: z.number().optional().describe('flash fade-out time in seconds (0.2–1)'),
  width: z.number().optional().describe('chase/wave band width as a fraction of the shape (0.1–0.5)'),
  brightness: z.number().optional().describe('0–1, default 1'),
})
export type LightInput = z.infer<typeof LightInput>

export const ShapeInput = z.object({
  kind: z.enum([...SHAPE_KINDS, 'custom']).describe(
    '2D (face the audience): circle, heart, star, polygon, grid, spiral, wave. 3D: sphere, torus, cube, helix (double helix), cone (tree). ' +
      'text: letters/numbers. custom: any other picture, drawn from `description` (logos, animals, objects, symbols).',
  ),
  text: z.string().optional().describe('For text: the words. Keep it short (1–12 characters per line); use \\n for a second line.'),
  font: z.enum(['sans', 'serif', 'pixel']).optional().describe('For text. pixel = dot-matrix, great for digits'),
  description: z.string().optional().describe('For custom: a concise visual description, e.g. "a rocket launching upward with flame"'),
  fill: z.enum(['filled', 'outline']).optional().describe('circle/heart/star/polygon: filled area or just the outline'),
  points: z.number().optional().describe('star points (3–12)'),
  inner: z.number().optional().describe('star inner radius ratio (0.2–0.9)'),
  sides: z.number().optional().describe('polygon sides (3–12)'),
  aspect: z.number().optional().describe('grid width/height ratio'),
  turns: z.number().optional().describe('spiral or helix turns'),
  cycles: z.number().optional().describe('wave cycles'),
  amplitude: z.number().optional().describe('wave amplitude (0–0.5)'),
  thickness: z.number().optional().describe('torus tube thickness (0.1–0.8)'),
  radius: z.number().optional().describe('helix radius or cone base radius, relative to height (0.05–0.8)'),
  scale: z.number().optional().describe('Size relative to the smallest safe size: 1 = smallest safe (default), 1.4 = 40% larger. Never below 1.'),
})
export type ShapeInput = z.infer<typeof ShapeInput>

export const SceneInput = z.object({
  name: z.string().describe('Short scene name shown in the editor'),
  shape: ShapeInput,
  light: LightInput,
  hold_seconds: z.number().optional().describe('How long the formation is held (default 6). With music, holds are rounded to whole bars.'),
  spin: z.number().optional().describe('Degrees per second about the vertical axis while held (0 = still; 10–25 looks good on 3D shapes)'),
  tilt: z.number().optional().describe('Tilt toward the audience in degrees (rotation about the horizontal axis)'),
  turn: z.number().optional().describe('Turn in degrees about the vertical axis'),
  altitude: z.number().optional().describe('Centre altitude in metres (default 55; raised automatically to clear the floor)'),
  dim_flight: z.boolean().optional().describe('Dim the lights while flying into this formation (hides the transition)'),
  spare_fraction: z.number().optional().describe('0–0.7: fraction of drones parked dark behind the formation. Use 0.3–0.6 for digits or short text so it stays compact.'),
})
export type SceneInput = z.infer<typeof SceneInput>

export const CueTiming = {
  duration_seconds: z.number().describe('Length of the cue'),
  blend: z.enum(['replace', 'multiply', 'add']).describe('replace: cover the formation colours. multiply: tint/darken. add: add light on top (flashes, sweeps).'),
  fade_in: z.number().optional().describe('Fade-in seconds'),
  fade_out: z.number().optional().describe('Fade-out seconds'),
}

export const DirectorCue = z.object({
  scene_index: z.number().describe('0-based index of the scene the cue is anchored to'),
  offset_seconds: z.number().describe('Seconds after that formation arrives (negative = during the flight in)'),
  light: LightInput,
  ...CueTiming,
})

export const ShowPlan = z.object({
  title: z.string(),
  concept: z.string().describe('One or two sentences describing the show’s story and look'),
  scenes: z.array(SceneInput).describe('The formations in order'),
  cues: z.array(DirectorCue).describe('Light cues layered over the formations (accents, flashes, washes)'),
})
export type ShowPlan = z.infer<typeof ShowPlan>

export const SvgShape = z.object({
  name: z.string().describe('Short name for the formation'),
  svg: z.string().describe('A complete <svg> document, viewBox="0 0 400 400", transparent background'),
})
export type SvgShape = z.infer<typeof SvgShape>
