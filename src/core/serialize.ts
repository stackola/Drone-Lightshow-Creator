// Project files: versioned JSON. Loading is defensive — any missing or
// malformed field falls back to a sane default instead of crashing the editor.

import type { AudioMeta, CascadeOrder, Effect, FlightSpec, Group, JointKind, JointMotion, Layer, Zone, LightCue, Limits, ModelJoint, ModelPart, Scene, ShapeSpec, ShowDoc, Site, TransitionKind, TransitionStyle, Vec3 } from './types'
import { MAX_PARTS } from './model3d'
import { MAX_JOINTS } from './joints'
import { DEFAULT_LIMITS, DEFAULT_SITE, newId } from './defaults'
import { SHAPE_BY_KIND } from './shapes'
import { EFFECTS, defaultEffect } from './effects'

export const FORMAT = 'drone-show-designer'
export const FORMAT_VERSION = 1

export interface ProjectFile {
  format: typeof FORMAT
  version: number
  doc: ShowDoc
  /** Optional embedded music. */
  audio?: { mime: string; data: string } | null
}

export function toProjectFile(doc: ShowDoc, audio?: { mime: string; data: string } | null): ProjectFile {
  return { format: FORMAT, version: FORMAT_VERSION, doc, audio: audio ?? null }
}

export function parseProjectFile(text: string): { doc: ShowDoc; audio: { mime: string; data: string } | null } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!isObj(raw)) throw new Error('This file is not a drone show project.')
  // Accept both the wrapped format and a bare document.
  const docRaw = raw.format === FORMAT ? raw.doc : raw
  if (raw.format === FORMAT && typeof raw.version === 'number' && raw.version > FORMAT_VERSION) {
    throw new Error('This project was saved by a newer version of the editor.')
  }
  if (!isObj(docRaw) || !Array.isArray(docRaw.scenes)) throw new Error('This file is not a drone show project.')
  const audio = isObj(raw.audio) && typeof raw.audio.data === 'string' ? { mime: str(raw.audio.mime, 'audio/mpeg'), data: raw.audio.data } : null
  return { doc: normalizeDoc(docRaw), audio }
}

// --- Normalisation -------------------------------------------------------------

type Obj = Record<string, unknown>
function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function num(v: unknown, d: number, min = -Infinity, max = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d
}
function str(v: unknown, d: string): string {
  return typeof v === 'string' ? v : d
}
function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d
}
function vec(v: unknown, d: Vec3): Vec3 {
  return Array.isArray(v) && v.length === 3 ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : [...d]
}
function hex(v: unknown, d: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : d
}

export function normalizeDoc(r: Obj): ShowDoc {
  const L = isObj(r.limits) ? r.limits : {}
  const limits: Limits = {
    minSpacing: num(L.minSpacing, DEFAULT_LIMITS.minSpacing, 0.1, 50),
    maxSpeedH: num(L.maxSpeedH, DEFAULT_LIMITS.maxSpeedH, 0.1, 50),
    maxSpeedUp: num(L.maxSpeedUp, DEFAULT_LIMITS.maxSpeedUp, 0.1, 50),
    maxSpeedDown: num(L.maxSpeedDown, DEFAULT_LIMITS.maxSpeedDown, 0.1, 50),
    maxAccel: num(L.maxAccel, DEFAULT_LIMITS.maxAccel, 0.1, 50),
    maxJerk: num(L.maxJerk, DEFAULT_LIMITS.maxJerk, 0.1, 500),
    minAltitude: num(L.minAltitude, DEFAULT_LIMITS.minAltitude, 0, 1000),
    maxAltitude: num(L.maxAltitude, DEFAULT_LIMITS.maxAltitude, 1, 5000),
    maxRadius: num(L.maxRadius, DEFAULT_LIMITS.maxRadius, 1, 10000),
    maxFlightTime: num(L.maxFlightTime, DEFAULT_LIMITS.maxFlightTime, 10, 36000),
    ...(isObj(L.accuracy) ? { accuracy: { h: num(L.accuracy.h, 0, 0, 20), v: num(L.accuracy.v, 0, 0, 20) } } : {}),
  }
  const S = isObj(r.site) ? r.site : {}
  const site: Site = {
    gridSpacing: num(S.gridSpacing, DEFAULT_SITE.gridSpacing, 0.1, 100),
    takeoffAltitude: num(S.takeoffAltitude, DEFAULT_SITE.takeoffAltitude, 0.5, 200),
    audienceDistance: num(S.audienceDistance, DEFAULT_SITE.audienceDistance, 10, 5000),
    landing: S.landing === 'home' ? 'home' : 'any',
    returnFlight: flight(S.returnFlight),
    ...siteExtras(S),
  }
  return {
    version: 1,
    name: str(r.name, 'Untitled show').slice(0, 200),
    droneCount: Math.round(num(r.droneCount, 100, 1, 2000)),
    limits,
    site,
    scenes: (r.scenes as unknown[]).filter(isObj).map((x) => scene(x)),
    cues: Array.isArray(r.cues) ? r.cues.filter(isObj).map(cue) : [],
    audio: audioMeta(r.audio),
  }
}

