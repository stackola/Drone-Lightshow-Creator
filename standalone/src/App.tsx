import { Suspense, useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { Preview3D } from './components/Preview3D'
import { downloadFormationJson } from './services/exportJson'
import { downloadFormationCsv } from './services/exportCsv'
import { useFormationStore } from './stores/formationStore'
import { Download, ChevronDown } from 'lucide-react'

export function App() {
  const droneCount = useFormationStore((s) => s.drones.length)
  const [showExport, setShowExport] = useState(false)

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Header */}
      <div className="h-10 bg-slate-900 border-b border-white/10 flex items-center px-4 gap-3 flex-shrink-0">
        <span className="text-sm font-semibold text-white/70">Drone Formation Generator</span>
        <div className="flex-1" />
        {droneCount > 0 && (
          <div className="relative">
            <button onClick={() => setShowExport(!showExport)}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded transition-colors">
              <Download size={12} /> Export <ChevronDown size={10} />
            </button>
            {showExport && (
              <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-white/10 rounded shadow-xl z-50 min-w-[180px]">
                <button onClick={() => { downloadFormationJson(); setShowExport(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/5">
                  Blender JSON (.json)
                </button>
                <button onClick={() => { downloadFormationCsv(); setShowExport(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/5 border-t border-white/5">
                  CSV Waypoints (.csv)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Chat */}
        <div className="w-[380px] flex-shrink-0 border-r border-white/10">
          <ChatPanel />
        </div>

        {/* Right: 3D Preview */}
        <div className="flex-1 min-w-0">
          <Suspense fallback={<div className="h-full flex items-center justify-center text-white/20 text-sm">Loading 3D...</div>}>
            <Preview3D />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
