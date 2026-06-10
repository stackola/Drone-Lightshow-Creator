// ============================================================================
// S17-07: Node Search/Filter — command palette (Ctrl+K)
// L5-cmd-palette (2026-05-21): extended to a full command palette — actions +
// nodes + arrow-key nav + recent commands. Still opened by Ctrl+K.
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search, X, type LucideIcon, ChevronRight, Save, FolderOpen, Download, Undo, Redo, Eye, EyeOff, Play, PauseCircle, Wand2, Hash, SearchX } from 'lucide-react'
import { useGraphStore } from '../stores/graphStore'
import { useFormationStore } from '../stores/formationStore'
import { getIdleBehavior } from '../registries/idleBehaviors'
import { useSelectionStore } from '../stores/selectionStore'
import { useViewStore } from '../stores/viewStore'
import { usePlayheadStore } from '../stores/playheadStore'
import { useHistoryStore } from '../stores/historyStore'
import { saveProject, loadProjectFromFile } from '../services/projectIO'
import { toast } from './Toast'

interface NodeSearchPaletteProps {
  onClose: () => void
}

interface Command {
  id: string
  label: string
  description?: string
  shortcut?: string
  icon: LucideIcon
  run: () => void
}

// L5-cmd-palette: recent commands persist in localStorage so they bubble to
// the top on next open.
const RECENT_KEY = 'cmd-palette-recent-v1'
function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string').slice(0, 8) : []
  } catch { return [] }
}
function pushRecent(id: string): void {
  try {
    const prev = loadRecent().filter((s) => s !== id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...prev].slice(0, 8)))
  } catch { /* localStorage full / blocked */ }
}

function fuzzyScore(text: string, query: string): number {
  // Cheap fuzzy: every query char must appear in order; closer-clustered = higher score.
  // Returns 0 for no match, > 0 for match (higher = better).
  if (!query) return 1
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0, lastIdx = -1, score = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += lastIdx === -1 || i - lastIdx === 1 ? 2 : 1
      lastIdx = i
      qi++
    }
  }
  return qi === q.length ? score / Math.max(1, t.length) : 0
}

