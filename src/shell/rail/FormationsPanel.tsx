// ============================================================================
// FormationsPanel — rail rebuild of the legacy AssetPanel "My Formations" +
// "Library" tabs, merged into one searchable panel:
//   search → Project section (draggable rows, usage badges, + New Static)
//          → Library section (premade animated formations, one-click Add)
//   footer detail for the selected def (preview, rename, usage, delete).
// Heavy parameter editing stays in the inspector — this panel is for
// browsing, placing (drag) and lifecycle (create/add/rename/delete).
// ============================================================================

import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Badge, SectionHeader } from '../../components/ui'
import { useFormationStore } from '../../stores/formationStore'
import { useGraphStore } from '../../stores/graphStore'
import { formationUsage } from '../../stores/formationUsage'
import { getAllGenerators } from '../../registries/generators'
import { getLibraryFormations } from '../../registries/formationLibrary'
import { beginFormationDrag, endFormationDrag } from '../../components/viewport/dragPreview'
import { RegistryItemPreview } from '../../components/RegistryItemPreview'
import { toast } from '../../components/Toast'
import type { Vec3 } from '../../graph/types'

// --- Canvas-free preview for the detail footer: orthographic SVG dot plot.
// Picks the projection plane (XY vs XZ) with the larger footprint so flat
// ground formations (rings, grids) and upright ones (text, logos) both read.
function PointsThumb({ points }: { points: Vec3[] | undefined }) {
  const W = 240
  const H = 96
  const dots = useMemo(() => {
    if (!points || points.length === 0) return null
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const p of points) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
      if (p.z < minZ) minZ = p.z
      if (p.z > maxZ) maxZ = p.z
    }
    const useY = maxY - minY > maxZ - minZ
    const spanA = Math.max(0.01, maxX - minX)
    const spanB = Math.max(0.01, useY ? maxY - minY : maxZ - minZ)
    const pad = 6
    const scale = Math.min((W - pad * 2) / spanA, (H - pad * 2) / spanB)
    const ox = (minX + maxX) / 2
    const ob = useY ? (minY + maxY) / 2 : (minZ + maxZ) / 2
    return points.slice(0, 500).map((p, i) => ({
      key: i,
      x: W / 2 + (p.x - ox) * scale,
      y: H / 2 - ((useY ? p.y : p.z) - ob) * scale,
    }))
  }, [points])

  if (!dots) {
    return (
      <div className="h-24 flex items-center justify-center rounded bg-white/5 text-micro text-white/30">
        No points
      </div>
    )
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24 rounded bg-black/30">
      {dots.map((d) => (
        <circle key={d.key} cx={d.x} cy={d.y} r={1.4} fill="#22d3ee" opacity={0.8} />
      ))}
    </svg>
  )
}