function flight(v: unknown): FlightSpec {
  const f = isObj(v) ? v : {}
  const style = transitionStyle(f.style)
  return { duration: typeof f.duration === 'number' && Number.isFinite(f.duration) ? Math.max(0, f.duration) : null, dim: bool(f.dim, false), ...(style ? { style } : {}) }
}

const KINDS: TransitionKind[] = ['cascade', 'swirl', 'burst', 'ant', 'rain']
const ORDERS: CascadeOrder[] = ['left', 'right', 'center', 'edge', 'top', 'bottom']

function transitionStyle(v: unknown): TransitionStyle | undefined {
  if (!isObj(v) || !KINDS.includes(v.kind as TransitionKind)) return undefined
  const kind = v.kind as TransitionKind
  const out: TransitionStyle = { kind, amount: num(v.amount, 0.6, 0, 1) }
  if (kind === 'cascade') out.order = ORDERS.includes(v.order as CascadeOrder) ? (v.order as CascadeOrder) : 'left'
  if (kind === 'swirl') out.turns = Math.round(num(v.turns, 0.5, -3, 3) * 8) / 8 || 0.5
  if (kind === 'ant') out.lanes = Math.round(num(v.lanes, 0, 0, 40))
  return out
}

const poly = (v: unknown): [number, number][] =>
  Array.isArray(v) ? v.filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 200).map((p) => [num(p[0], 0, -1e5, 1e5), num(p[1], 0, -1e5, 1e5)]) : []

