// ============================================================================
// Slice 3 Step 4: Demo grid — replaces the inline button list in WelcomeScreen.
// Reads DEMO_REGISTRY; each tile is a styled SVG thumbnail (no rendered preview)
// + name, length, drone count, theme tag, feature chips.
// ============================================================================

import { useState, useMemo } from 'react'
import { Clock, Users, Sparkles, Flame, Heart, GitBranch, Orbit, Zap, Star, Wand2 } from 'lucide-react'
import { DEMO_REGISTRY, type DemoDescriptor, type DemoTheme } from '../../app/demos'

const THEME_LABELS: Record<DemoTheme, string> = {
  minimalist: 'minimalist',
  narrative: 'narrative',
  festive: 'festive',
  romantic: 'intimate',
  branded: 'branded',
  cinematic: 'cinematic',
}

function glyphsForChips(chips: string[]) {
  const glyphs: React.ReactNode[] = []
  const pickedKeys = new Set<string>()
  for (const chip of chips) {
    const c = chip.toLowerCase()
    if (!pickedKeys.has('sparkles') && /sparkle|pulse|chase/.test(c)) { glyphs.push(<Sparkles key="s" size={20} />); pickedKeys.add('sparkles') }
    else if (!pickedKeys.has('flame') && /firework|explosion|burst|festive/.test(c)) { glyphs.push(<Flame key="f" size={20} />); pickedKeys.add('flame') }
    else if (!pickedKeys.has('heart') && /heart|breathe|romantic/.test(c)) { glyphs.push(<Heart key="h" size={20} />); pickedKeys.add('heart') }
    else if (!pickedKeys.has('branch') && /split|merge|ant-walk/.test(c)) { glyphs.push(<GitBranch key="b" size={20} />); pickedKeys.add('branch') }
    else if (!pickedKeys.has('orbit') && /orbit|swarm|spin|spiral/.test(c)) { glyphs.push(<Orbit key="o" size={20} />); pickedKeys.add('orbit') }
    else if (!pickedKeys.has('zap') && /bounce|cascade/.test(c)) { glyphs.push(<Zap key="z" size={20} />); pickedKeys.add('zap') }
    else if (!pickedKeys.has('star') && /star|logo|brand|cinematic/.test(c)) { glyphs.push(<Star key="st" size={20} />); pickedKeys.add('star') }
    if (glyphs.length >= 3) break
  }
  if (glyphs.length === 0) glyphs.push(<Sparkles key="default" size={20} />)
  return glyphs
}

function formatLength(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return s > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${m}:00`
  }
  return `${seconds}s`
}

function DemoTile({ demo, onSelect }: { demo: DemoDescriptor; onSelect: (d: DemoDescriptor) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(demo)}
      className="group text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-md overflow-hidden transition-colors"
    >
      {/* Thumbnail strip */}
      <div
        className="h-16 flex items-center justify-center gap-3 text-white/80"
        style={{
          background: `linear-gradient(135deg, ${demo.thumbnailColor}55 0%, ${demo.thumbnailColor}22 60%, transparent 100%)`,
        }}
      >
        {glyphsForChips(demo.featureChips)}
      </div>

      <div className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-white truncate">{demo.name}</h3>
          <span className="text-micro text-white/40 font-mono whitespace-nowrap flex items-center gap-1">
            <Clock size={10} /> {formatLength(demo.lengthSeconds)}
          </span>
        </div>
        <p className="mt-1 text-xs text-white/50 line-clamp-2">{demo.oneLineDescription}</p>
        <div className="mt-2 flex items-center gap-2 text-micro">
          <span className="text-white/40 flex items-center gap-1">
            <Users size={10} /> {demo.droneCount}
          </span>
          <span className="rounded-full px-1.5 py-0.5 bg-white/5 text-white/50">{THEME_LABELS[demo.theme]}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {demo.featureChips.slice(0, 3).map((chip) => (
            <span key={chip} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/60">{chip}</span>
          ))}
        </div>
      </div>
    </button>
  )
}

export function DemoGrid({ onSelect }: { onSelect: (d: DemoDescriptor) => void }) {
  // N-02: theme filter. `null` = all. Computed once from DEMO_REGISTRY so the
  // chip row only shows themes that actually have at least one demo.
  const [activeTheme, setActiveTheme] = useState<DemoTheme | null>(null)
  const themesPresent = useMemo<DemoTheme[]>(() => {
    const seen = new Set<DemoTheme>()
    for (const d of DEMO_REGISTRY) seen.add(d.theme)
    return Array.from(seen)
  }, [])
  const filtered = activeTheme ? DEMO_REGISTRY.filter((d) => d.theme === activeTheme) : DEMO_REGISTRY

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Demo Shows</h2>
        <div className="flex flex-wrap items-center gap-1 text-micro">
          <ThemeChip active={activeTheme === null} onClick={() => setActiveTheme(null)}>All</ThemeChip>
          {themesPresent.map((t) => (
            <ThemeChip key={t} active={activeTheme === t} onClick={() => setActiveTheme(t)}>
              {THEME_LABELS[t]}
            </ThemeChip>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((demo) => (
          <DemoTile key={demo.id} demo={demo} onSelect={onSelect} />
        ))}
      </div>
      {/* Wires the previous "coming soon" stub to the AI dialog, where the
          show-from-text + music-synced-show tools live. Plan §N-02. */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('open-ai-dialog'))}
        className="mt-3 w-full flex items-center justify-center gap-2 p-2 rounded-md bg-purple-600/10 border border-dashed border-purple-500/30 text-xs text-purple-200 hover:bg-purple-600/20 hover:border-purple-500/50 transition-colors"
      >
        <Wand2 size={14} /> Generate a show with AI
        <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-200/80">prompt</span>
      </button>
    </div>
  )
}

function ThemeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 rounded-full transition-colors ${
        active
          ? 'bg-cyan-500/30 text-cyan-100 border border-cyan-400/40'
          : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70 border border-transparent'
      }`}
    >
      {children}
    </button>
  )
}
