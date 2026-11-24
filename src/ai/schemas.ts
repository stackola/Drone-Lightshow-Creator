// Schemas for everything the model sends back: tool inputs and structured
// outputs. Numeric ranges are described rather than enforced (structured
// outputs don't support numeric constraints); converters clamp instead.

import { z } from 'zod'

export const SHAPE_KINDS = ['circle', 'heart', 'star', 'polygon', 'grid', 'spiral', 'wave', 'sphere', 'torus', 'cube', 'helix', 'cone', 'text'] as const
export const EFFECT_KINDS = ['solid', 'gradient', 'rainbow', 'pulse', 'twinkle', 'chase', 'wave', 'flash', 'strobe', 'off', 'image', 'react', 'meter', 'write', 'type', 'flip', 'matrix'] as const

const hex = z.string().describe('Hex colour, e.g. "#ff3366"')

export const LightInput = z.object({
  effect: z.enum(EFFECT_KINDS).describe(
    'solid: one colour. gradient: color → color2 across the shape. rainbow: moving hues. pulse: color on each beat fading toward color2. ' +
      'twinkle: color with random color2 sparkles. chase: color2 highlight running along the shape over a color base. ' +
      'wave: color2 band sweeping across a color base. flash: color flash (on every N beats when beat_sync). strobe: color strobe. ' +
      'off: lights off (parked drones). image: colours of an imported image (image formations only). ' +
      'Music-reactive (need music): react: color whose brightness follows the music\'s loudness (floor = brightness in silence; as a multiply cue it makes the whole show breathe with the song). meter: a level meter filling bottom-up with the loudness, color (low) to color2 (peak). flash with on_accents: flashes on the music\'s stand-out hits. ' +
      'Text reveals (best on text formations, over `duration` seconds from when the formation arrives or the cue starts): ' +
      'write: the text is written stroke by stroke with a glowing pen (color, pen colour color2); also draws outlines of other shapes. ' +
      'type: typewriter, one letter at a time with a blinking cursor. flip: split-flap board, letters flicker then settle left to right. ' +
      'matrix: LED-sign dot-matrix `text` scrolling across the formation at `speed` columns/s (0 = static) — best on a grid formation 7 drones tall (5 with font_dots 5), color on, color2 the unlit LED glow.',
  ),
  color: hex.optional().describe('Main colour'),
  color2: hex.optional().describe('Second colour (gradient end, pulse rest, twinkle sparkle, chase/wave highlight)'),
  angle: z.number().optional().describe('Direction in degrees for gradient/rainbow/wave: 0 = left→right, 90 = bottom→top'),
  speed: z.number().optional().describe('rainbow cycles/s (0.05–0.5), chase laps/s (0.1–1), wave sweeps/s (0.2–1)'),
  rate: z.number().optional().describe('twinkle or strobe frequency in Hz (twinkle 0.5–3, strobe 4–12)'),
  period: z.number().optional().describe('pulse period in seconds when not beat-synced'),
  beat_sync: z.boolean().optional().describe('pulse/flash on the music beat (requires music)'),
  every: z.number().optional().describe('flash every N beats: 1 = every beat, 4 = every bar'),
  on_accents: z.boolean().optional().describe('flash on the music\'s accents (big hits) instead of every N beats (requires beat_sync)'),
  floor: z.number().optional().describe('react: brightness 0–1 when the music is silent (default 0.25)'),
  decay: z.number().optional().describe('flash fade-out time in seconds (0.2–1)'),
  width: z.number().optional().describe('chase/wave band width as a fraction of the shape (0.1–0.5)'),
  brightness: z.number().optional().describe('0–1, default 1'),
  duration: z.number().optional().describe('write/type/flip: seconds to reveal the whole text (2–8)'),
  text: z.string().optional().describe('matrix: the text shown on the LED matrix (A–Z, 0–9, basic punctuation)'),
  font_dots: z.number().optional().describe('matrix: 7 = 5×7 letters (default), 5 = compact 3×5 letters for small panels (a grid 5 drones tall)'),
})
export type LightInput = z.infer<typeof LightInput>