export function NodeSearchPalette({ onClose }: NodeSearchPaletteProps) {
  const nodes = useGraphStore((s) => s.nodes)
  const selectNodes = useSelectionStore((s) => s.selectNodes)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const [recentIds, setRecentIds] = useState<string[]>(() => loadRecent())

  // Build the action command list. Recomputed on each render (cheap).
  const commands: Command[] = useMemo(() => {
    const v = useViewStore.getState()
    const ph = usePlayheadStore.getState()
    const hist = useHistoryStore.getState()
    const cmds: Command[] = [
      {
        id: 'save', label: 'Save Project', description: 'Save to file', shortcut: 'Ctrl+S', icon: Save,
        run: () => { saveProject(); toast.success('Project saved') },
      },
      {
        id: 'open', label: 'Open Project…', description: 'Load from file', shortcut: 'Ctrl+O', icon: FolderOpen,
        run: () => { loadProjectFromFile().catch((e) => { if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error(`Open failed: ${(e as Error).message}`) }) },
      },
      {
        id: 'export', label: 'Export…', description: 'CSV / JSON / video', shortcut: 'Ctrl+E', icon: Download,
        run: () => { window.dispatchEvent(new CustomEvent('open-export-dialog')) },
      },
      {
        id: 'undo', label: `Undo${hist.labelForNextUndo() ? `: ${hist.labelForNextUndo()}` : ''}`, shortcut: 'Ctrl+Z', icon: Undo,
        run: () => { const l = hist.labelForNextUndo(); hist.undo(); if (l) toast.info(`Undo: ${l}`, { duration: 1500 }) },
      },
      {
        id: 'redo', label: `Redo${hist.labelForNextRedo() ? `: ${hist.labelForNextRedo()}` : ''}`, shortcut: 'Ctrl+Shift+Z', icon: Redo,
        run: () => { const l = hist.labelForNextRedo(); hist.redo(); if (l) toast.info(`Redo: ${l}`, { duration: 1500 }) },
      },
      {
        id: 'toggle-starfield', label: v.showStarfield ? 'Hide Starfield' : 'Show Starfield', icon: v.showStarfield ? EyeOff : Eye,
        run: () => { useViewStore.getState().toggleStarfield() },
      },
      {
        id: 'toggle-bloom-editor', label: v.audience.bloomEditor ? 'Disable Bloom (editor)' : 'Enable Bloom (editor)', icon: v.audience.bloomEditor ? EyeOff : Eye,
        run: () => { useViewStore.getState().toggleBloom('editor') },
      },
      {
        id: 'toggle-audience', label: v.audience.panelOpen ? 'Close Audience View' : 'Open Audience View', icon: v.audience.panelOpen ? EyeOff : Eye,
        run: () => { useViewStore.getState().toggleAudiencePanel() },
      },
      {
        id: 'play-pause', label: ph.isPlaying ? 'Pause' : 'Play', shortcut: 'Space', icon: ph.isPlaying ? PauseCircle : Play,
        run: () => { usePlayheadStore.getState().setPlaying(!usePlayheadStore.getState().isPlaying) },
      },
      {
        id: 'goto-start', label: 'Go to Start', icon: ChevronRight,
        run: () => { usePlayheadStore.getState().setCurrentTime(0) },
      },
      {
        id: 'create-formation-ai', label: 'Create Formation from Text…', description: 'Open AI chat', icon: Wand2,
        run: () => { window.dispatchEvent(new CustomEvent('open-ai-dialog')) },
      },
      {
        id: 'open-history', label: 'Open History Palette', shortcut: 'Ctrl+Shift+H', icon: Undo,
        run: () => { window.dispatchEvent(new CustomEvent('open-history-palette')) },
      },
    ]
    return cmds
  }, [])

  // Combined result list.
  interface ResultItem {
    kind: 'command' | 'node'
    id: string
    label: string
    description?: string
    shortcut?: string
    icon?: LucideIcon
    nodeType?: string
    score: number
  }

  const results: ResultItem[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const items: ResultItem[] = []
    // Commands
    for (const c of commands) {
      const score = q
        ? Math.max(fuzzyScore(c.label, q), fuzzyScore(c.description ?? '', q) * 0.5)
        : (recentIds.indexOf(c.id) >= 0 ? 10 - recentIds.indexOf(c.id) : 1)
      if (score > 0) {
        items.push({ kind: 'command', id: c.id, label: c.label, description: c.description, shortcut: c.shortcut, icon: c.icon, score })
      }
    }
    // Nodes — surface a human-readable label so users searching for
    // "Opening Ring" / "Ant Trail" / "Orbit" can find the right node.
    const formations = useFormationStore.getState().formations
    for (const n of nodes) {
      let displayLabel: string
      if (n.type === 'formation') {
        const fd = n.data as { formationId: string | null }
        const name = fd.formationId ? formations.find((f) => f.id === fd.formationId)?.name : null
        displayLabel = name ? `Formation · ${name}` : `Formation · ${n.id.slice(0, 8)}`
      } else if (n.type === 'idle') {
        const id = n.data as { behavior: string }
        displayLabel = `Idle · ${getIdleBehavior(id.behavior)?.name ?? id.behavior}`
      } else {
        displayLabel = `${n.type.charAt(0).toUpperCase()}${n.type.slice(1)} · ${n.id.slice(0, 8)}`
      }
      const text = `${displayLabel} ${n.type} ${n.id} ${JSON.stringify(n.data)}`
      const score = q ? fuzzyScore(text, q) : (recentIds.indexOf(`node:${n.id}`) >= 0 ? 8 - recentIds.indexOf(`node:${n.id}`) : 0.3)
      if (score > 0) {
        items.push({ kind: 'node', id: n.id, label: displayLabel, nodeType: n.type, score })
      }
    }
    items.sort((a, b) => b.score - a.score)
    return items.slice(0, 24)
  }, [query, commands, nodes, recentIds])

  // Keep activeIdx within bounds when results change.
  useEffect(() => { setActiveIdx(0) }, [query])

  const invoke = useCallback((item: ResultItem) => {
    if (item.kind === 'command') {
      const cmd = commands.find((c) => c.id === item.id)
      if (cmd) {
        pushRecent(item.id)
        setRecentIds(loadRecent())
        cmd.run()
      }
    } else {
      pushRecent(`node:${item.id}`)
      setRecentIds(loadRecent())
      selectNodes([item.id])
    }
    onClose()
  }, [commands, selectNodes, onClose])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(results.length - 1, i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = results[activeIdx]
        if (item) invoke(item)
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, results, activeIdx, invoke])

  // Scroll the active result into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[15vh] animate-backdrop-in" onClick={onClose}>
      <div className="animate-dialog-in bg-surface-raised border border-white/10 rounded-lg shadow-2xl w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <Search size={16} className="text-white/40" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search nodes…"
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-white/30"
            aria-label="Command palette search"
          />
          <button onClick={onClose} className="text-white/30 hover:text-white/60" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-6 flex flex-col items-center justify-center gap-2 text-center">
              <SearchX size={22} className="text-white/30" aria-hidden="true" />
              <div className="text-sm font-medium text-white/60">No matches</div>
              <div className="text-caption text-white/30 max-w-[260px] leading-relaxed">
                Try searching by formation name, transition strategy, or an action keyword like &quot;bake&quot; or &quot;export&quot;.
              </div>
            </div>
          ) : (
            results.map((item, i) => {
              const active = i === activeIdx
              const Icon = item.icon ?? Hash
              return (
                <button
                  key={`${item.kind}:${item.id}`}
                  data-idx={i}
                  onClick={() => invoke(item)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`w-full text-left px-4 py-2 flex items-center gap-3 ${active ? 'bg-white/10' : 'hover:bg-white/5'} transition-colors`}
                >
                  {item.kind === 'command' ? (
                    <Icon size={14} className={active ? 'text-cyan-300' : 'text-white/50'} />
                  ) : (
                    <span className={`text-micro font-semibold px-1.5 py-0.5 rounded ${
                      item.nodeType === 'launch' ? 'bg-emerald-500/20 text-emerald-300' :
                      item.nodeType === 'formation' ? 'bg-blue-500/20 text-blue-300' :
                      item.nodeType === 'transition' ? 'bg-purple-500/20 text-purple-300' :
                      item.nodeType === 'idle' ? 'bg-amber-500/20 text-amber-300' :
                      item.nodeType === 'land' ? 'bg-red-500/20 text-red-300' :
                      'bg-white/10 text-white/60'
                    }`}>{item.nodeType}</span>
                  )}
                  <span className={`flex-1 truncate text-sm ${active ? 'text-white' : 'text-white/80'}`}>{item.label}</span>
                  {item.description && (
                    <span className="text-caption text-white/40 truncate">{item.description}</span>
                  )}
                  {item.shortcut && (
                    <span className="ml-2 inline-flex items-center rounded bg-white/5 px-1.5 py-0.5 text-micro font-mono text-white/50 group-hover:text-white/70">{item.shortcut}</span>
                  )}
                </button>
              )
            })
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/10 text-micro text-white/30">
          <span>↑ ↓ to navigate</span>
          <span>↵ to select · esc to close</span>
        </div>
      </div>
    </div>
  )
}