/** Location, keep-out zones, flight area and map settings of the site. */
function siteExtras(S: Obj): Partial<Site> {
  const out: Partial<Site> = {}
  if (isObj(S.geo) && Number.isFinite(S.geo.lat) && Number.isFinite(S.geo.lon)) {
    out.geo = { lat: num(S.geo.lat, 0, -90, 90), lon: num(S.geo.lon, 0, -180, 180), heading: ((num(S.geo.heading, 0, -720, 720) % 360) + 360) % 360 }
  }
  if (Array.isArray(S.zones)) {
    const kinds: Zone['kind'][] = ['audience', 'building', 'no-fly']
    const zones = S.zones.filter(isObj).slice(0, 50).map((z): Zone => ({
      id: str(z.id, newId('zone')),
      name: str(z.name, 'Zone').slice(0, 80),
      kind: kinds.includes(z.kind as Zone['kind']) ? (z.kind as Zone['kind']) : 'no-fly',
      points: poly(z.points),
      top: z.top === null || z.top === undefined ? null : num(z.top, 20, 0, 10000),
      buffer: num(z.buffer, 5, 0, 1000),
    })).filter((z) => z.points.length >= 3)
    if (zones.length) out.zones = zones
  }
  const area = poly(S.area)
  if (area.length >= 3) out.area = area
  if (typeof S.tiles === 'string' && /^https:\/\/[^\s"'<>]+$/.test(S.tiles) && S.tiles.includes('{z}')) out.tiles = S.tiles.slice(0, 500)
  if (S.mapInView === true) out.mapInView = true
  return out
}

function scene(s: Obj, nested = false): Scene {
  const layers = Array.isArray(s.layers) ? s.layers.filter(isObj).map(layer).filter((l): l is Layer => !!l) : []
  const ids = new Set(layers.map((l) => l.id))
  // Groups (steps never have their own), each claiming existing layers.
  const groups: Group[] = nested || !Array.isArray(s.groups) ? [] : s.groups.filter(isObj).slice(0, 12).map((g) => ({
    id: str(g.id, newId('group')),
    name: str(g.name, 'Group').slice(0, 80),
    layers: Array.isArray(g.layers) ? g.layers.filter((x): x is string => typeof x === 'string' && ids.has(x)) : [],
    delay: num(g.delay, 0, 0, 600),
    ...(isObj(g.part) && (g.part.axis === 'x' || g.part.axis === 'y')
      ? { part: { axis: g.part.axis as 'x' | 'y', of: Math.round(num(g.part.of, 2, 1, 8)), index: Math.min(Math.round(num(g.part.of, 2, 1, 8)) - 1, Math.round(num(g.part.index, 0, 0, 7))) } }
      : {}),
    steps: Array.isArray(g.steps) ? g.steps.filter(isObj).slice(0, 40).map((st) => scene(st, true)) : [],
  })).filter((g) => g.layers.length > 0)
  return {
    id: str(s.id, newId('scene')),
    name: str(s.name, 'Scene').slice(0, 120),
    hold: num(s.hold, 6, 0, 3600),
    flight: flight(s.flight),
    position: vec(s.position, [0, 55, 0]),
    rotation: vec(s.rotation, [0, 0, 0]),
    spin: num(s.spin, 0, -720, 720),
    ...(Array.isArray(s.keys) && s.keys.length
      ? { keys: s.keys.filter(isObj).slice(0, 64).map((k) => ({ t: num(k.t, 0, 0, 3600), move: vec(k.move, [0, 0, 0]), rotate: vec(k.rotate, [0, 0, 0]), scale: num(k.scale, 1, 0.05, 20), ...(k.through === true ? { through: true } : {}) })) }
      : {}),
    ...(isObj(s.motion) && ['breathe', 'bob', 'sway'].includes(s.motion.kind as string)
      ? { motion: { kind: s.motion.kind as 'breathe' | 'bob' | 'sway', amount: num(s.motion.amount, 0, 0, s.motion.kind === 'breathe' ? 1 : s.motion.kind === 'bob' ? 50 : 90), period: num(s.motion.period, 4, 0.5, 120) } }
      : {}),
    layers: layers.length ? layers : [{ id: newId('layer'), shape: { kind: 'circle', size: 30, fill: 'filled' }, weight: 1, offset: [0, 0, 0], rotation: [0, 0, 0], effect: defaultEffect('solid') }],
    ...(groups.length ? { groups } : {}),
  }
}

function layer(l: Obj): Layer | null {
  const shape = shapeSpec(l.shape)
  if (!shape) return null
  const roles = ['park', 'starfield', 'halo', 'frame', 'base']
  return {
    id: str(l.id, newId('layer')),
    ...(typeof l.role === 'string' && roles.includes(l.role) ? { role: l.role as Layer['role'] } : {}),
    shape,
    weight: num(l.weight, 1, 0, 1e6),
    offset: vec(l.offset, [0, 0, 0]),
    rotation: vec(l.rotation, [0, 0, 0]),
    effect: effect(l.effect),
    ...(isObj(l.joint) && jointMotion(l.joint) ? { joint: { ...jointMotion(l.joint)!, anchor: vec(l.joint.anchor, [0, 0, 0]).map((a) => Math.max(-4, Math.min(4, a))) as Vec3 } } : {}),
  }
}

const JOINT_KINDS = ['swing', 'turn', 'slide']

/** A joint's motion; null if it isn't one. */
function jointMotion(v: Obj): JointMotion | null {
  if (!JOINT_KINDS.includes(v.kind as string)) return null
  const kind = v.kind as JointKind
  const axis = vec(v.axis, [0, 0, 1])
  return {
    kind,
    axis: Math.hypot(...axis) > 1e-9 ? axis : [0, 0, 1],
    amount: num(v.amount, 0, kind === 'turn' ? -720 : kind === 'slide' ? -100 : 0, kind === 'turn' ? 720 : kind === 'slide' ? 100 : 180),
    period: num(v.period, 6, 0.5, 120),
    phase: num(v.phase, 0, -1, 1),
  }
}

/** Up to 64 finite [a, b] pairs. */
function pairs(v: unknown): [number, number][] {
  return Array.isArray(v) ? v.filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 64).map((p) => [num(p[0], 0, -1e4, 1e4), num(p[1], 0, -1e4, 1e4)]) : []
}

/** A 3D model's joints (dropping any that aren't). */
export function modelJoints(v: unknown): ModelJoint[] {
  if (!Array.isArray(v)) return []
  const out: ModelJoint[] = []
  for (const j of v.filter(isObj).slice(0, MAX_JOINTS)) {
    const m = jointMotion(j)
    if (!m) continue
    out.push({ ...m, id: str(j.id, newId('joint')).slice(0, 60), name: str(j.name, 'Joint').slice(0, 60), pivot: vec(j.pivot, [0, 0, 0]), ...(typeof j.parent === 'string' && j.parent ? { parent: j.parent.slice(0, 60) } : {}) })
  }
  return out
}

function shapeSpec(v: unknown): ShapeSpec | null {
  if (!isObj(v) || typeof v.kind !== 'string' || !(v.kind in SHAPE_BY_KIND)) return null
  const base = SHAPE_BY_KIND[v.kind as ShapeSpec['kind']].create() as unknown as Obj
  const out: Obj = { ...base }
  for (const [k, d] of Object.entries(base)) {
    const x = v[k]
    if (typeof d === 'number') out[k] = num(x, d)
    else if (typeof d === 'string') out[k] = str(x, d)
    else if (k === 'mask') out[k] = isObj(x) && typeof x.bits === 'string' ? { w: num(x.w, 0, 0, 4096), h: num(x.h, 0, 0, 4096), bits: x.bits } : d
    else if (k === 'colors') out[k] = typeof x === 'string' ? x : null
  }
  out.size = num(v.size, 30, 0.1, 5000)
  if (v.kind === 'model') {
    out.parts = Array.isArray(v.parts) ? v.parts.map(modelPart).filter((x): x is ModelPart => !!x).slice(0, MAX_PARTS) : []
    const joints = modelJoints(v.joints)
    if (joints.length) out.joints = joints
    if (v.relief === true) out.relief = true
  }
  if (v.kind === 'image' && Array.isArray(v.lines)) {
    // Strokes: flat [u, v, …] in 0..1, at most 200 lines and 20 000 points.
    let budget = 20000
    const lines = v.lines.filter(isObj).slice(0, 200).flatMap((l) => {
      const p = Array.isArray(l.p) ? l.p.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : []
      const pts = p.slice(0, Math.min(p.length, budget * 2) & ~1).map((x) => Math.max(-0.5, Math.min(1.5, x)))
      budget -= pts.length / 2
      return pts.length >= 4 ? [{ p: pts, ...(l.closed === true ? { closed: true } : {}) }] : []
    })
    if (lines.length) out.lines = lines
    if (typeof v.detail === 'number') out.detail = num(v.detail, 0.5, 0, 1)
    const pic = v.picture
    if (isObj(pic) && typeof pic.image === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(pic.image) && pic.image.length < 1_500_000) {
      out.picture = {
        prompt: str(pic.prompt, '').slice(0, 2000), image: pic.image, detail: num(pic.detail, 0.5, 0, 1),
        threshold: pic.threshold === null || pic.threshold === undefined ? null : num(pic.threshold, 0.25, 0.02, 0.95),
        ...(pic.format === 'landscape' || pic.format === 'portrait' || pic.format === 'square' ? { format: pic.format } : {}),
      }
    }
  }
  if ('fill' in base) out.fill = v.fill === 'outline' ? 'outline' : 'filled'
  if ('font' in base) out.font = v.font === 'serif' || v.font === 'pixel' ? v.font : 'sans'
  return out as unknown as ShapeSpec
}

/** Validate one 3D model part; malformed parts are dropped rather than crashing the editor. */
export function modelPart(v: unknown): ModelPart | null {
  const solid = modelSolid(v)
  if (!solid || !isObj(v)) return solid
  return typeof v.joint === 'string' && v.joint ? { ...solid, joint: v.joint.slice(0, 60) } : solid
}

function modelSolid(v: unknown): ModelPart | null {
  if (!isObj(v) || typeof v.type !== 'string') return null
  const pos = (x: unknown, d: number) => num(x, d, 1e-4, 1e4)
  const color = hex(v.color, '#ffffff')
  const rot = vec(v.rotation, [0, 0, 0])
  switch (v.type) {
    case 'sphere': return { type: 'sphere', center: vec(v.center, [0, 0, 0]), radius: pos(v.radius, 0.5), color }
    case 'ellipsoid': { const r = vec(v.radii, [0.5, 0.5, 0.5]); return { type: 'ellipsoid', center: vec(v.center, [0, 0, 0]), radii: [pos(r[0], 0.5), pos(r[1], 0.5), pos(r[2], 0.5)], rotation: rot, color } }
    case 'box': { const z = vec(v.size, [1, 1, 1]); return { type: 'box', center: vec(v.center, [0, 0, 0]), size: [pos(z[0], 1), pos(z[1], 1), pos(z[2], 1)], rotation: rot, color } }
    case 'cylinder': return { type: 'cylinder', from: vec(v.from, [0, 0, 0]), to: vec(v.to, [0, 1, 0]), radius: pos(v.radius, 0.2), color }
    case 'capsule': return { type: 'capsule', from: vec(v.from, [0, 0, 0]), to: vec(v.to, [0, 1, 0]), radius: pos(v.radius, 0.2), color }
    case 'cone': return { type: 'cone', from: vec(v.from, [0, 0, 0]), to: vec(v.to, [0, 1, 0]), radius: num(v.radius, 0.3, 0, 1e4), radiusTop: num(v.radiusTop, 0, 0, 1e4), color }
    case 'torus': return { type: 'torus', center: vec(v.center, [0, 0, 0]), radius: pos(v.radius, 0.5), tube: pos(v.tube, 0.15), rotation: rot, color }
    case 'plate': {
      const pts = pairs(v.points)
      return pts.length >= 3 ? { type: 'plate', center: vec(v.center, [0, 0, 0]), points: pts, depth: pos(v.depth, 0.05), rotation: rot, color } : null
    }
    case 'tube': {
      const path = Array.isArray(v.path) ? v.path.slice(0, 64).map((p) => vec(p, [0, 0, 0])) : []
      return path.length >= 2 ? { type: 'tube', path, radius: pos(v.radius, 0.05), color } : null
    }
    case 'lathe': {
      const prof = pairs(v.profile).map(([r, y]) => [Math.max(0, r), y] as [number, number])
      return prof.length >= 2 ? { type: 'lathe', center: vec(v.center, [0, 0, 0]), profile: prof, rotation: rot, color } : null
    }
    default: return null
  }
}

function effect(v: unknown): Effect {
  if (!isObj(v) || typeof v.kind !== 'string' || !EFFECTS.some((e) => e.kind === v.kind)) return defaultEffect('solid')
  const base = defaultEffect(v.kind as Effect['kind']) as unknown as Obj
  const out: Obj = { ...base }
  for (const [k, d] of Object.entries(base)) {
    if (k === 'kind') continue
    const x = v[k]
    if (typeof d === 'number') out[k] = num(x, d)
    else if (typeof d === 'boolean') out[k] = bool(x, d)
    else if (k === 'text') out[k] = str(x, d as string).slice(0, 200)
    else if (k === 'mode') out[k] = x === 'radial' ? 'radial' : 'linear'
    else if (k === 'colors' && Array.isArray(d)) {
      const cols = Array.isArray(x) ? x.filter((c): c is string => typeof c === 'string').slice(0, 6).map((c) => hex(c, '#ffffff')) : []
      out[k] = cols.length >= 1 ? cols : d
    } else if (typeof d === 'string') out[k] = hex(x, d)
  }
  // Optional extras on shape colours: animation and its speed.
  if (out.kind === 'image' && ['shimmer', 'glint', 'pulse', 'sparkle'].includes(v.anim as string)) {
    out.anim = v.anim
    out.speed = num(v.speed, 1, 0.05, 10)
  }
  return out as unknown as Effect
}

function cue(q: Obj): LightCue {
  return {
    id: str(q.id, newId('cue')),
    start: num(q.start, 0, 0),
    duration: num(q.duration, 2, 0.05, 3600),
    fadeIn: num(q.fadeIn, 0, 0, 600),
    fadeOut: num(q.fadeOut, 0, 0, 600),
    blend: q.blend === 'multiply' || q.blend === 'add' ? q.blend : 'replace',
    effect: effect(q.effect),
    ...(typeof q.tag === 'string' ? { tag: q.tag.slice(0, 40) } : {}),
  }
}

function audioMeta(v: unknown): AudioMeta | null {
  if (!isObj(v)) return null
  return {
    name: str(v.name, 'music'),
    duration: num(v.duration, 0, 0),
    offset: num(v.offset, 0),
    beats: Array.isArray(v.beats) ? v.beats.filter((b): b is number => typeof b === 'number' && Number.isFinite(b)) : [],
    downbeat: Math.round(num(v.downbeat, 0, 0)),
    bpm: num(v.bpm, 0, 0),
    ...(Array.isArray(v.energy) ? { energy: v.energy.map((e) => num(e, 0, 0, 1)) } : {}),
    ...(Array.isArray(v.bass) ? { bass: v.bass.map((e) => num(e, 0, 0, 1)) } : {}),
    ...(Array.isArray(v.bright) ? { bright: v.bright.map((e) => num(e, 0, 0, 1)) } : {}),
    ...(Array.isArray(v.accents) ? { accents: v.accents.filter((b): b is number => typeof b === 'number' && Number.isFinite(b)) } : {}),
    ...(Array.isArray(v.sections)
      ? {
          sections: v.sections.filter(isObj).map((x) => ({
            start: num(x.start, 0, 0), end: num(x.end, 0, 0),
            label: (['intro', 'verse', 'build', 'drop', 'break', 'outro'].includes(x.label as string) ? x.label : 'verse') as 'verse',
            energy: num(x.energy, 0.5, 0, 1),
          })).filter((x) => x.end > x.start),
        }
      : {}),
    ...(typeof v.generated === 'string' ? { generated: v.generated.slice(0, 60) } : {}),
  }
}
