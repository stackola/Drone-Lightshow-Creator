// ============================================================================
// L5-copy-paste (2026-05-21) — module-level clipboard for nodes + connecting
// edges. Stored at module scope (and optionally mirrored to localStorage so
// paste survives page refresh). Independent of the system clipboard so it
// works without `navigator.clipboard` permissions.
// ============================================================================

import type { ShowNode, ShowEdge } from '../graph/types'

const STORAGE_KEY = 'drone-clipboard-v1'

export interface ClipboardPayload {
  nodes: ShowNode[]
  edges: ShowEdge[]
  /** Reference position used to compute the offset on paste. */
  origin: { x: number; y: number }
  /** Wall-clock timestamp for debugging / "Paste from N min ago" toasts. */
  timestamp: number
}

let memory: ClipboardPayload | null = null

function persist(payload: ClipboardPayload | null): void {
  try {
    if (payload) localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* localStorage blocked — in-memory clipboard still works */ }
}

function load(): ClipboardPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges) && parsed.origin) {
      return parsed as ClipboardPayload
    }
    return null
  } catch { return null }
}

export function setClipboard(payload: ClipboardPayload | null): void {
  memory = payload
  persist(payload)
}

export function getClipboard(): ClipboardPayload | null {
  if (memory) return memory
  // Lazy-rehydrate from localStorage on first read.
  memory = load()
  return memory
}

export function hasClipboard(): boolean {
  return getClipboard() !== null
}
