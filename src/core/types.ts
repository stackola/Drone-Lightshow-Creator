// ============================================================================
// Show document — the single source of truth.
//
// Coordinates (internal, metres): x = right as seen by the audience (east),
// y = up, z = toward the audience. The audience stands at z = +audienceDistance
// looking toward the origin. The takeoff grid is centred on the origin.
// Exports convert to ENU (east, north, up): E = x, N = -z, U = y.
// ============================================================================

export type Vec3 = [number, number, number]

/** Hex colour string, e.g. "#ff3366". */
export type Hex = string

export interface Limits {
  /** Minimum distance between any two drones at any time (m). */
  minSpacing: number
  /** Maximum horizontal speed (m/s). */
  maxSpeedH: number
  /** Maximum climb speed (m/s). */
  maxSpeedUp: number
  /** Maximum descent speed (m/s). */
  maxSpeedDown: number
  /** Maximum acceleration magnitude (m/s²). */
  maxAccel: number
  /** Maximum jerk — how fast acceleration may change (m/s³). */
  maxJerk: number
  /** Formations must stay at or above this altitude (m). */
  minAltitude: number
  /** Nothing may fly above this altitude (m). */
  maxAltitude: number
  /** Nothing may fly further than this horizontally from the origin (m). */
  maxRadius: number
  /** Battery budget: total show length including takeoff and landing (s). */
  maxFlightTime: number
  /**
   * How far a real drone may be from its planned position (GPS/RTK accuracy,
   * metres, horizontal and vertical). Every clearance grows by it: spacing by
   * twice the larger value, the floor, ceiling, fence and keep-out zones by it.
   */
  accuracy?: { h: number; v: number }
}

export interface FlightSpec {
  /** Seconds, or null for automatic (fastest safe time plus a comfort margin). */
  duration: number | null
  /** Dim lights while flying between formations. */
  dim: boolean
  /** How the drones travel: straight (default) or a choreographed transition. */
  style?: TransitionStyle
}

/**
 * Transition styles — the flight as part of the spectacle.
 *  direct:  everyone flies straight, together.
 *  cascade: the same straight paths, but drones set off in a ripple (left→right, centre-out, …).
 *  swirl:   the whole flying formation turns about its vertical axis on the way.
 *  burst:   the formation explodes outward mid-flight, then reforms.
 *  ant:     drones file out in lanes, march along an arch over the formations, and file into place.
 *  rain:    drones drip down onto a low carpet, then rise into the new shape, top first.
 */
export type TransitionKind = 'direct' | 'cascade' | 'swirl' | 'burst' | 'ant' | 'rain'

export type CascadeOrder = 'left' | 'right' | 'center' | 'edge' | 'top' | 'bottom'

export interface TransitionStyle {
  kind: TransitionKind
  /** 0..1 strength: cascade/rain stagger, burst expansion. */
  amount: number
  /** Cascade: where the ripple starts. */
  order?: CascadeOrder
  /** Swirl: turns (any fraction), sign = direction. */
  turns?: number
  /** Ant walk: number of lanes side by side (0 = automatic). */
  lanes?: number
}

export interface Site {
  /** Distance between takeoff pads (m). */
  gridSpacing: number
  /** Altitude drones climb to vertically before flying to the first formation (m). */
  takeoffAltitude: number
  /** Distance from the origin to the audience (m). */
  audienceDistance: number
  /** 'any': each drone lands on the nearest free pad (shortest, safest). 'home': each drone returns to its own pad. */
  landing: 'any' | 'home'
  /** Flight from the last formation back above the pads. */
  returnFlight: FlightSpec
  /** Where the show is on Earth: the centre of the takeoff grid, and the compass bearing the audience faces. */
  geo?: { lat: number; lon: number; heading: number }
  /** Areas drones must keep out of (the audience, buildings, trees, roads…). */
  zones?: Zone[]
  /** The permitted flight area (e.g. from the permit), as a polygon on the ground; drones must stay inside. */
  area?: [number, number][]
  /** Map tiles URL template ({z}/{x}/{y}); default OpenStreetMap. */
  tiles?: string
  /** Show the map on the ground in the 3D view. */
  mapInView?: boolean
}

/**
 * A keep-out zone: a polygon on the ground (show metres: x across, z toward
 * the audience) extruded up to `top` (null = all the way up), plus a buffer
 * drones must also keep clear of.
 */
export interface Zone {
  id: string
  name: string
  kind: 'audience' | 'building' | 'no-fly'
  points: [number, number][]
  top: number | null
  buffer: number
}

// --- Colour effects ---------------------------------------------------------