export const ShapeInput = z.object({
  kind: z.enum([...SHAPE_KINDS, 'custom', 'model3d']).describe(
    '2D (face the audience): circle, heart, star, polygon, grid, spiral, wave. 3D: sphere, torus, cube, helix (double helix), cone (tree). ' +
      'text: letters/numbers. custom: any other flat picture, drawn from `description` (logos, symbols, silhouettes). ' +
      'model3d: any other 3D object, built from `description` and checked visually from four angles (a rocket, a trophy, a globe on a stand) — slower, best for hero moments and spinning.',
  ),
  text: z.string().optional().describe('For text: the words. Keep it short (1–12 characters per line); use \\n for a second line.'),
  font: z.enum(['sans', 'serif', 'pixel']).optional().describe('For text. pixel = dot-matrix, great for digits'),
  description: z.string().optional().describe('For custom and model3d: a concise visual description, e.g. "a rocket launching upward with flame"'),
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

export const SpareRoleInput = z.enum(['park', 'starfield', 'halo', 'frame', 'base']).describe(
  'park: lights off, out of sight behind. starfield: a dim twinkling sky behind the formation. halo: a glowing ring around it. frame: a square frame around it. base: a band of light beneath it.',
)

export const IdleMotionInput = z.object({
  kind: z.enum(['none', 'breathe', 'bob', 'sway']).describe('breathe: grows and settles back. bob: rises and falls. sway: turns back and forth. none: still.'),
  amount: z.number().optional().describe('breathe: growth in percent (3–10). bob: metres (0.5–3). sway: degrees (3–15). Large formations need less; unsafe amounts are calmed automatically.'),
  period_seconds: z.number().optional().describe('Seconds per cycle (4–12 looks calm; match a multiple of the beat if there is music)'),
})
export type IdleMotionInput = z.infer<typeof IdleMotionInput>

export const TransitionInput = z.object({
  style: z.enum(['direct', 'cascade', 'swirl', 'burst', 'ant', 'rain']).describe(
    'How drones fly into this formation. direct: straight, together (default, fastest). cascade: drones set off in a ripple (see order). ' +
      'swirl: the flying formation turns on the way. burst: explodes outward mid-flight then reforms. ' +
      'ant: drones march in a column over an arch and file into place (slow — a showpiece moment, ~1 min). rain: drones drip down to a low carpet then rise into the new shape (slow). ' +
      'Unsafe styles are softened or replaced automatically; spectacle transitions take longer than direct flights.',
  ),
  amount: z.number().optional().describe('0.1–1 strength (cascade ripple, burst size, rain drip stagger); default 0.6'),
  order: z.enum(['left', 'right', 'center', 'edge', 'top', 'bottom']).optional().describe('cascade: where the ripple starts'),
  turns: z.number().optional().describe('swirl: turns on the way (0.25–1; larger formations need longer)'),
})
export type TransitionInput = z.infer<typeof TransitionInput>

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
  spare_fraction: z.number().optional().describe('0–0.7: fraction of drones taken out of the main formation as spares. Use 0.3–0.6 for digits or short text so it stays compact.'),
  spare_role: SpareRoleInput.optional().describe('What the spare drones do (default park).'),
  idle_motion: IdleMotionInput.optional().describe('Gentle motion while held, to keep a long hold alive. Optional; spacing never shrinks.'),
  transition: TransitionInput.optional().describe('How the drones travel into this formation (default direct). Use spectacle transitions on a few key moments.'),
  arrive_at_section: z.number().optional().describe('With music: 1-based index of the song section this formation should arrive at the start of (e.g. the hero formation on the biggest drop). Leave out for formations that simply follow on.'),
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
  music_lighting: z.enum(['none', 'subtle', 'bold']).optional().describe('With music: automatically light the music on top of your cues — breathing in quiet parts, sweeps into drops, flashes on every hit (bold) or gentler (subtle). Default bold when there is music.'),
  fit_to_song: z.boolean().optional().describe('With music: stretch or tighten holds (in whole bars) so the finale ends with the song. Default true.'),
})
export type ShowPlan = z.infer<typeof ShowPlan>

export const SvgShape = z.object({
  name: z.string().describe('Short name for the formation'),
  svg: z.string().describe('A complete <svg> document, viewBox="0 0 400 400", transparent background'),
})
export type SvgShape = z.infer<typeof SvgShape>
