// ============================================================================
// S8-03/04/09: Autosave & Recovery — IndexedDB persistence
// ============================================================================
// - 5 rotating autosave slots, saved on mutation (debounced 2s)
// - Recent projects metadata list
// - Crash recovery: detect incomplete saves, offer restore
// ============================================================================

import { gatherProjectJSON } from './projectIO'
import { toast } from '../components/Toast'

const DB_NAME = 'droneshow-autosave'
const DB_VERSION = 1
const AUTOSAVE_STORE = 'autosaves'
const RECENT_STORE = 'recent-projects'
const MAX_AUTOSAVE_SLOTS = 5

export interface AutosaveEntry {
  slot: number
  projectId: string
  projectName: string
  timestamp: number
  droneCount: number
  json: string
  dirty: boolean // true = write started, false = write completed
}

export interface RecentProject {
  id: string
  name: string
  lastOpened: number
  droneCount: number
  duration: number
  thumbnail?: string // base64 data URL (future)
}

// --- Database ---

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) {
        db.createObjectStore(AUTOSAVE_STORE, { keyPath: 'slot' })
      }
      if (!db.objectStoreNames.contains(RECENT_STORE)) {
        db.createObjectStore(RECENT_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function txStore(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then((db) => {
    const tx = db.transaction(storeName, mode)
    return tx.objectStore(storeName)
  })
}

function idbPut<T>(storeName: string, value: T): Promise<void> {
  return txStore(storeName, 'readwrite').then(
    (store) =>
      new Promise((resolve, reject) => {
        const req = store.put(value)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      }),
  )
}

function idbGetAll<T>(storeName: string): Promise<T[]> {
  return txStore(storeName, 'readonly').then(
    (store) =>
      new Promise((resolve, reject) => {
        const req = store.getAll()
        req.onsuccess = () => resolve(req.result as T[])
        req.onerror = () => reject(req.error)
      }),
  )
}

function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  return txStore(storeName, 'readwrite').then(
    (store) =>
      new Promise((resolve, reject) => {
        const req = store.delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      }),
  )
}

// --- Autosave (S8-03) ---

let currentSlot = 0

export async function performAutosave(projectId: string, projectName: string, droneCount: number): Promise<void> {
  const slot = currentSlot % MAX_AUTOSAVE_SLOTS
  currentSlot++

  // Mark dirty before writing
  const entry: AutosaveEntry = {
    slot,
    projectId,
    projectName,
    timestamp: Date.now(),
    droneCount,
    json: '',
    dirty: true,
  }
  await idbPut(AUTOSAVE_STORE, entry)

  // Serialize and write
  const json = gatherProjectJSON()
  entry.json = json
  entry.dirty = false
  await idbPut(AUTOSAVE_STORE, entry)
}

/**
 * Get the most recent valid (non-dirty) autosave for a given project, or the latest overall.
 */
export async function getLatestAutosave(projectId?: string): Promise<AutosaveEntry | null> {
  const entries = await idbGetAll<AutosaveEntry>(AUTOSAVE_STORE)
  const valid = entries
    .filter((e) => !e.dirty && e.json)
    .sort((a, b) => b.timestamp - a.timestamp)

  if (projectId) {
    return valid.find((e) => e.projectId === projectId) ?? valid[0] ?? null
  }
  return valid[0] ?? null
}

/**
 * S8-09: Check for incomplete (dirty) autosaves — indicates a crash.
 */
export async function checkForCrashRecovery(): Promise<AutosaveEntry | null> {
  const entries = await idbGetAll<AutosaveEntry>(AUTOSAVE_STORE)
  // If there are dirty entries, the previous session may have crashed.
  // Return the most recent valid save as the recovery candidate.
  const hasDirty = entries.some((e) => e.dirty)
  if (!hasDirty) return null

  const valid = entries
    .filter((e) => !e.dirty && e.json)
    .sort((a, b) => b.timestamp - a.timestamp)
  return valid[0] ?? null
}

export async function clearAutosaves(): Promise<void> {
  const entries = await idbGetAll<AutosaveEntry>(AUTOSAVE_STORE)
  for (const e of entries) {
    await idbDelete(AUTOSAVE_STORE, e.slot)
  }
  currentSlot = 0
}

// --- Recent Projects (S8-04) ---

export async function addRecentProject(project: RecentProject): Promise<void> {
  await idbPut(RECENT_STORE, project)
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  const projects = await idbGetAll<RecentProject>(RECENT_STORE)
  return projects.sort((a, b) => b.lastOpened - a.lastOpened)
}

export async function removeRecentProject(id: string): Promise<void> {
  await idbDelete(RECENT_STORE, id)
}

// --- Debounced Autosave Hook ---

let autosaveTimer: ReturnType<typeof setTimeout> | null = null
const AUTOSAVE_DEBOUNCE_MS = 2000

export function scheduleAutosave(projectId: string, projectName: string, droneCount: number): void {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    performAutosave(projectId, projectName, droneCount).catch((err) => {
      console.warn('Autosave failed:', err)
      // L5-toast: surface autosave failures so users know their work isn't being persisted.
      toast.error(`Autosave failed — your work is not being saved.\n${err instanceof Error ? err.message : 'Unknown error'}`)
    })
  }, AUTOSAVE_DEBOUNCE_MS)
}

export function cancelPendingAutosave(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
}