export type Effect =
  | { kind: 'solid'; color: Hex; brightness: number }
  | { kind: 'gradient'; a: Hex; b: Hex; angle: number; brightness: number }
  | { kind: 'rainbow'; angle: number; speed: number; scale: number; brightness: number }
  | { kind: 'pulse'; a: Hex; b: Hex; period: number; beatSync: boolean; brightness: number }
  | { kind: 'twinkle'; a: Hex; b: Hex; rate: number; brightness: number }
  | { kind: 'chase'; a: Hex; b: Hex; speed: number; width: number; brightness: number }
  | { kind: 'wave'; a: Hex; b: Hex; angle: number; speed: number; width: number; brightness: number }
  /** The shape's own colours (images, drawings, 3D models), optionally alive: shimmer, a glint sweeping across, a pulse on the beat, or sparkles. */
  | { kind: 'image'; brightness: number; anim?: ImageAnim; speed?: number }
  /** 2–6 colours across the shape (linear at `angle`, or radial from the centre), flowing at `speed` (0 = still). */
  | { kind: 'palette'; colors: Hex[]; mode: 'linear' | 'radial'; angle: number; speed: number; brightness: number }
  | { kind: 'flash'; color: Hex; decay: number; beatSync: boolean; every: number; onAccents?: boolean; brightness: number }
  | { kind: 'strobe'; color: Hex; rate: number; brightness: number }
  | { kind: 'off'; brightness: number }
  /** Brightness follows the music's loudness (floor = brightness in silence). */
  | { kind: 'react'; color: Hex; floor: number; brightness: number }
  /** Level meter: drones light from the bottom up to the music's current loudness. */
  | { kind: 'meter'; a: Hex; b: Hex; brightness: number }
  /** Draws the shape in pen order (text: letter by letter, stroke by stroke), with a glowing pen tip. */
  | { kind: 'write'; a: Hex; b: Hex; pen: Hex; duration: number; brightness: number }
  /** Text appears one letter at a time, with a blinking cursor on the next letter. */
  | { kind: 'type'; a: Hex; b: Hex; cursor: Hex; duration: number; brightness: number }
  /** Split-flap board: letters flicker, then settle left to right. */
  | { kind: 'flip'; a: Hex; b: Hex; duration: number; rate: number; brightness: number }
  /** LED matrix: dot-matrix text (font 7 = 5×7 dots, 5 = 3×5) scrolling across (or standing on) the formation, best on a grid. */
  | { kind: 'matrix'; text: string; a: Hex; b: Hex; speed: number; font: number; brightness: number }

export type EffectKind = Effect['kind']

export type ImageAnim = 'none' | 'shimmer' | 'glint' | 'pulse' | 'sparkle'

// --- Light cues ---------------------------------------------------------------
// Cues sit on their own timeline track, independent of formations: they can
// span scenes and flights. Each cue's effect is evaluated on every drone's
// current position, then blended over the formation's base look.

export type Blend = 'replace' | 'multiply' | 'add'

export interface LightCue {
  id: string
  /** Show time (s). */
  start: number
  duration: number
  fadeIn: number
  fadeOut: number
  blend: Blend
  effect: Effect
  /** 'music' for cues generated by "Light the music" (replaced when it runs again). */
  tag?: string
}

// --- Shapes -----------------------------------------------------------------

/** A 1-bit raster, rows top to bottom, packed MSB-first and base64-encoded. */
export interface Mask {
  w: number
  h: number
  bits: string
}

export type Fill = 'outline' | 'filled'

/** Where a traced picture came from, kept so it can be traced again (other detail, sensitivity, drone count). */
export interface PictureSource {
  /** What it shows (the description it was made from). */
  prompt: string
  /** The picture, as a small JPEG data URL. */
  image: string
  /** 0 (bold, few lines) … 1 (every line). */
  detail: number
  /** Brightness 0–1 a line needs to count; null = automatic. */
  threshold: number | null
  /** The picture's shape, for drawing it again. */
  format?: 'square' | 'landscape' | 'portrait'
}

/** A stroke of a drawing: flat [u, v, u, v, …] in 0..1 of the picture (v down), drawn in order. */
export interface DrawnLine {
  p: number[]
  closed?: boolean
}

export type TextFont = 'sans' | 'serif' | 'pixel'

/**
 * Every shape scales linearly with `size` (metres), so spacing can be fitted
 * exactly by rescaling.
 */
