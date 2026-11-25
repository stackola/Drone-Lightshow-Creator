// Schemas for everything the model sends back: tool inputs and structured
// outputs. Numeric ranges are described rather than enforced (structured
// outputs don't support numeric constraints); converters clamp instead.

import { z } from 'zod'

export const SHAPE_KINDS = ['circle', 'heart', 'star', 'polygon', 'grid', 'spiral', 'wave', 'sphere', 'torus', 'cube', 'helix', 'cone', 'text'] as const
export const EFFECT_KINDS = ['solid', 'gradient', 'rainbow', 'pulse', 'twinkle', 'chase', 'wave', 'flash', 'strobe', 'off', 'image', 'palette', 'react', 'meter', 'write', 'type', 'flip', 'matrix'] as const

const hex = z.string().describe('Hex colour, e.g. "#ff3366"')

export const LightInput = z.object({
  effect: z.enum(EFFECT_KINDS).describe(
    'solid: one colour. gradient: color → color2 across the shape. rainbow: moving hues. pulse: color on each beat fading toward color2. ' +
      'twinkle: color with random color2 sparkles. chase: color2 highlight running along the shape over a color base. ' +
      'wave: color2 band sweeping across a color base. flash: color flash (on every N beats when beat_sync). strobe: color strobe. ' +
      'off: lights off (parked drones). image: the shape\'s own colours (custom drawings, images, 3D models — set by their drawing or parts), optionally alive with `animate`. ' +
      'palette: 2–6 `colors` across the shape (a sunset, fire, ocean, a flag, a brand palette) — in a direction (`angle`) or centre → edge (palette_mode radial), still or flowing (`speed`). ' +
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
  colors: z.array(hex).optional().describe('palette: 2–6 colours in order (e.g. ["#2b1055", "#d53369", "#ffb347"] for a sunset)'),
  palette_mode: z.enum(['linear', 'radial']).optional().describe('palette: linear (in the `angle` direction, default) or radial (centre → edge)'),
  animate: z.enum(['none', 'shimmer', 'glint', 'pulse', 'sparkle']).optional().describe('image (the shape\'s own colours): shimmer = each drone breathes gently; glint = a white highlight sweeps across (metal, glass, a trophy); pulse = brightens on each beat; sparkle = random white flashes (magic, snow, celebration). `speed` scales it (default 1).'),
})
export type LightInput = z.infer<typeof LightInput>

export const PartMotionInput = z.object({
  kind: z.enum(['swing', 'turn', 'slide']).describe('swing: back and forth about the pivot (a pendulum, a waving sign, a wing); turn: round and round (a wheel, a star spinning in place, windmill blades); slide: back and forth along the axis'),
  pivot: z.enum(['centre', 'left', 'right', 'top', 'bottom']).optional().describe('Where on the shape it is hinged (default centre): e.g. a sign hanging from its top swings about "top"'),
  axis: z.enum(['facing', 'upright', 'across']).optional().describe('facing (default): turns in the picture the audience sees, like a clock hand; upright: about a vertical line, like a door; across: a nod. For slide: facing = toward the audience, upright = up and down, across = left and right.'),
  reverse: z.boolean().optional().describe('The other way round'),
  amount: z.number().describe('swing: degrees either way (5–30); turn: degrees per second (5–30); slide: metres either way'),
  period_seconds: z.number().optional().describe('swing/slide: seconds per back-and-forth (default 8; match the beat if there is music)'),
  phase: z.number().optional().describe('0–1: where in the beat it starts (0.5 = opposite to a partner shape)'),
}).describe('This shape moves on its own while held, inside the formation (unsafe amounts are calmed automatically)')
export type PartMotionInput = z.infer<typeof PartMotionInput>

export const ShapeInput = z.object({
  kind: z.enum([...SHAPE_KINDS, 'custom', 'model3d', 'led_sign']).describe(
    '2D (face the audience): circle, heart, star, polygon, grid, spiral, wave. 3D: sphere, torus, cube, helix (double helix), cone (tree). ' +
      'text: letters/numbers. custom: any other flat picture, drawn from `description` (logos, symbols, silhouettes) and checked as drones. ' +
      'model3d: any other 3D object, built from `description` and checked visually from four angles (a rocket, a trophy, a globe on a stand) — slower, best for hero moments and spinning. Say in the description if parts should move (“an eagle flapping its wings”, “a windmill with turning blades”): the model gets moving parts. ' +
      'led_sign: a dot-matrix LED panel scrolling `text` like a marquee (one drone per LED; 7 rows, or 5 with light.font_dots 5; `columns` wide); remaining drones park dark behind it.',
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
  columns: z.number().optional().describe('led_sign: panel width in drones (default: as wide as the fleet allows; 3–5 letters visible per 20 columns)'),
  scale: z.number().optional().describe('Size relative to the smallest safe size: 1 = smallest safe (default), 1.4 = 40% larger. Never below 1.'),
  moves: PartMotionInput.optional(),
  drawing_style: z.enum(['lines', 'filled', 'adaptive']).optional().describe('custom: lines (default — every line of the drawing is a line of drones, crisp, usually best), filled (drones spread over the whole figure — bold silhouettes, logos), adaptive (lines while they fit the sky, a filled silhouette when there are more drones than the lines can hold — good for formations with many drones)'),
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

export const KeyframeInput = z.object({
  at_seconds: z.number().describe('Seconds into the hold'),
  across: z.number().optional().describe('Move across from where the formation is placed (m, + = audience’s right)'),
  up: z.number().optional().describe('Move up (m)'),
  toward: z.number().optional().describe('Move toward the audience (m)'),
  tilt: z.number().optional().describe('Extra tilt (degrees)'),
  turn: z.number().optional().describe('Extra turn about the vertical axis (degrees)'),
  roll: z.number().optional().describe('Extra roll in the audience’s view (degrees)'),
  scale: z.number().optional().describe('Size: 1 = as designed (default), 1.2 = 20% larger; below 1 only as far as safe spacing allows'),
  flow_through: z.boolean().optional().describe('Sweep through this key on a smooth curve without stopping (for paths: arcs, loops, swoops). The last key always stops.'),
})
export type KeyframeInput = z.infer<typeof KeyframeInput>

/** A second (third, …) shape in the same formation, sharing its drones. */
export const ExtraShapeInput = z.object({
  shape: ShapeInput,
  light: LightInput,
  across: z.number().optional().describe('Offset from the formation centre in metres, + to the audience’s right'),
  up: z.number().optional().describe('Offset from the formation centre in metres, + up'),
  share: z.number().optional().describe('Fraction of the formation’s drones this shape takes (0.1–0.7, default an equal share)'),
})
export type ExtraShapeInput = z.infer<typeof ExtraShapeInput>

const SceneBase = z.object({
  name: z.string().describe('Short scene name shown in the editor'),
  shape: ShapeInput,
  light: LightInput,
  extra_shapes: z.array(ExtraShapeInput).optional().describe('More shapes in the same formation, e.g. a name under a logo or a heart beside text (1–3). Place them with across/up so they don’t overlap.'),
  across: z.number().optional().describe('Horizontal centre of the formation in metres (+ = audience’s right, default 0). Group formations default to their group’s own side.'),
  keyframes: z.array(KeyframeInput).optional().describe('Move, turn or resize the whole formation while it is held: it eases into each key and rests there, and the next flight starts from the last key (e.g. a rocket rising 30 m, a logo turning 90°, a heart growing 20% on the drop). Peak speed between keys is about 1.9 × distance ÷ seconds: keep it under the fleet limits (typically 6 m/s across, 3 up, 2 down).'),
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

/** A formation flown by one group during a split. */
export const StepInput = SceneBase.omit({ arrive_at_section: true })
export type StepInput = z.infer<typeof StepInput>

export const GroupInput = z.object({
  name: z.string().optional(),
  delay_seconds: z.number().optional().describe('Seconds after the formation’s hold before this group sets off (staggers the groups)'),
  steps: z.array(StepInput).describe('The group’s own formations, in order (1–4)'),
})
export type GroupInput = z.infer<typeof GroupInput>

export const SplitInput = z.object({
  mode: z.enum(['shapes', 'halves', 'top-bottom', 'thirds']).describe('How the drones divide: shapes = each layer of the formation is a group; halves = left/right halves; top-bottom = lower/upper halves; thirds = three columns'),
  groups: z.array(GroupInput).describe('One entry per group, in order: by layer, left→right, or lower→upper'),
})
export type SplitInput = z.infer<typeof SplitInput>

export const SceneInput = SceneBase.extend({
  split: SplitInput.optional().describe('After its hold, the formation splits into groups that each fly their own formations at their own pace; the next scene merges everyone. Use for one or two showpiece moments.'),
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
  return_flight: z.object({
    transition: TransitionInput.optional(),
    dim: z.boolean().optional().describe('Dim the lights on the way home'),
  }).optional().describe('How the drones fly home after the last formation (default: direct, lit)'),
  original_score: z.object({
    bpm: z.number().optional().describe('Tempo 80–140 matching the mood (default 120)'),
    drops_at: z.array(z.number()).describe('0-based indices of the 2–5 hero formations: the score builds up and drops exactly as each arrives'),
    breaks_at: z.array(z.number()).optional().describe('0-based indices of tender, quiet moments (a soft break in the music)'),
  }).optional().describe('When an original score is being composed (no song): which formations the music builds to and drops on, and where it goes quiet.'),
})
export type ShowPlan = z.infer<typeof ShowPlan>

export const SvgShape = z.object({
  name: z.string().describe('Short name for the formation'),
  svg: z.string().describe('A complete <svg> document, viewBox="0 0 400 400", transparent background'),
})
export type SvgShape = z.infer<typeof SvgShape>
