// ============================================================================
// S23-02: AI Settings Panel + S23-05: Text-to-formation dialog
// S23-06: AI formation refinement + S23-07: AI transition suggestion
// ============================================================================

import { useState, useCallback } from 'react'
import { X, Sparkles, Loader, Settings } from 'lucide-react'
import { configureAI, getAISettings, isAIEnabled, aiTextToFormation } from '../services/aiService'
import { useFormationStore } from '../stores/formationStore'
import { Dialog } from './ui'

interface AIDialogProps {
  onClose: () => void
}

export function AIDialog({ onClose }: AIDialogProps) {
  const settings = getAISettings()
  const [tab, setTab] = useState<'generate' | 'settings'>('generate')
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model)

  // Generation state
  const [prompt, setPrompt] = useState('')
  const [droneCount, setDroneCount] = useState(100)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  // Refinement state
  const [refinementPrompt, setRefinementPrompt] = useState('')
  const [isRefining, setIsRefining] = useState(false)

  const handleSaveSettings = useCallback(() => {
    configureAI({ apiKey, model, enabled: apiKey.length > 0 })
    setTab('generate')
  }, [apiKey, model])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    if (!isAIEnabled()) {
      setError('AI not configured. Go to Settings tab and enter your API key.')
      return
    }
    setIsGenerating(true)
    setError(null)
    setResult(null)
    try {
      const genResult = await aiTextToFormation(prompt, droneCount)
      // Add to formation store
      const store = useFormationStore.getState()
      const id = store.addFormation(genResult.name, 'grid', { count: genResult.points.length, cols: 1, spacing: 1 })
      useFormationStore.setState((state) => {
        state.generatedPoints.set(id, genResult.points)
        const f = state.formations.find((f) => f.id === id)
        if (f) f.pointCount = genResult.points.length
      })
      setResult(`Created "${genResult.name}" with ${genResult.points.length} points`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, droneCount])

  const handleRefine = useCallback(async () => {
    if (!refinementPrompt.trim() || !result) return
    if (!isAIEnabled()) {
      setError('AI not configured. Go to Settings tab and enter your API key.')
      return
    }
    setIsRefining(true)
    setError(null)
    try {
      const refinedPrompt = `Original request: "${prompt}". Refinement: "${refinementPrompt}". Please adjust the formation accordingly.`
      const genResult = await aiTextToFormation(refinedPrompt, droneCount)
      const store = useFormationStore.getState()
      const id = store.addFormation(genResult.name, 'grid', { count: genResult.points.length, cols: 1, spacing: 1 })
      useFormationStore.setState((state) => {
        state.generatedPoints.set(id, genResult.points)
        const f = state.formations.find((f) => f.id === id)
        if (f) f.pointCount = genResult.points.length
      })
      setResult(`Refined: "${genResult.name}" with ${genResult.points.length} points`)
      setRefinementPrompt('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsRefining(false)
    }
  }, [refinementPrompt, prompt, droneCount, result])

  return (
    // No onClose on Dialog: this dialog never closed on Escape, and Dialog
    // wires Escape whenever onClose is passed. Backdrop clicks bubble up to
    // this wrapper instead (panel clicks are stopped inside Dialog).
    <div onClick={onClose}>
      <Dialog>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Sparkles size={18} className="text-purple-400" /> AI Assistant
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/80">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button onClick={() => setTab('generate')}
            className={`flex-1 px-3 py-2 text-xs font-semibold ${tab === 'generate' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-white/40'}`}>
            Generate
          </button>
          <button onClick={() => setTab('settings')}
            className={`flex-1 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1 ${tab === 'settings' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-white/40'}`}>
            <Settings size={12} /> Settings
          </button>
        </div>

        <div className="p-4 space-y-4">
          {tab === 'generate' && (
            <>
              <div>
                <label className="text-xs text-white/50 block mb-1">Describe a formation</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. A heart with 200 drones, a spiral galaxy, the letter A..."
                  rows={3}
                  className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded border border-white/10 outline-none focus:border-purple-500 resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-white/50 block mb-1">Drone Count</label>
                <input type="number" value={droneCount}
                  onChange={(e) => setDroneCount(Math.max(10, Math.min(1000, Number(e.target.value))))}
                  className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded border border-white/10 outline-none focus:border-purple-500" />
              </div>

              {!isAIEnabled() && (
                <div className="p-3 bg-yellow-900/20 border border-yellow-500/20 rounded text-xs text-yellow-300">
                  AI not configured. Go to Settings tab to enter your Claude API key.
                </div>
              )}

              {isGenerating && (
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <Loader size={14} className="animate-spin" /> Generating formation...
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-900/20 border border-red-500/20 rounded text-xs text-red-300">{error}</div>
              )}

              {result && (
                <div className="p-3 bg-green-900/20 border border-green-500/20 rounded text-xs text-green-300">{result}</div>
              )}

              {result && (
                <div className="space-y-2">
                  <label className="text-xs text-white/50 block">Refine the result</label>
                  <input
                    type="text"
                    value={refinementPrompt}
                    onChange={(e) => setRefinementPrompt(e.target.value)}
                    placeholder="e.g. Make it bigger, Add more drones to edges..."
                    className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded border border-white/10 outline-none focus:border-purple-500"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRefine() }}
                  />
                  <button
                    onClick={handleRefine}
                    disabled={isRefining || !refinementPrompt.trim()}
                    className="px-3 py-1.5 text-xs bg-purple-600/80 hover:bg-purple-500 text-white rounded transition-colors disabled:opacity-30 flex items-center gap-1"
                  >
                    {isRefining ? <><Loader size={12} className="animate-spin" /> Refining...</> : <><Sparkles size={12} /> Refine</>}
                  </button>
                </div>
              )}
            </>
          )}

          {tab === 'settings' && (
            <>
              <div>
                <label className="text-xs text-white/50 block mb-1">Claude API Key</label>
                <input type="password" value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded border border-white/10 outline-none focus:border-purple-500" />
                <p className="text-micro text-white/30 mt-1">Your key is stored in memory only, never persisted.</p>
              </div>
              <div>
                <label className="text-xs text-white/50 block mb-1">Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded border border-white/10 outline-none focus:border-purple-500">
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (fast)</option>
                  <option value="claude-opus-4-6">Claude Opus 4.6 (best)</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (cheapest)</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 p-4 border-t border-white/10">
          {tab === 'generate' ? (
            <button onClick={handleGenerate} disabled={isGenerating || !prompt.trim()}
              className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors disabled:opacity-30 flex items-center gap-1">
              <Sparkles size={14} /> {isGenerating ? 'Generating...' : 'Generate'}
            </button>
          ) : (
            <button onClick={handleSaveSettings}
              className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors">
              Save Settings
            </button>
          )}
        </div>
      </Dialog>
    </div>
  )
}
