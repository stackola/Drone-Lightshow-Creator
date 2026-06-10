// The clipboardStore mirrors to localStorage; in the node test env we
// install a minimal stub so the localStorage-coupled paths are exercisable
// without pulling in jsdom.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setClipboard, getClipboard, hasClipboard, type ClipboardPayload } from './clipboardStore'
import { makeFormationNode, makeFlowEdge } from '../graph/helpers.test-utils'

function makeLocalStorageStub(): Storage {
  const store = new Map<string, string>()
  return {
    get length() { return store.size },
    clear: () => { store.clear() },
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  } as Storage
}

vi.stubGlobal('localStorage', makeLocalStorageStub())

function payload(): ClipboardPayload {
  return {
    nodes: [makeFormationNode({ id: 'a' })],
    edges: [makeFlowEdge('e1', 'a', 'b')],
    origin: { x: 100, y: 200 },
    timestamp: Date.now(),
  }
}

describe('clipboardStore', () => {
  beforeEach(() => {
    setClipboard(null)
    try { localStorage.removeItem('drone-clipboard-v1') } catch { /* noop in test env */ }
  })

  it('hasClipboard reports false when empty', () => {
    expect(hasClipboard()).toBe(false)
    expect(getClipboard()).toBeNull()
  })

  it('setClipboard + getClipboard round-trip', () => {
    const p = payload()
    setClipboard(p)
    expect(hasClipboard()).toBe(true)
    const got = getClipboard()
    expect(got).not.toBeNull()
    expect(got!.nodes[0]!.id).toBe('a')
    expect(got!.origin).toEqual({ x: 100, y: 200 })
  })

  it('setClipboard(null) clears', () => {
    setClipboard(payload())
    setClipboard(null)
    expect(hasClipboard()).toBe(false)
    expect(getClipboard()).toBeNull()
  })

  it('mirrors to localStorage so paste survives a page reload (simulated)', () => {
    const p = payload()
    setClipboard(p)
    const raw = localStorage.getItem('drone-clipboard-v1')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.nodes[0].id).toBe('a')
    expect(parsed.origin).toEqual({ x: 100, y: 200 })
  })

  it('rehydrates from localStorage on first read after module-state reset', () => {
    const p = payload()
    setClipboard(p)
    // Reset the in-memory pointer the way a page reload would.
    setClipboard(null)
    // But put the payload back into localStorage manually.
    localStorage.setItem('drone-clipboard-v1', JSON.stringify(p))
    expect(getClipboard()?.nodes[0]?.id).toBe('a')
    expect(hasClipboard()).toBe(true)
  })

  it('rejects malformed localStorage payloads', () => {
    localStorage.setItem('drone-clipboard-v1', JSON.stringify({ junk: 'value' }))
    expect(getClipboard()).toBeNull()
  })
})
