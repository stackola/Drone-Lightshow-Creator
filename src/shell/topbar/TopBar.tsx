// ============================================================================
// TopBar — the new shell's 44px header: project identity (inline rename +
// unsaved dot), show stats, Build/Graph/Audience mode switcher, and the
// global actions (AI, export, save, help). Built on the ui/ primitives.
// Accessible names and data-testids match the legacy HeaderBar where e2e
// depends on them (mode-toggle-build/graph, "Rename project", …).
// ============================================================================

import { useState, useCallback } from 'react'
import { Save, FilePlus, FileDown, HelpCircle, Pencil, Check, X, Download, Sparkles, Settings } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useGraphStore } from '../../stores/graphStore'
import { useUiModeStore, type EditorMode } from '../../stores/uiModeStore'
import { useViewStore } from '../../stores/viewStore'
import { saveProject, saveProjectAs, loadProjectFromFile } from '../../services/projectIO'
import { toast } from '../../components/Toast'
import { Tooltip } from '../../components/Tooltip'
import { IconButton, Button } from '../../components/ui'

export interface TopBarProps {
  hasUnsavedChanges: boolean
  onShowWelcome: () => void
  onShowShortcuts: () => void
  onShowExport: () => void
  /** Optional until AppShell wiring lands with the SettingsDialog. */
  onShowSettings?: () => void
  onMarkSaved: () => void
  onToggleAI: () => void
  aiOpen: boolean
}

export function TopBar({ hasUnsavedChanges, onShowWelcome, onShowShortcuts, onShowExport, onShowSettings, onMarkSaved, onToggleAI, aiOpen }: TopBarProps) {
  const meta = useProjectStore((s) => s.meta)
  const droneCount = useProjectStore((s) => s.dronePool.droneCount)
  const nodes = useGraphStore((s) => s.nodes)
  const getCachedTiming = useGraphStore((s) => s.getCachedTiming)
  const mode = useUiModeStore((s) => s.mode)
  const setMode = useUiModeStore((s) => s.setMode)
  const audiencePanelOpen = useViewStore((s) => s.audience.panelOpen)
  const toggleAudiencePanel = useViewStore((s) => s.toggleAudiencePanel)

  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const timing = getCachedTiming()
  let maxEnd = 0
  timing.forEach((range) => {
    if (range.end > maxEnd) maxEnd = range.end
  })
  const totalSec = Math.round(maxEnd)
  const durationStr = nodes.length > 0 ? `${Math.floor(totalSec / 60)}m ${(totalSec % 60).toString().padStart(2, '0')}s` : '--'

  const confirmRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== meta.name) {
      useProjectStore.getState().updateMeta({ name: trimmed })
    }
    setIsRenaming(false)
  }, [renameValue, meta.name])

  const handleSave = useCallback(() => {
    saveProject()
    onMarkSaved()
  }, [onMarkSaved])

  const handleSaveAs = useCallback(() => {
    const name = prompt('Save as:', meta.name)
    if (name?.trim()) {
      saveProjectAs(name.trim())
      onMarkSaved()
    }
  }, [meta.name, onMarkSaved])

  const handleOpen = useCallback(() => {
    loadProjectFromFile()
      .then(() => onMarkSaved())
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        toast.error(`Failed to open project: ${err instanceof Error ? err.message : 'Unknown error'}`)
      })
  }, [onMarkSaved])

  const modeButton = (m: EditorMode, label: string) => (
    <Button
      variant="toggle"
      size="sm"
      active={mode === m}
      data-testid={`mode-toggle-${m}`}
      onClick={() => setMode(m)}
    >
      {label}
    </Button>
  )

  return (
    <div className="h-11 bg-surface-raised border-b border-white/10 flex items-center px-3 gap-3 flex-shrink-0">
      {/* Identity */}
      <div className="flex items-center gap-1.5 min-w-0">
        {isRenaming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename()
                if (e.key === 'Escape') setIsRenaming(false)
              }}
              onBlur={confirmRename}
              className="bg-white/10 text-white text-sm px-2 py-0.5 rounded border border-white/20 outline-none focus:border-accent-primary w-48"
            />
            <button onClick={confirmRename} className="text-green-400 hover:text-green-300" aria-label="Confirm rename">
              <Check size={14} />
            </button>
            <button onClick={() => setIsRenaming(false)} className="text-red-400 hover:text-red-300" aria-label="Cancel rename">
              <X size={14} />
            </button>
          </div>
        ) : (
          <Tooltip label="Click to rename" side="bottom">
            <button
              onClick={() => {
                setRenameValue(meta.name)
                setIsRenaming(true)
              }}
              className="flex items-center gap-1 text-sm text-white/80 hover:text-white transition-colors truncate max-w-[220px] group"
              aria-label="Rename project"
            >
              {hasUnsavedChanges && <span className="text-orange-400 text-lg leading-none -mt-0.5">&bull;</span>}
              <span className="truncate">{meta.name}</span>
              <Pencil size={11} className="text-white/30 group-hover:text-white/60 flex-shrink-0" />
            </button>
          </Tooltip>
        )}
        <div className="w-px h-4 bg-white/10 mx-1" />
        <div className="text-micro text-white/40 flex items-center gap-2 whitespace-nowrap">
          <span>{droneCount} drones</span>
          <span className="text-white/20">|</span>
          <span>{durationStr}</span>
        </div>
      </div>

      {/* Mode switcher — centered */}
      <div className="flex-1 flex justify-center">
        <div className="floating-panel flex items-center gap-0.5 p-0.5 !rounded-full">
          {modeButton('build', 'Build')}
          {modeButton('graph', 'Graph')}
          <Button
            variant="toggle"
            size="sm"
            active={audiencePanelOpen}
            data-testid="mode-toggle-audience"
            onClick={toggleAudiencePanel}
          >
            Audience
          </Button>
        </div>
      </div>

      {/* Global actions */}
      <div className="flex items-center gap-0.5">
        <Tooltip label={aiOpen ? 'Close AI co-designer' : 'AI co-designer'} side="bottom">
          <IconButton aria-label="AI assistant" active={aiOpen} onClick={onToggleAI}>
            <Sparkles size={14} />
          </IconButton>
        </Tooltip>
        <div className="w-px h-4 bg-white/10 mx-1" />
        <Tooltip label="New / open project" side="bottom">
          <IconButton aria-label="New / Open project" onClick={onShowWelcome}>
            <FilePlus size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Open project file" shortcut="Ctrl+O" side="bottom">
          <IconButton aria-label="Open project file" onClick={handleOpen}>
            <FileDown size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Save project" shortcut="Ctrl+S" side="bottom">
          <IconButton aria-label="Save project" onClick={handleSave}>
            <Save size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Save as…" shortcut="Ctrl+Shift+S" side="bottom">
          <IconButton aria-label="Save as" onClick={handleSaveAs}>
            <Download size={14} className="rotate-180" />
          </IconButton>
        </Tooltip>
        <Tooltip label="Export show" shortcut="Ctrl+E" side="bottom">
          <IconButton aria-label="Export" onClick={onShowExport}>
            <Download size={14} />
          </IconButton>
        </Tooltip>
        {onShowSettings && (
          <Tooltip label="Project settings" side="bottom">
            <IconButton aria-label="Project settings" onClick={onShowSettings}>
              <Settings size={14} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip label="Keyboard shortcuts" shortcut="?" side="bottom">
          <IconButton aria-label="Keyboard shortcuts" onClick={onShowShortcuts}>
            <HelpCircle size={14} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  )
}
