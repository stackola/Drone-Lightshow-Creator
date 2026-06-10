// ============================================================================
// ImportPanel — rail rebuild of the legacy AssetPanel "Import" tab (S12/S13):
// image / text / SVG → formation, with common params (count/scale/plane),
// post-processing (jitter/mirror), drag-drop, source preview overlay and the
// AI-assisted image import. Same service calls as the legacy panel; chrome
// restyled with the shared primitives.
// ============================================================================

import { useCallback, useState } from 'react'
import { Button, SectionHeader } from '../../components/ui'
import { Section, Field, NumberInput, SelectInput } from '../../components/inspectors/shared'
import { useFormationStore } from '../../stores/formationStore'
import { imageToFormation, svgToFormation, textToFormation } from '../../services/formationImport'
import { applyJitter, mirrorFormation } from '../../graph/formationTools'
import { toast } from '../../components/Toast'
import { ACCENT_PRIMARY } from '../../ui/colors'
import type { Vec3 } from '../../graph/types'

type ImportType = 'image' | 'text' | 'svg'

export function ImportPanel() {
  const [importType, setImportType] = useState<ImportType>('text')
  const [text, setText] = useState('HELLO')
  const [fontSize, setFontSize] = useState(48)
  const [fontWeight, setFontWeight] = useState<'normal' | 'bold'>('bold')
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>('center')
  const [targetCount, setTargetCount] = useState(100)
  const [scale, setScale] = useState(30)
  const [plane, setPlane] = useState<'xy' | 'xz'>('xy')
  const [threshold, setThreshold] = useState(128)
  const [usePixelColors, setUsePixelColors] = useState(true)
  const [svgMode, setSvgMode] = useState<'stroke' | 'fill'>('fill')
  const [jitterAmount, setJitterAmount] = useState(0)
  const [mirrorAxis, setMirrorAxis] = useState<'' | 'x' | 'y' | 'z'>('')
  const [perCharGrouping, setPerCharGrouping] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewPoints, setPreviewPoints] = useState<Vec3[] | null>(null)

  // Create a formation def from imported points (with optional jitter/mirror),
  // writing the exact point cloud into the store's generated-points cache.
  const createFormationFromPoints = (name: string, points: Vec3[]) => {
    let processed = points
    if (jitterAmount > 0) processed = applyJitter(processed, jitterAmount)
    if (mirrorAxis) processed = mirrorFormation(processed, mirrorAxis as 'x' | 'y' | 'z')
    const store = useFormationStore.getState()
    const id = store.addFormation(name, 'grid', { count: processed.length, cols: 1, spacing: 1 })
    useFormationStore.setState((state) => {
      state.generatedPoints.set(id, processed)
      const f = state.formations.find((f) => f.id === id)
      if (f) f.pointCount = processed.length
    })
    toast.success(`Imported "${name}" (${processed.length} points)`)
    return id
  }

  const processImageFile = async (file: File) => {
    setIsProcessing(true)
    setPreviewImageUrl(URL.createObjectURL(file))
    try {
      const result = await imageToFormation(file, {
        targetDroneCount: targetCount, threshold, plane, scale, usePixelColors,
      })
      setPreviewPoints(result.points)
      createFormationFromPoints(`Image: ${file.name.replace(/\.[^.]+$/, '')}`, result.points)
    } catch (err) {
      console.error('Image import failed:', err)
      toast.error('Image import failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const processSVGFile = async (file: File) => {
    setIsProcessing(true)
    try {
      const result = await svgToFormation(file, { mode: svgMode, targetDroneCount: targetCount, scale, plane })
      createFormationFromPoints(`SVG: ${file.name.replace(/\.[^.]+$/, '')}`, result.points)
    } catch (err) {
      console.error('SVG import failed:', err)
      toast.error('SVG import failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.type.startsWith('image/')) {
      await processImageFile(file)
    } else if (file.name.endsWith('.svg')) {
      await processSVGFile(file)
    }
  }, [targetCount, threshold, plane, scale, usePixelColors, svgMode, jitterAmount, mirrorAxis])

  const handleTextImport = () => {
    setIsProcessing(true)
    try {
      const result = textToFormation({
        text, fontFamily: 'sans-serif', fontSize, fontWeight, alignment,
        targetDroneCount: targetCount, scale, plane, perCharacterGrouping: perCharGrouping,
      })
      createFormationFromPoints(`Text: ${text}`, result.points)
    } catch (err) {
      console.error('Text import failed:', err)
      toast.error('Text import failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const pickFile = (accept: string, onFile: (file: File) => void) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) onFile(file)
    }
    input.click()
  }

  const handleAIImport = () => {
    pickFile('image/png,image/jpeg,image/webp', async (file) => {
      setIsProcessing(true)
      try {
        const { fileToBase64, analyzeImageForFormation } = await import('../../services/aiImageAnalysis')
        const b64 = await fileToBase64(file)
        const analysis = await analyzeImageForFormation(b64)
        const result = await imageToFormation(file, {
          targetDroneCount: analysis.suggestedDroneCount,
          threshold: analysis.suggestedThreshold,
          plane,
          scale: analysis.suggestedScale,
          usePixelColors,
        })
        setPreviewImageUrl(URL.createObjectURL(file))
        setPreviewPoints(result.points)
        createFormationFromPoints(`AI: ${analysis.contentDescription}`, result.points)
      } catch (err) {
        console.error('AI analysis failed:', err)
        toast.error('AI image analysis failed')
      } finally {
        setIsProcessing(false)
      }
    })
  }

  return (
    <div className="flex flex-col min-h-0">
      <SectionHeader>Import</SectionHeader>
      <div
        className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3"
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="border-2 border-dashed border-accent-primary/50 bg-accent-primary/10 rounded-lg p-4 text-center text-xs text-accent-primary">
            Drop image or SVG file here
          </div>
        )}

        {/* Source preview with point overlay */}
        {previewImageUrl && (
          <div className="relative border border-white/10 rounded overflow-hidden">
            <img src={previewImageUrl} alt="Source" className="w-full h-24 object-contain bg-black/50" />
            {previewPoints && (
              <svg className="absolute inset-0 w-full h-full" viewBox="-0.5 -0.5 1 1" preserveAspectRatio="xMidYMid meet">
                {previewPoints.slice(0, 200).map((p, i) => (
                  <circle key={i} cx={p.x / scale} cy={-p.y / scale} r={0.005} fill={ACCENT_PRIMARY} opacity={0.7} />
                ))}
              </svg>
            )}
            <button
              onClick={() => { setPreviewImageUrl(null); setPreviewPoints(null) }}
              aria-label="Clear preview"
              className="absolute top-0.5 right-0.5 text-white/40 hover:text-white/80 text-micro bg-black/50 rounded px-1"
            >
              ✕
            </button>
            <div className="text-[9px] text-white/30 px-1 py-0.5">{previewPoints?.length ?? 0} points generated</div>
          </div>
        )}

        {/* Source type switch */}
        <div className="flex gap-1">
          {(['image', 'text', 'svg'] as const).map((t) => (
            <Button
              key={t}
              variant="toggle"
              size="sm"
              active={importType === t}
              className="flex-1"
              onClick={() => setImportType(t)}
              title={
                t === 'image'
                  ? 'Import from PNG / JPG — extract bright pixels and rasterize them into drone positions'
                  : t === 'text'
                    ? 'Render text glyphs into a 2D point cloud (great for logos & countdowns)'
                    : 'Import an SVG — extract path points (fill or stroke)'
              }
            >
              {t.toUpperCase()}
            </Button>
          ))}
        </div>

        <Section title="Common Parameters">
          <Field label="Target Drones">
            <NumberInput value={targetCount} onChange={setTargetCount} min={10} max={1000} step={10} />
          </Field>
          <Field label="Scale">
            <NumberInput value={scale} onChange={setScale} min={1} max={200} step={5} />
          </Field>
          <Field label="Plane">
            <SelectInput
              value={plane}
              onChange={(v) => setPlane(v as 'xy' | 'xz')}
              options={[{ value: 'xy', label: 'XY (front)' }, { value: 'xz', label: 'XZ (top)' }]}
            />
          </Field>
        </Section>

        <Section title="Post-Processing">
          <Field label="Jitter">
            <NumberInput value={jitterAmount} onChange={setJitterAmount} min={0} max={5} step={0.1} />
          </Field>
          <Field label="Mirror Axis">
            <SelectInput
              value={mirrorAxis}
              onChange={(v) => setMirrorAxis(v as '' | 'x' | 'y' | 'z')}
              options={[
                { value: '', label: 'None' },
                { value: 'x', label: 'Mirror X' },
                { value: 'y', label: 'Mirror Y' },
                { value: 'z', label: 'Mirror Z' },
              ]}
            />
          </Field>
        </Section>

        {importType === 'text' && (
          <Section title="Text">
            <Field label="Text">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Text to import"
                className="w-full bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-white/80 outline-none focus:border-accent-primary/50"
              />
            </Field>
            <Field label="Font Size">
              <NumberInput value={fontSize} onChange={setFontSize} min={12} max={200} step={4} />
            </Field>
            <Field label="Weight">
              <SelectInput
                value={fontWeight}
                onChange={(v) => setFontWeight(v as 'normal' | 'bold')}
                options={[{ value: 'normal', label: 'Normal' }, { value: 'bold', label: 'Bold' }]}
              />
            </Field>
            <Field label="Alignment">
              <SelectInput
                value={alignment}
                onChange={(v) => setAlignment(v as 'left' | 'center' | 'right')}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' },
                ]}
              />
            </Field>
            <Field label="Per-char Groups">
              <input
                type="checkbox"
                checked={perCharGrouping}
                onChange={(e) => setPerCharGrouping(e.target.checked)}
                className="accent-cyan-500"
              />
            </Field>
            <Button
              variant="ghost"
              className="w-full text-accent-primary hover:text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20"
              onClick={handleTextImport}
              disabled={isProcessing || !text.trim()}
            >
              {isProcessing ? 'Processing…' : 'Generate from Text'}
            </Button>
          </Section>
        )}

        {importType === 'image' && (
          <Section title="Image">
            <Field label="Threshold">
              <NumberInput value={threshold} onChange={setThreshold} min={1} max={254} step={10} />
            </Field>
            <Field label="Use Pixel Colors">
              <input
                type="checkbox"
                checked={usePixelColors}
                onChange={(e) => setUsePixelColors(e.target.checked)}
                className="accent-cyan-500"
              />
            </Field>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                className="flex-1 text-accent-primary hover:text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20"
                onClick={() => pickFile('image/png,image/jpeg,image/webp', processImageFile)}
                disabled={isProcessing}
              >
                {isProcessing ? 'Processing…' : 'Upload Image'}
              </Button>
              <Button
                variant="ghost"
                className="text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20"
                onClick={handleAIImport}
                disabled={isProcessing}
                aria-label="AI import"
                title="AI-optimized import via Claude Vision"
              >
                AI
              </Button>
            </div>
          </Section>
        )}

        {importType === 'svg' && (
          <Section title="SVG">
            <Field label="Mode">
              <SelectInput
                value={svgMode}
                onChange={(v) => setSvgMode(v as 'stroke' | 'fill')}
                options={[{ value: 'fill', label: 'Fill' }, { value: 'stroke', label: 'Stroke' }]}
              />
            </Field>
            <Button
              variant="ghost"
              className="w-full text-accent-primary hover:text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20"
              onClick={() => pickFile('.svg', processSVGFile)}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing…' : 'Upload SVG'}
            </Button>
          </Section>
        )}
      </div>
    </div>
  )
}
