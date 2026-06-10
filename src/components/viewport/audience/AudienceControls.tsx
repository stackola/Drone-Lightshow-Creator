// ============================================================================
// Bundle 1: HTML overlay controls for the audience viewport
// ============================================================================

import { useViewStore, AUDIENCE_DISTANCE_PRESETS } from '../../../stores/viewStore'
import type { AudienceDistanceId, AudienceEnvId, AudiencePOV } from '../../../stores/viewStore'
import { Moon, Sunset, Sunrise, Home, Camera, User, Sparkles } from 'lucide-react'
import { Tooltip } from '../../Tooltip'

const POVS: { id: AudiencePOV; label: string; icon: typeof Camera }[] = [
  { id: 'orbit', label: 'Orbit', icon: Camera },
  { id: 'first-person', label: 'POV', icon: User },
]

const ENVS: { id: AudienceEnvId; label: string; icon: typeof Moon }[] = [
  { id: 'night', label: 'Night', icon: Moon },
  { id: 'sunset', label: 'Sunset', icon: Sunset },
  { id: 'dawn', label: 'Dawn', icon: Sunrise },
  { id: 'indoor', label: 'Indoor', icon: Home },
]

const DISTANCES: { id: Exclude<AudienceDistanceId, 'custom'>; label: string }[] = [
  { id: 'close', label: 'Close' },
  { id: 'mid', label: 'Mid' },
  { id: 'far', label: 'Far' },
]

export function AudienceControls() {
  const audience = useViewStore((s) => s.audience)
  const setPOV = useViewStore((s) => s.setAudiencePOV)
  const setEnv = useViewStore((s) => s.setAudienceEnv)
  const setDistance = useViewStore((s) => s.setAudienceDistance)
  const setDistanceManual = useViewStore((s) => s.setAudienceDistanceManual)
  const toggleBloom = useViewStore((s) => s.toggleBloom)
  const setBloomIntensity = useViewStore((s) => s.setBloomIntensity)
  const setEmissiveIntensity = useViewStore((s) => s.setEmissiveIntensity)
  const togglePanel = useViewStore((s) => s.toggleAudiencePanel)

  return (
    <div className="absolute top-2 left-2 right-2 z-10 flex flex-col gap-1 pointer-events-none">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 pointer-events-auto">
          {/* POV */}
          <div className="bg-surface-raised/85 backdrop-blur-sm rounded-lg p-0.5 border border-white/10 flex">
            {POVS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`px-2 py-1 text-micro rounded-md transition-colors flex items-center gap-1 ${
                  audience.pov === id ? 'bg-cyan-600 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/10'
                }`}
                onClick={() => setPOV(id)}
                title={label}
              >
                <Icon size={11} />
                {label}
              </button>
            ))}
          </div>

          {/* Env */}
          <div className="bg-surface-raised/85 backdrop-blur-sm rounded-lg p-0.5 border border-white/10 flex">
            {ENVS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`px-2 py-1 text-micro rounded-md transition-colors flex items-center gap-1 ${
                  audience.envId === id ? 'bg-cyan-600 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/10'
                }`}
                onClick={() => setEnv(id)}
                title={label}
              >
                <Icon size={11} />
              </button>
            ))}
          </div>

          {/* Distance */}
          {audience.pov === 'orbit' && (
            <div className="bg-surface-raised/85 backdrop-blur-sm rounded-lg p-0.5 border border-white/10 flex items-center gap-1 px-1">
              {DISTANCES.map(({ id, label }) => (
                <button
                  key={id}
                  className={`px-2 py-1 text-micro rounded-md transition-colors ${
                    audience.distanceId === id ? 'bg-cyan-600 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/10'
                  }`}
                  onClick={() => setDistance(id)}
                  title={`${label} (${AUDIENCE_DISTANCE_PRESETS[id]}m)`}
                >
                  {label}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={500}
                step={5}
                value={Math.round(audience.distance)}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isNaN(n)) setDistanceManual(n)
                }}
                className="w-14 bg-surface-hover border border-white/10 rounded px-1 py-0.5 text-micro text-white/80 outline-none focus:border-cyan-500/50"
                title="Distance (m)"
              />
            </div>
          )}
        </div>

        {/* Right column: bloom + emissive + close */}
        <div className="flex flex-col gap-1 pointer-events-auto items-end">
          <Tooltip label="Close audience view" side="left">
            <button
              className="px-2 py-1 text-micro rounded-lg border border-white/10 bg-surface-raised/85 backdrop-blur-sm text-white/40 hover:text-white/80"
              onClick={togglePanel}
              aria-label="Close audience view"
            >
              ✕
            </button>
          </Tooltip>
          <div className="bg-surface-raised/85 backdrop-blur-sm rounded-lg p-1 border border-white/10 flex flex-col items-end gap-0.5">
            <Tooltip label="Toggle bloom on the audience render" side="left">
              <button
                onClick={() => toggleBloom('audience')}
                className={`px-2 py-0.5 text-micro rounded flex items-center gap-1 ${
                  audience.bloomAudience ? 'bg-fuchsia-600/40 text-fuchsia-200' : 'text-white/40 hover:text-white/70'
                }`}
                aria-label="Toggle audience bloom"
              >
                <Sparkles size={11} />
                Bloom
              </button>
            </Tooltip>
            {audience.bloomAudience && (
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-white/40">Intensity</span>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={audience.bloomIntensity}
                  onChange={(e) => setBloomIntensity(Number(e.target.value))}
                  className="w-20 accent-fuchsia-400"
                />
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-white/40">Emissive</span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={audience.emissiveIntensity}
                onChange={(e) => setEmissiveIntensity(Number(e.target.value))}
                className="w-20 accent-cyan-400"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
