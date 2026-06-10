// ============================================================================
// Welcome Screen — New Project, Open File, Recent Projects, Demos
// Slice 3 Step 4-5: replaced inline demo buttons with <DemoGrid> driven by
// DEMO_REGISTRY, added destructive-load confirm dialog.
// ============================================================================

import { useState, useEffect, useCallback } from 'react'
import { FilePlus, FolderOpen, Clock, LayoutGrid, GitBranch } from 'lucide-react'
import { getLatestAutosave, getRecentProjects, type RecentProject, removeRecentProject } from '../services/autosave'
import { loadProjectFromFile, loadProjectFromJSON, saveProject } from '../services/projectIO'
import { useGraphStore } from '../stores/graphStore'
import { Tooltip } from './Tooltip'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import type {
  LaunchNodeData,
  FormationNodeData,
  LandNodeData,
} from '../graph/types'
import { DEMO_REGISTRY, type DemoDescriptor } from '../app/demos'
import { DemoGrid } from './welcome/DemoGrid'
import { ReplaceShowConfirmDialog } from './welcome/ReplaceShowConfirmDialog'
import { seedSplitStory } from '../app/demos/splitStory'

interface WelcomeScreenProps {
  onClose: () => void
}

interface ProjectTemplate {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  create: () => void
}

export function createBlankProject(): void {
  const store = useGraphStore.getState()
  const projectStore = useProjectStore.getState()
  store.loadGraph({ nodes: [], edges: [] })
  projectStore.setDroneCount(100)
  projectStore.updateMeta({
    id: `project-${Date.now()}`,
    name: 'Untitled Show',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  })
  const launchId = store.addNode('launch', { x: 0, y: 150 }, {
    droneCount: 100, startTime: 0, staggerDelay: 0.02,
  } as LaunchNodeData)
  const landId = store.addNode('land', { x: 600, y: 150 }, {
    staggerDelay: 0.02,
  } as LandNodeData)
  store.addEdge(launchId, 'flow-out', landId, 'flow-in', 'flow')
}

