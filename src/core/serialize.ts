// Project files: versioned JSON. Loading is defensive — any missing or
// malformed field falls back to a sane default instead of crashing the editor.

import type { AudioMeta, Effect, FlightSpec, Layer, LightCue, Limits, ModelPart, Scene, ShapeSpec, ShowDoc, Site, Vec3 } from './types'
import { MAX_PARTS } from './model3d'
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
  }
  const S = isObj(r.site) ? r.site : {}
  const site: Site = {
    gridSpacing: num(S.gridSpacing, DEFAULT_SITE.gridSpacing, 0.1, 100),
    takeoffAltitude: num(S.takeoffAltitude, DEFAULT_SITE.takeoffAltitude, 0.5, 200),
    audienceDistance: num(S.audienceDistance, DEFAULT_SITE.audienceDistance, 10, 5000),
    landing: S.landing === 'home' ? 'home' : 'any',
    returnFlight: flight(S.returnFlight),
  }
  return {
    version: 1,
    name: str(r.name, 'Untitled show').slice(0, 200),
    droneCount: Math.round(num(r.droneCount, 100, 1, 2000)),
    limits,
    site,
    scenes: (r.scenes as unknown[]).filter(isObj).map(scene),
    cues: Array.isArray(r.cues) ? r.cues.filter(isObj).map(cue) : [],
    audio: audioMeta(r.audio),
  }
}

function flight(v: unknown): FlightSpec {
  const f = isObj(v) ? v : {}
  return { duration: typeof f.duration === 'number' && Number.isFinite(f.duration) ? Math.max(0, f.duration) : null, dim: bool(f.dim, false) }
}

function scene(s: Obj): Scene {
  const layers = Array.isArray(s.layers) ? s.layers.filter(isObj).map(layer).filter((l): l is Layer => !!l) : []
  return {
    id: str(s.id, newId('scene')),
    name: str(s.name, 'Scene').slice(0, 120),
    hold: num(s.hold, 6, 0, 3600),
    flight: flight(s.flight),
    position: vec(s.position, [0, 55, 0]),
    rotation: vec(s.rotation, [0, 0, 0]),
    spin: num(s.spin, 0, -720, 720),
    ...(isObj(s.motion) && ['breathe', 'bob', 'sway'].includes(s.motion.kind as string)
      ? { motion: { kind: s.motion.kind as 'breathe' | 'bob' | 'sway', amount: num(s.motion.amount, 0, 0, s.motion.kind === 'breathe' ? 1 : s.motion.kind === 'bob' ? 50 : 90), period: num(s.motion.period, 4, 0.5, 120) } }
      : {}),
    layers: layers.length ? layers : [{ id: newId('layer'), shape: { kind: 'circle', size: 30, fill: 'filled' }, weight: 1, offset: [0, 0, 0], rotation: [0, 0, 0], effect: defaultEffect('solid') }],
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
  }
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
  if (v.kind === 'model') out.parts = Array.isArray(v.parts) ? v.parts.map(modelPart).filter((x): x is ModelPart => !!x).slice(0, MAX_PARTS) : []
  if ('fill' in base) out.fill = v.fill === 'outline' ? 'outline' : 'filled'
  if ('font' in base) out.font = v.font === 'serif' || v.font === 'pixel' ? v.font : 'sans'
  return out as unknown as ShapeSpec
}

/** Validate one 3D model part; malformed parts are dropped rather than crashing the editor. */
export function modelPart(v: unknown): ModelPart | null {
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
    else if (typeof d === 'string') out[k] = hex(x, d)
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
  }
}