export type ShapeSpec =
  | { kind: 'circle'; size: number; fill: Fill }
  | { kind: 'polygon'; size: number; sides: number; fill: Fill }
  | { kind: 'star'; size: number; points: number; inner: number; fill: Fill }
  | { kind: 'heart'; size: number; fill: Fill }
  | { kind: 'grid'; size: number; aspect: number; scatter?: number; fill?: Fill }
  | { kind: 'spiral'; size: number; turns: number }
  | { kind: 'wave'; size: number; cycles: number; amplitude: number }
  | { kind: 'sphere'; size: number }
  | { kind: 'torus'; size: number; thickness: number }
  | { kind: 'cube'; size: number }
  | { kind: 'helix'; size: number; turns: number; radius: number }
  | { kind: 'cone'; size: number; radius: number }
  | { kind: 'text'; size: number; text: string; font: TextFont; mask: Mask }
  /**
   * A picture: `mask` is the filled area (filled evenly with drones), `lines` are
   * strokes (each becomes one evenly spaced line of drones along its path),
   * `colors` an RGB raster the drones take their colours from.
   */
  | { kind: 'image'; size: number; name: string; mask: Mask; colors: string | null; cw: number; ch: number; lines?: DrawnLine[]; detail?: number; picture?: PictureSource }
  /** relief: drones only on the side the audience sees (twice as dense there); leave off for models that turn. */
  | { kind: 'model'; size: number; name: string; parts: ModelPart[]; joints?: ModelJoint[]; relief?: boolean }

export type ShapeKind = ShapeSpec['kind']

// --- 3D models ---------------------------------------------------------------------
// A model is a union of solid parts in model space (y up, z toward the audience,
// any units — it is normalised so its largest extent is 1, then scaled by `size`).
// Drones are spread evenly over the outer surface of the union.

export type ModelPart = ModelSolid & {
  /** Id of the joint this part moves with (see ModelJoint); none = it stays still. */
  joint?: string
}

export type ModelSolid =
  | { type: 'sphere'; center: Vec3; radius: number; color: Hex }
  | { type: 'ellipsoid'; center: Vec3; radii: Vec3; rotation: Vec3; color: Hex }
  | { type: 'box'; center: Vec3; size: Vec3; rotation: Vec3; color: Hex }
  /** Solid cylinder between two points. */
  | { type: 'cylinder'; from: Vec3; to: Vec3; radius: number; color: Hex }
  /** Cone or frustum: `radius` at `from`, `radiusTop` at `to` (0 = pointed). */
  | { type: 'cone'; from: Vec3; to: Vec3; radius: number; radiusTop: number; color: Hex }
  /** Rounded rod between two points (limbs, stems, handles). */
  | { type: 'capsule'; from: Vec3; to: Vec3; radius: number; color: Hex }
  /** Ring lying in its local XZ plane (rotate [90,0,0] to face the audience). */
  | { type: 'torus'; center: Vec3; radius: number; tube: number; rotation: Vec3; color: Hex }
  /** A flat outline with some thickness: `points` [x, y] in its own plane (facing +z before rotation), centred on `center`. */
  | { type: 'plate'; center: Vec3; points: [number, number][]; depth: number; rotation: Vec3; color: Hex }
  /** A round tube along a path (necks, tails, tentacles, vines, curls). Thin tubes become one line of drones. */
  | { type: 'tube'; path: Vec3[]; radius: number; color: Hex }
  /** A turned shape: `profile` [radius, height] pairs revolved about its own vertical axis (vases, bells, bottles, bodies). */
  | { type: 'lathe'; center: Vec3; profile: [number, number][]; rotation: Vec3; color: Hex }

export type ModelPartType = ModelPart['type']

// --- Moving parts ----------------------------------------------------------------------
// Parts of a formation can move on their own while it is held: a bird's wings
// flap, a pendulum swings, a windmill's blades turn. A joint moves the drones
// of its parts as one rigid piece, about a pivot. Every motion eases in at the
// start of the hold and back to rest at the end (only 'turn' can leave the
// part turned), so flights in and out start and end in the designed pose.

/**
 * swing: rotate back and forth about the axis by `amount` degrees either way, once per `period` seconds.
 * turn:  rotate continuously at `amount` degrees per second (ramping up and down like spin).
 * slide: move back and forth along the axis by `amount` metres either way, once per `period` seconds.
 */
export type JointKind = 'swing' | 'turn' | 'slide'

export interface JointMotion {
  kind: JointKind
  /** Direction of the hinge (swing, turn) or of the slide; normalised when used. */
  axis: Vec3
  amount: number
  /** Seconds per cycle (swing, slide). */
  period: number
  /** Offset within the cycle, 0–1 (0.5 = the opposite way; legs walking, a wave along a tail). */
  phase: number
}

/** A hinge in a 3D model, in model units (the same coordinates as the parts). */
export interface ModelJoint extends JointMotion {
  id: string
  name: string
  pivot: Vec3
  /** Joint this one is attached to (a forearm to an upper arm): it moves with its parent too. */
  parent?: string
}

