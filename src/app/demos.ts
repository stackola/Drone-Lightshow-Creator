// Demo shows, built entirely through the public model API. Tests require
// every demo to pass validation with zero issues.

import type { Effect, LightCue, Scene, ShapeSpec, ShowDoc, TextFont } from '@/core/types'
import { newId, newScene, newShape, newShow, placeAboveFloor, rasterizeText, withSpareDrones } from '@/core/defaults'
import { defaultEffect } from '@/core/effects'
import { compile } from '@/core/compile'

export interface Demo {
  id: string
  title: string
  blurb: string
  drones: number
  build(): ShowDoc
}

function scene(doc: ShowDoc, kind: Parameters<typeof newScene>[1], name: string, effect: Effect, patch: Partial<Scene> = {}, shapePatch: Record<string, unknown> = {}): Scene {
  const shape = { ...newShape(kind), ...shapePatch } as ShapeSpec
  // Re-check floor clearance after patches such as rotation.
  return placeAboveFloor({ ...newScene(doc, kind, { name, effect, shape }), ...patch }, doc)
}

function text(doc: ShowDoc, value: string, name: string, effect: Effect, font: TextFont, patch: Partial<Scene> = {}): Scene {
  const shape: ShapeSpec = { kind: 'text', size: 1, text: value, font, mask: rasterizeText(value, font) }
  return placeAboveFloor({ ...newScene(doc, 'text', { name, effect, shape }), ...patch }, doc)
}

function withSpare(doc: ShowDoc, sc: Scene, fraction: number): Scene {
  return withSpareDrones(sc, doc, fraction)
}

/** Place cues relative to scene arrival times (requires a compile pass). */
function cueAt(doc: ShowDoc, sceneIndex: number, offset: number, cue: Omit<LightCue, 'id' | 'start'>): LightCue {
  const c = compile(doc)
  const t = c.sceneTimes[sceneIndex]!.holdStart + offset
  return { id: newId('cue'), start: Math.max(0, Math.round(t * 10) / 10), ...cue }
}

export const DEMOS: Demo[] = [
  {
    id: 'hello',
    title: 'Hello, sky',
    blurb: 'A sunrise disc, a greeting, a beating heart, a spinning globe and a golden star.',
    drones: 200,
    build() {
      const doc = newShow(200, 'Hello, sky')
      doc.scenes.push(scene(doc, 'circle', 'Sunrise', { kind: 'gradient', a: '#ff5a1f', b: '#ffd36e', angle: 90, brightness: 1 }, { hold: 5 }))
      doc.scenes.push(text(doc, 'HELLO', 'Hello', { kind: 'wave', a: '#dfe8ff', b: '#ffc44d', angle: 0, speed: 0.45, width: 0.35, brightness: 1 }, 'sans', { hold: 6 }))
      doc.scenes.push(scene(doc, 'heart', 'Heart', { kind: 'pulse', a: '#ff2d55', b: '#5c0a1d', period: 1.1, beatSync: false, brightness: 1 }, { hold: 6 }))
      doc.scenes.push(scene(doc, 'sphere', 'Globe', defaultEffect('rainbow'), { hold: 10, spin: 20 }))
      doc.scenes.push(scene(doc, 'star', 'Star', { kind: 'chase', a: '#8a5a12', b: '#fff0b8', speed: 0.5, width: 0.25, brightness: 1 }, { hold: 6 }))
      doc.cues.push(cueAt(doc, 2, 0, { duration: 1.2, fadeIn: 0, fadeOut: 0, blend: 'add', effect: { kind: 'flash', color: '#ffffff', decay: 0.45, beatSync: false, every: 1, brightness: 1 } }))
      doc.cues.push(cueAt(doc, 4, 1.5, { duration: 4, fadeIn: 1, fadeOut: 1, blend: 'replace', effect: { kind: 'twinkle', a: '#b27511', b: '#fff6d6', rate: 2, brightness: 1 } }))
      return doc
    },
  },
  {
    id: 'countdown',
    title: 'New Year countdown',
    blurb: '3 · 2 · 1 in dot-matrix digits, the year, then a burst — with flashes on each number.',
    drones: 150,
    build() {
      const doc = newShow(150, 'New Year countdown')
      const white: Effect = { kind: 'solid', color: '#f4f7ff', brightness: 1 }
      doc.scenes.push(scene(doc, 'grid', 'Starfield', { kind: 'twinkle', a: '#1d3a7a', b: '#cfe0ff', rate: 1.2, brightness: 1 }, { hold: 4 }, { aspect: 2 }))
      // Digits look best with fewer drones: the rest wait dark behind them.
      doc.scenes.push(withSpare(doc, text(doc, '3', 'Three', white, 'pixel', { hold: 2 }), 0.4))
      doc.scenes.push(withSpare(doc, text(doc, '2', 'Two', white, 'pixel', { hold: 2 }), 0.4))
      doc.scenes.push(withSpare(doc, text(doc, '1', 'One', { kind: 'solid', color: '#ffcf4d', brightness: 1 }, 'pixel', { hold: 2 }), 0.6))
      doc.scenes.push(text(doc, '2027', 'Year', { kind: 'rainbow', angle: 0, speed: 0.3, scale: 1, brightness: 1 }, 'sans', { hold: 6 }))
      doc.scenes.push(scene(doc, 'sphere', 'Burst', { kind: 'twinkle', a: '#ff4d6d', b: '#ffffff', rate: 3, brightness: 1 }, { hold: 8, spin: -24 }))
      const flash = (): Omit<LightCue, 'id' | 'start'> => ({ duration: 1, fadeIn: 0, fadeOut: 0, blend: 'add', effect: { kind: 'flash', color: '#ffffff', decay: 0.35, beatSync: false, every: 1, brightness: 1 } })
      for (const i of [1, 2, 3, 4]) doc.cues.push(cueAt(doc, i, 0, flash()))
      doc.cues.push(cueAt(doc, 5, 0, { duration: 2, fadeIn: 0, fadeOut: 0.5, blend: 'replace', effect: { kind: 'strobe', color: '#ffffff', rate: 10, brightness: 1 } }))
      return doc
    },
  },
  {
    id: 'orbit',
    title: 'Orbits',
    blurb: 'A tilted, spinning torus, a double helix with a chase, and a spiral.',
    drones: 180,
    build() {
      const doc = newShow(180, 'Orbits')
      doc.scenes.push(scene(doc, 'torus', 'Torus', { kind: 'gradient', a: '#2bd2ff', b: '#9b5cff', angle: 0, brightness: 1 }, { hold: 10, spin: 10, rotation: [70, 0, 0] }))
      doc.scenes.push(scene(doc, 'helix', 'Helix', { kind: 'chase', a: '#0e2a4a', b: '#5ff2ff', speed: 0.3, width: 0.3, brightness: 1 }, { hold: 10, spin: 12 }, { turns: 3, radius: 0.3 }))
      doc.scenes.push(scene(doc, 'spiral', 'Spiral', { kind: 'gradient', a: '#ffffff', b: '#2bd2ff', angle: 0, brightness: 1 }, { hold: 6 }))
      return doc
    },
  },
]

export function demoById(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id)
}