export function FormationsPanel() {
  const formations = useFormationStore((s) => s.formations)
  const addFormation = useFormationStore((s) => s.addFormation)
  const addAnimatedFormation = useFormationStore((s) => s.addAnimatedFormation)
  const updateFormation = useFormationStore((s) => s.updateFormation)
  const removeFormation = useFormationStore((s) => s.removeFormation)
  const getPoints = useFormationStore((s) => s.getPoints)
  // Subscribe to graph nodes so usage badges stay live as placements change.
  const nodes = useGraphStore((s) => s.nodes)

  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const generators = getAllGenerators()
  const libraryEntries = useMemo(() => getLibraryFormations(), [])

  const q = query.trim().toLowerCase()
  const matches = (name: string, tags: string[]) =>
    !q || name.toLowerCase().includes(q) || tags.some((t) => t.toLowerCase().includes(q))
  const visibleFormations = formations.filter((f) => matches(f.name, f.tags))
  const visibleLibrary = libraryEntries.filter((e) => matches(e.name, e.tags))

  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of formations) counts.set(f.id, formationUsage(f.id).length)
    return counts
  }, [formations, nodes])

  const handleNewStatic = () => {
    const gen = generators[0]
    if (!gen) return
    const id = addFormation(`Formation ${formations.length + 1}`, gen.id, { ...gen.defaultParams })
    setSelectedId(id)
  }

  const handleAddFromLibrary = (entryId: string) => {
    const entry = libraryEntries.find((e) => e.id === entryId)
    if (!entry) return
    const def = entry.build()
    const id = addAnimatedFormation(entry.name, def, entry.tags)
    setSelectedId(id)
    toast.success(`Added "${entry.name}" to project`)
  }

  const selected = selectedId ? formations.find((f) => f.id === selectedId) : null
  const selectedUsage = selected ? (usageCounts.get(selected.id) ?? 0) : 0

  return (
    <div className="flex flex-col min-h-0">
      <SectionHeader>Formations</SectionHeader>

      {/* Search */}
      <div className="px-2 pt-2 pb-1.5 flex-shrink-0">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search formations…"
          aria-label="Search formations"
          data-testid="rail-formation-search"
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 placeholder:text-white/30 outline-none focus:border-accent-primary/50"
        />
      </div>

      {/* Scrollable body: Project + Library */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-3">
        {/* ------------------------- Project ------------------------- */}
        <div className="space-y-0.5">
          <SectionHeader variant="inline" className="px-1 py-1" actions={<Badge>{formations.length}</Badge>}>
            Project
          </SectionHeader>
          {formations.length === 0 && (
            <div className="px-2 py-5 text-center text-white/40">
              <div className="text-xs font-medium text-white/60 mb-1">No formations yet</div>
              <div className="text-caption leading-snug">
                Click <span className="text-accent-primary">+ New Static Formation</span> below, add one
                from the Library, or use Import.
              </div>
            </div>
          )}
          {formations.length > 0 && visibleFormations.length === 0 && (
            <div className="px-2 py-3 text-center text-caption text-white/30">No project formations match “{query}”.</div>
          )}
          {visibleFormations.map((f) => {
            const pts = getPoints(f.id)
            const isAnimated = f.type === 'animated'
            const usage = usageCounts.get(f.id) ?? 0
            return (
              <button
                key={f.id}
                data-testid="rail-formation-row"
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                  selectedId === f.id ? 'bg-accent-primary/15 text-white' : 'text-white/60 hover:bg-white/5'
                }`}
                onClick={() => setSelectedId(selectedId === f.id ? null : f.id)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/droneshow-formation', f.id)
                  e.dataTransfer.effectAllowed = 'copy'
                  beginFormationDrag(f.id)
                }}
                onDragEnd={() => endFormationDrag()}
                title={
                  isAnimated
                    ? `${f.name} · animated formation · drag onto canvas to add`
                    : `${f.name} · ${f.generatorId} · ${pts?.length ?? f.pointCount} points · drag onto canvas to add`
                }
              >
                <div className="flex items-center gap-2">
                  {!isAnimated && (
                    <RegistryItemPreview kind="generator" id={f.generatorId} params={f.parameters} size={28} framed={false} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center gap-1">
                      <span className="font-medium truncate flex items-center gap-1">
                        {isAnimated && <Badge tone="info">Anim</Badge>}
                        {f.name}
                      </span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        {usage > 0 && (
                          <Badge tone="accent" title={`Placed ${usage} time${usage === 1 ? '' : 's'}`}>
                            ×{usage}
                          </Badge>
                        )}
                        <span className="text-white/30 text-micro">{pts?.length ?? f.pointCount} pts</span>
                      </span>
                    </div>
                    <div className="text-micro text-white/30">{isAnimated ? 'animated' : f.generatorId}</div>
                  </div>
                </div>
              </button>
            )
          })}
          <Button
            variant="ghost"
            size="md"
            className="w-full text-accent-primary hover:text-accent-primary"
            onClick={handleNewStatic}
            title="Create a new generator-based formation (configurable in the inspector after creation)"
          >
            + New Static Formation
          </Button>
        </div>

        {/* ------------------------- Library ------------------------- */}
        <div className="space-y-1">
          <SectionHeader variant="inline" className="px-1 py-1" actions={<Badge>{libraryEntries.length}</Badge>}>
            Library
          </SectionHeader>
          {visibleLibrary.length === 0 && (
            <div className="px-2 py-3 text-center text-caption text-white/30">
              {libraryEntries.length === 0 ? 'No library formations registered.' : `No library formations match “${query}”.`}
            </div>
          )}
          {visibleLibrary.map((entry) => (
            <div
              key={entry.id}
              data-testid="rail-library-row"
              className="rounded bg-white/[0.03] border border-white/5 px-2 py-1.5"
              title={`${entry.name} — ${entry.description}. ${entry.droneCount} drones, ${entry.duration}s ${entry.defaultPlayback.mode}.`}
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center gap-1">
                    <span className="text-xs font-medium text-white/80 truncate">{entry.name}</span>
                    <span className="text-micro text-white/30 flex-shrink-0">{entry.droneCount} drones</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {entry.tags.map((tag) => (
                      <Badge key={tag} className="bg-white/5 text-white/30">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-shrink-0 text-accent-primary hover:text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20"
                  aria-label={`Add ${entry.name}`}
                  onClick={() => handleAddFromLibrary(entry.id)}
                >
                  Add
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ------------------- Selected formation detail ------------------- */}
      {selected && (
        <div className="flex-shrink-0 border-t border-white/10 p-2 space-y-2" data-testid="rail-formation-detail">
          <PointsThumb points={getPoints(selected.id)} />
          <input
            type="text"
            value={selected.name}
            onChange={(e) => updateFormation(selected.id, { name: e.target.value })}
            aria-label="Formation name"
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 outline-none focus:border-accent-primary/50"
          />
          <div className="text-micro text-white/40">
            {getPoints(selected.id)?.length ?? selected.pointCount} points ·{' '}
            {selectedUsage > 0 ? `placed ${selectedUsage}×` : 'not placed yet'}
            {selected.type === 'animated' ? ' · animated' : ` · ${selected.generatorId}`}
          </div>
          <Button
            variant="danger"
            size="sm"
            className="w-full flex items-center justify-center gap-1 bg-red-500/10"
            onClick={() => {
              if (!window.confirm(`Delete "${selected.name}"?${selectedUsage > 0 ? ` It is placed ${selectedUsage} time${selectedUsage === 1 ? '' : 's'}.` : ''}`)) return
              removeFormation(selected.id)
              setSelectedId(null)
            }}
          >
            <Trash2 size={12} /> Delete Formation
          </Button>
        </div>
      )}
    </div>
  )
}