/** A whole shape moving on its own within the formation. */
export interface LayerJoint extends JointMotion {
  /** Pivot as a fraction of the shape's own extent: [-1..1] per axis, [0,0,0] = its centre, [1,0,0] = its right edge. */
  anchor: Vec3
}

/** What a secondary layer of otherwise idle drones is doing. */
export type SpareRole = 'park' | 'starfield' | 'halo' | 'frame' | 'base'

export interface Layer {
  id: string
  /** Set on layers that hold the scene's spare drones. */
  role?: SpareRole
  shape: ShapeSpec
  /** Relative share of the drones (counts use largest-remainder allocation). */
  weight: number
  offset: Vec3
  /** Degrees, applied X then Y then Z. */
  rotation: Vec3
  effect: Effect
  /** The whole shape moves on its own while held (swings, turns or slides about its anchor). */
  joint?: LayerJoint
}

export interface Scene {
  id: string
  name: string
  /** Seconds the formation is held. */
  hold: number
  /** Flight into this scene. */
  flight: FlightSpec
  /** Formation centre (m). */
  position: Vec3
  /** Degrees, applied X then Y then Z. */
  rotation: Vec3
  /** Degrees per second about the vertical axis while held (eases in and out). */
  spin: number
  /** Gentle motion while held; always eases in and out and returns to rest. */
  motion?: HoldMotion
  /**
   * Keyframes while held: the formation moves, turns and scales as a whole,
   * easing smoothly into each key (it comes to rest at every key). Times are
   * seconds from the start of the hold; values are relative to the
   * formation as designed. It stays at the last key until the hold ends.
   */
  keys?: HoldKey[]
  layers: Layer[]
  /**
   * Splits: after this formation's hold, some of its shapes break away as
   * groups, each flying its own formations at its own pace. The next scene
   * merges everyone back together. (Steps never have groups of their own.)
   */
  groups?: Group[]
}

/** Drones of some of a scene's shapes, continuing on their own timeline. */
export interface Group {
  id: string
  name: string
  /** Ids of the parent scene's layers whose drones form the group. */
  layers: string[]
  /**
   * Only part of those drones: sorted across (x) or by height (y), the
   * `index`-th of `of` equal slices (e.g. the left half of a heart).
   */
  part?: { axis: 'x' | 'y'; index: number; of: number }
  /** Seconds after the parent's hold before the group sets off. */
  delay: number
  /** The group's own formations, flown in order. */
  steps: Scene[]
}

export interface HoldKey {
  /** Seconds from the start of the hold. */
  t: number
  /** Offset from the formation's position (m): across, up, toward the audience. */
  move: Vec3
  /** Extra rotation (degrees): tilt, turn, roll (applied like the scene's rotation). */
  rotate: Vec3
  /** Uniform size (1 = as designed). Below 1 the drones close in, never below safe spacing. */
  scale: number
  /** Flow through this key without stopping (a smooth curve through the keys). The last key always stops. */
  through?: boolean
}

/**
 * Hold motions are chosen so they can never bring drones closer together:
 * breathe only ever expands the formation; bob and sway move it as one rigid body.
 */
export interface HoldMotion {
  kind: 'none' | 'breathe' | 'bob' | 'sway'
  /** breathe: extra size as a fraction (0.15 = up to 15% larger); bob: metres up/down; sway: degrees either way. */
  amount: number
  /** Seconds per cycle. */
  period: number
}

export interface AudioMeta {
  name: string
  duration: number
  /** Show time at which the music starts (s). */
  offset: number
  /** Detected beat times in audio time (s). */
  beats: number[]
  /** Index into `beats` of the first downbeat (bar start). */
  downbeat: number
  bpm: number
  /** Loudness per beat, 0..1 (absent for music added before this was tracked). */
  energy?: number[]
  /** Low-frequency (kick, bass) loudness per beat, 0..1. */
  bass?: number[]
  /** High-frequency share (hats, cymbals) per beat, 0..1. */
  bright?: number[]
  /** Accents: hits that stand out, in audio time (s). */
  accents?: number[]
  /** Song structure in audio time. */
  sections?: { start: number; end: number; label: 'intro' | 'verse' | 'build' | 'drop' | 'break' | 'outro'; energy: number }[]
  /** Set when the music is generated by the editor (regenerated on load instead of stored). */
  generated?: string
}

export interface ShowDoc {
  version: 1
  name: string
  droneCount: number
  limits: Limits
  site: Site
  scenes: Scene[]
  cues: LightCue[]
  audio: AudioMeta | null
}