export function createSimpleLinearProject(): void {
  const store = useGraphStore.getState()
  const projectStore = useProjectStore.getState()
  const formationStore = useFormationStore.getState()
  store.loadGraph({ nodes: [], edges: [] })
  projectStore.setDroneCount(100)
  projectStore.updateMeta({
    id: `project-${Date.now()}`,
    name: 'Simple Linear Show',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  })
  // radius 25 (not 10) so the 100 drones fit with ≥1.5m pair spacing —
  // the 1.5m default minDroneDistance constraint was violated at radius 10
  // (62.8m / 100 = 0.63m closest pair). 2026-05-21.
  const ringId = formationStore.addFormation('Opening Ring', 'ring', { count: 100, radius: 25 })
  const gridId = formationStore.addFormation('Final Grid', 'grid', { count: 100, cols: 10, spacing: 2 })
  const launchId = store.addNode('launch', { x: 0, y: 150 }, {
    droneCount: 100, startTime: 0, staggerDelay: 0.02,
  } as LaunchNodeData)
  // startTime 12 so the last launched drone has enough time to fly up
  // to the ring (radius 25 at y=15) without exceeding the 8 m/s default
  // velocity limit. 2026-05-21.
  const form1Id = store.addNode('formation', { x: 200, y: 150 }, {
    formationId: ringId, startTime: 12, duration: 10,
    transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)
  const form2Id = store.addNode('formation', { x: 600, y: 150 }, {
    formationId: gridId, startTime: 27, duration: 10,
    transform: { position: { x: 0, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)
  const landId = store.addNode('land', { x: 800, y: 150 }, {
    staggerDelay: 0.02,
  } as LandNodeData)
  // Flow edges carry explicit transition configs with adequate preferredDurations
  // so the post-Slice-3 validator (no per-frame nudge masking close passes) sees
  // clean motion-spacing on every transition. Defaults of 2s were too tight for
  // 100 drones converging from launch grid → ring at radius 25.
  store.addEdge(launchId, 'flow-out', form1Id, 'flow-in', 'flow', undefined, {
    strategyId: 'shortest-path', parameters: {}, preferredDuration: 5, pushPolicy: 'auto', locked: false,
  })
  store.addEdge(form1Id, 'flow-out', form2Id, 'flow-in', 'flow', undefined, {
    strategyId: 'shortest-path', parameters: {}, preferredDuration: 5, pushPolicy: 'auto', locked: false,
  })
  store.addEdge(form2Id, 'flow-out', landId, 'flow-in', 'flow', undefined, {
    strategyId: 'shortest-path', parameters: {}, preferredDuration: 4, pushPolicy: 'auto', locked: false,
  })
}

/**
 * Slice 3 Step 5: detect whether the current graph has user-authored content.
 * Returns false for: empty, blank-canvas template, or other tiny seeds — true otherwise.
 */
function graphHasUserContent(): boolean {
  const { nodes, edges } = useGraphStore.getState()
  return nodes.length > 2 || edges.length > 1
}

export function WelcomeScreen({ onClose }: WelcomeScreenProps) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pendingDemo, setPendingDemo] = useState<DemoDescriptor | null>(null)

  useEffect(() => {
    getRecentProjects().then(setRecentProjects).catch(() => {})
  }, [])

  const templates: ProjectTemplate[] = [
    {
      id: 'blank',
      name: 'Blank Canvas',
      description: 'Empty project with launch and land nodes',
      icon: <FilePlus size={24} />,
      create: createBlankProject,
    },
    {
      id: 'simple-linear',
      name: 'Simple Linear',
      description: 'Launch → Formation → Transition → Formation → Land',
      icon: <LayoutGrid size={24} />,
      create: createSimpleLinearProject,
    },
    {
      id: 'split-show',
      name: 'Split/Merge Starter',
      description: 'Empty split/merge skeleton you can build on',
      icon: <GitBranch size={24} />,
      create: seedSplitStory,
    },
  ]

  const handleNewProject = useCallback((template: ProjectTemplate) => {
    template.create()
    onClose()
  }, [onClose])

  const handleOpenFile = useCallback(async () => {
    try {
      setLoadError(null)
      await loadProjectFromFile()
      onClose()
    } catch (err) {
      if ((err as Error).message === 'File selection cancelled') return
      setLoadError((err as Error).message)
    }
  }, [onClose])

  const handleSelectDemo = useCallback((demo: DemoDescriptor) => {
    if (graphHasUserContent()) {
      setPendingDemo(demo)
      return
    }
    demo.seed()
    onClose()
  }, [onClose])

  const handleReplace = useCallback(() => {
    if (!pendingDemo) return
    pendingDemo.seed()
    setPendingDemo(null)
    onClose()
  }, [pendingDemo, onClose])

  const handleSaveAndReplace = useCallback(async () => {
    if (!pendingDemo) return
    try {
      saveProject()
      pendingDemo.seed()
      setPendingDemo(null)
      onClose()
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [pendingDemo, onClose])

  const handleLoadRecent = useCallback(async (project: RecentProject) => {
    try {
      const entry = await getLatestAutosave(project.id)
      if (entry) {
        loadProjectFromJSON(entry.json)
        onClose()
      }
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [onClose])

  const handleRemoveRecent = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await removeRecentProject(id)
    setRecentProjects((prev) => prev.filter((p) => p.id !== id))
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-surface/95 flex items-center justify-center animate-backdrop-in">
      <div className="animate-dialog-in bg-surface-raised border border-white/10 rounded-lg shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <h1 className="text-2xl font-bold text-white">Drone Show Designer</h1>
          <p className="text-sm text-white/50 mt-1">Create stunning drone light shows</p>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: New Project */}
          <div>
            <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-3">New Project</h2>
            <div className="space-y-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleNewProject(t)}
                  className="w-full flex items-center gap-3 p-3 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-left"
                >
                  <div className="text-accent-primary flex-shrink-0">{t.icon}</div>
                  <div>
                    <div className="text-sm font-medium text-white">{t.name}</div>
                    <div className="text-xs text-white/40">{t.description}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4">
              <button
                onClick={handleOpenFile}
                className="w-full flex items-center gap-3 p-3 rounded-md bg-accent-primary/15 hover:bg-accent-primary/25 border border-accent-primary/30 transition-colors text-left"
              >
                <FolderOpen size={24} className="text-accent-primary flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-white">Open File</div>
                  <div className="text-xs text-white/40">Load a .droneshow or .json file</div>
                </div>
              </button>
            </div>
          </div>

          {/* Column 2 & 3: Demos */}
          <div className="lg:col-span-2">
            <DemoGrid onSelect={handleSelectDemo} />
          </div>
        </div>

        {/* Recent Projects */}
        <div className="px-6 pb-4">
          <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-3">
            <Clock size={14} className="inline mr-1 -mt-0.5" /> Recent Projects
          </h2>
          {recentProjects.length === 0 ? (
            <div className="py-4 flex flex-col items-center justify-center gap-1.5 text-center">
              <Clock size={20} className="text-white/20" aria-hidden="true" />
              <div className="text-sm text-white/40">No recent projects</div>
              <div className="text-caption text-white/25 max-w-[300px] leading-relaxed">
                Open or save any project once and it&apos;ll appear here for one-click reload.
              </div>
            </div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {recentProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleLoadRecent(p)}
                  className="w-full flex items-center justify-between p-3 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-left group"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{p.name}</div>
                    <div className="text-xs text-white/40">
                      {p.droneCount} drones &middot; {formatDuration(p.duration)} &middot; {formatDate(p.lastOpened)}
                    </div>
                  </div>
                  <Tooltip label="Remove from recent" side="left">
                    <button
                      onClick={(e) => handleRemoveRecent(e, p.id)}
                      className="text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2"
                      aria-label="Remove from recent"
                    >
                      &times;
                    </button>
                  </Tooltip>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error display */}
        {loadError && (
          <div className="mx-6 mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded text-sm text-red-300">
            {loadError}
          </div>
        )}

        {/* Footer — skip welcome */}
        <div className="p-4 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Skip &mdash; continue with current project
          </button>
        </div>
      </div>

      {pendingDemo && (
        <ReplaceShowConfirmDialog
          demoName={pendingDemo.name}
          onCancel={() => setPendingDemo(null)}
          onReplace={handleReplace}
          onSaveAndReplace={handleSaveAndReplace}
        />
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return d.toLocaleDateString()
}

// Inadvertent unused-symbol cleanup: DEMO_REGISTRY consumed via DemoGrid.
void DEMO_REGISTRY
