// ============================================================================
// S8-01/02/07: Project I/O — Save, Load, Save As
// ============================================================================
// Browser-based file save/load using Blob download and file picker APIs.
// Serializes all stores into a single .droneshow JSON file.
// ============================================================================

import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { usePlanesStore } from '../stores/planesStore'
import { serializeProject, deserializeProject } from '../graph/serialize'
import type { ShowGraph } from '../graph/types'

const FILE_EXTENSION = '.droneshow'
const MIME_TYPE = 'application/json'

/**
 * Gather all store data into a serialized JSON string.
 */
export function gatherProjectJSON(): string {
  const { nodes, edges } = useGraphStore.getState()
  const { meta, dronePool, constraints } = useProjectStore.getState()
  const { formations, generatedPoints, animatedDefs } = useFormationStore.getState()
  const { planes, activePlaneId } = usePlanesStore.getState()
  const graph: ShowGraph = { nodes, edges }
  return serializeProject(graph, meta, dronePool, constraints, formations, generatedPoints, animatedDefs, planes, activePlaneId)
}

/**
 * S8-01: Save — serialize project and trigger browser download.
 */
export function saveProject(): void {
  const json = gatherProjectJSON()
  const { meta } = useProjectStore.getState()
  const filename = sanitizeFilename(meta.name) + FILE_EXTENSION
  downloadBlob(json, filename, MIME_TYPE)

  // Update modified timestamp
  useProjectStore.getState().updateMeta({ modifiedAt: new Date().toISOString() })
}

/**
 * S8-07: Save As — prompt for new name, then save.
 */
export function saveProjectAs(newName: string): void {
  useProjectStore.getState().updateMeta({ name: newName })
  saveProject()
}

/**
 * S8-02: Load — open file picker, read JSON, validate, load into all stores.
 * Returns the project name on success, or throws on failure.
 */
export async function loadProjectFromFile(): Promise<string> {
  const json = await pickAndReadFile()
  return loadProjectFromJSON(json)
}

/**
 * Load project from a raw JSON string into all stores.
 */
export function loadProjectFromJSON(json: string): string {
  const data = deserializeProject(json)

  // Load graph
  useGraphStore.getState().loadGraph(data.graph)

  // Load project metadata — use defaults for missing fields (backward compat)
  if (data.meta || data.dronePool || data.constraints) {
    const store = useProjectStore.getState()
    const meta = data.meta ?? store.meta
    const dronePool = data.dronePool ?? store.dronePool
    const constraints = data.constraints ?? store.constraints
    store.loadProject(meta, dronePool, constraints)
  }

  // Load formations (including animated defs) — handle missing formationPoints gracefully
  if (data.formations) {
    useFormationStore.getState().loadFormations(
      data.formations,
      data.formationPoints ?? new Map(),
      data.animatedDefs,
    )
  }

  // Load build planes (additive; old files lack them → reset to empty)
  usePlanesStore.getState().loadPlanes(data.planes ?? [], data.activePlaneId ?? null)

  return data.meta?.name ?? 'Untitled Show'
}

// --- Helpers ---

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Untitled Show'
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function pickAndReadFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = FILE_EXTENSION + ',.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('No file selected'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    }
    // Handle cancel
    input.oncancel = () => reject(new Error('File selection cancelled'))
    input.click()
  })
}
