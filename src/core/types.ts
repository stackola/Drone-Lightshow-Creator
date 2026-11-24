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
  /** Formations must stay at or above this altitude (m). */
  minAltitude: number
  /** Nothing may fly above this altitude (m). */
  maxAltitude: number
  /** Nothing may fly further than this horizontally from the origin (m). */
  maxRadius: number
  /** Battery budget: total show length including takeoff and landing (s). */
  maxFlightTime: number
}

export interface FlightSpec {
  /** Seconds, or null for automatic (fastest safe time plus a comfort margin). */
  duration: number | null
  /** Dim lights while flying between formations. */
  dim: boolean
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
  | { kind: 'image'; brightness: number }
  | { kind: 'flash'; color: Hex; decay: number; beatSync: boolean; every: number; brightness: number }
  | { kind: 'strobe'; color: Hex; rate: number; brightness: number }
  | { kind: 'off'; brightness: number }

export type EffectKind = Effect['kind']

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
}

// --- Shapes -----------------------------------------------------------------

/** A 1-bit raster, rows top to bottom, packed MSB-first and base64-encoded. */
export interface Mask {
  w: number
  h: number
  bits: string
}

export type Fill = 'outline' | 'filled'

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
  | { kind: 'grid'; size: number; aspect: number }
  | { kind: 'spiral'; size: number; turns: number }
  | { kind: 'wave'; size: number; cycles: number; amplitude: number }
  | { kind: 'sphere'; size: number }
  | { kind: 'torus'; size: number; thickness: number }
  | { kind: 'cube'; size: number }
  | { kind: 'helix'; size: number; turns: number; radius: number }
  | { kind: 'cone'; size: number; radius: number }
  | { kind: 'text'; size: number; text: string; font: TextFont; mask: Mask }
  | { kind: 'image'; size: number; name: string; mask: Mask; colors: string | null; cw: number; ch: number }
  | { kind: 'model'; size: number; name: string; parts: ModelPart[] }

export type ShapeKind = ShapeSpec['kind']

// --- 3D models ---------------------------------------------------------------------
// A model is a union of solid parts in model space (y up, z toward the audience,
// any units — it is normalised so its largest extent is 1, then scaled by `size`).
// Drones are spread evenly over the outer surface of the union.

export type ModelPart =
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

export type ModelPartType = ModelPart['type']

export interface Layer {
  id: string
  shape: ShapeSpec
  /** Relative share of the drones (counts use largest-remainder allocation). */
  weight: number
  offset: Vec3
  /** Degrees, applied X then Y then Z. */
  rotation: Vec3
  effect: Effect
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
  layers: Layer[]
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
