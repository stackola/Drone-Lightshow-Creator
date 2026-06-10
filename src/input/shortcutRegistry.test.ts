import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerShortcut,
  dispatchKey,
  listShortcuts,
  setScopeResolver,
  normalizeChord,
  type ShortcutDef,
} from './shortcutRegistry'

function key(k: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean }> = {}, target?: unknown): KeyboardEvent {
  return {
    key: k,
    ctrlKey: !!mods.ctrl,
    metaKey: false,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    target: target ?? null,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent
}

function def(partial: Partial<ShortcutDef> & { id: string; chord: string }): ShortcutDef {
  return {
    scope: 'global',
    label: partial.id,
    category: 'Test',
    action: vi.fn(),
    ...partial,
  } as ShortcutDef
}

let unregisters: Array<() => void> = []
function reg(d: ShortcutDef) {
  unregisters.push(registerShortcut(d))
  return d
}

describe('shortcutRegistry', () => {
  beforeEach(() => {
    unregisters.forEach((u) => u())
    unregisters = []
    setScopeResolver(() => ['global'])
  })

  it('normalizes chords with sorted modifiers', () => {
    expect(normalizeChord(key('Z', { ctrl: true, shift: true }))).toBe('ctrl+shift+z')
    expect(normalizeChord(key('Delete'))).toBe('delete')
    expect(normalizeChord(key(' ', { ctrl: true }))).toBe('ctrl+space')
    // Symbol keys already encode shift — no shift+ prefix.
    expect(normalizeChord(key('?', { shift: true }))).toBe('?')
    expect(normalizeChord(key('ArrowLeft', { shift: true }))).toBe('shift+arrowleft')
  })

  it('dispatches to a matching global binding', () => {
    const d = reg(def({ id: 'undo', chord: 'ctrl+z' }))
    expect(dispatchKey(key('z', { ctrl: true }))).toBe(true)
    expect(d.action).toHaveBeenCalledTimes(1)
  })

  it('does not fire bindings from inactive scopes', () => {
    const d = reg(def({ id: 'group', chord: 'ctrl+g', scope: 'graph' }))
    setScopeResolver(() => ['global'])
    expect(dispatchKey(key('g', { ctrl: true }))).toBe(false)
    expect(d.action).not.toHaveBeenCalled()
  })

  it('higher-priority scope wins on chord collision across scopes', () => {
    const graphDef = reg(def({ id: 'graph-g', chord: 'ctrl+g', scope: 'graph' }))
    const globalDef = reg(def({ id: 'global-g', chord: 'ctrl+g', scope: 'global' }))
    setScopeResolver(() => ['graph', 'global'])
    dispatchKey(key('g', { ctrl: true }))
    expect(graphDef.action).toHaveBeenCalledTimes(1)
    expect(globalDef.action).not.toHaveBeenCalled()
  })

  it('skips bindings while typing unless allowInInputs', () => {
    const input = { tagName: 'INPUT', isContentEditable: false }
    const normal = reg(def({ id: 'space', chord: 'space' }))
    const escape = reg(def({ id: 'esc', chord: 'escape', allowInInputs: true }))
    expect(dispatchKey(key(' ', {}, input))).toBe(false)
    expect(normal.action).not.toHaveBeenCalled()
    expect(dispatchKey(key('Escape', {}, input))).toBe(true)
    expect(escape.action).toHaveBeenCalled()
  })

  it('respects when() guards', () => {
    const d = reg(def({ id: 'guarded', chord: 'f', when: () => false }))
    expect(dispatchKey(key('f'))).toBe(false)
    expect(d.action).not.toHaveBeenCalled()
  })

  it('fires double-tap chords on two quick taps', () => {
    const d = reg(def({ id: 'ground', chord: 'g g' }))
    expect(dispatchKey(key('g'))).toBe(false)
    expect(dispatchKey(key('g'))).toBe(true)
    expect(d.action).toHaveBeenCalledTimes(1)
    // A third tap starts a fresh sequence, not an immediate re-fire.
    expect(dispatchKey(key('g'))).toBe(false)
  })

  it('unregister removes the binding', () => {
    const d = def({ id: 'temp', chord: 'x' })
    const un = registerShortcut(d)
    un()
    expect(dispatchKey(key('x'))).toBe(false)
    expect(listShortcuts().find((s) => s.id === 'temp')).toBeUndefined()
  })
})
