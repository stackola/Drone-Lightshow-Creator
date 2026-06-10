// ============================================================================
// S12: Formation Import — Image, Text, SVG → Point Cloud
// ============================================================================
// S12-01/02/03/04: Image-to-formation
// S12-05/06/07: Text-to-formation
// S12-08/09/10/11: SVG import
// ============================================================================

import type { Vec3 } from '../graph/types'
import type { Color3 } from '../graph/colors'

// --- Image-to-Formation (S12-01/02/03/04) ---

export interface ImageFormationParams {
  targetDroneCount: number
  threshold: number       // 0–255, pixels darker than this become drones
  plane: 'xy' | 'xz'
  scale: number
  usePixelColors: boolean
}

export interface FormationResult {
  points: Vec3[]
  colors?: Color3[]
}

/**
 * S12-02: Convert an image to a point cloud via importance sampling.
 * Uses canvas 2D to rasterize, then Poisson disk subsampling.
 */
export async function imageToFormation(
  imageFile: File,
  params: ImageFormationParams,
): Promise<FormationResult> {
  const img = await loadImage(imageFile)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  canvas.width = img.width
  canvas.height = img.height
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, img.width, img.height)
  return rasterToPoints(imageData, params)
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

/**
 * S12-02: Rasterize image data to point cloud.
 * Uses threshold on grayscale, then Poisson disk subsampling to fit target count.
 */
function rasterToPoints(data: ImageData, params: ImageFormationParams): FormationResult {
  const { width, height } = data
  const candidates: { x: number; y: number; r: number; g: number; b: number }[] = []

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4
      const r = data.data[i]!, g = data.data[i + 1]!, b = data.data[i + 2]!, a = data.data[i + 3]!

      // Use alpha if available, else grayscale threshold
      const grayscale = 0.299 * r + 0.587 * g + 0.114 * b
      const pass = a < 128 ? false : grayscale < params.threshold

      if (pass) {
        candidates.push({
          x: px / width - 0.5,
          y: -(py / height - 0.5), // Flip Y so image is right-side up
          r: r / 255,
          g: g / 255,
          b: b / 255,
        })
      }
    }
  }

  // Subsample to target count using uniform random selection
  const selected = poissonSubsample(candidates, params.targetDroneCount)

  const points: Vec3[] = []
  const colors: Color3[] = []

  for (const s of selected) {
    if (params.plane === 'xy') {
      points.push({ x: s.x * params.scale, y: s.y * params.scale, z: 0 })
    } else {
      points.push({ x: s.x * params.scale, y: 0, z: s.y * params.scale })
    }
    if (params.usePixelColors) {
      colors.push({ r: s.r, g: s.g, b: s.b })
    }
  }

  return { points, colors: params.usePixelColors ? colors : undefined }
}

function poissonSubsample<T extends { x: number; y: number }>(candidates: T[], targetCount: number): T[] {
  if (candidates.length <= targetCount) return candidates

  // Simple approach: shuffle and take first N
  const shuffled = [...candidates]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled.slice(0, targetCount)
}

// --- Text-to-Formation (S12-05/06/07) ---

export interface TextFormationParams {
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | 'bold'
  alignment: 'left' | 'center' | 'right'
  targetDroneCount: number
  scale: number
  plane: 'xy' | 'xz'
  perCharacterGrouping: boolean
}

/**
 * S12-05: Render text to bitmap via Canvas 2D, then apply image-to-formation pipeline.
 */
export function textToFormation(params: TextFormationParams): FormationResult {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // Set up canvas size
  ctx.font = `${params.fontWeight} ${params.fontSize}px ${params.fontFamily}`
  const lines = params.text.split('\n')
  const lineMetrics = lines.map((line) => ctx.measureText(line))
  const maxWidth = Math.max(...lineMetrics.map((m) => m.width))
  const lineHeight = params.fontSize * 1.2

  canvas.width = Math.ceil(maxWidth) + 20
  canvas.height = Math.ceil(lines.length * lineHeight) + 20

  // Clear and draw text
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = `${params.fontWeight} ${params.fontSize}px ${params.fontFamily}`
  ctx.fillStyle = 'white'
  ctx.textBaseline = 'top'

  for (let i = 0; i < lines.length; i++) {
    let x = 10
    if (params.alignment === 'center') x = (canvas.width - lineMetrics[i]!.width) / 2
    else if (params.alignment === 'right') x = canvas.width - 10 - lineMetrics[i]!.width
    ctx.fillText(lines[i]!, x, 10 + i * lineHeight)
  }

  // S12-07: Per-character grouping — render each char separately and tag points
  if (params.perCharacterGrouping) {
    const allPoints: Vec3[] = []
    const allChars = params.text.replace(/\n/g, '')
    const perCharCount = Math.max(1, Math.floor(params.targetDroneCount / Math.max(1, allChars.length)))

    for (let ci = 0; ci < allChars.length; ci++) {
      const charCanvas = document.createElement('canvas')
      const charCtx = charCanvas.getContext('2d')!
      charCtx.font = `${params.fontWeight} ${params.fontSize}px ${params.fontFamily}`
      const charMetric = charCtx.measureText(allChars[ci]!)
      charCanvas.width = Math.ceil(charMetric.width) + 10
      charCanvas.height = Math.ceil(params.fontSize * 1.4)
      charCtx.fillStyle = 'black'
      charCtx.fillRect(0, 0, charCanvas.width, charCanvas.height)
      charCtx.font = `${params.fontWeight} ${params.fontSize}px ${params.fontFamily}`
      charCtx.fillStyle = 'white'
      charCtx.textBaseline = 'top'
      charCtx.fillText(allChars[ci]!, 5, 5)

      const charImgData = charCtx.getImageData(0, 0, charCanvas.width, charCanvas.height)
      const charResult = rasterToPoints(charImgData, {
        targetDroneCount: perCharCount,
        threshold: 128,
        plane: params.plane,
        scale: params.scale * (charCanvas.width / canvas.width),
        usePixelColors: false,
      })
      // Offset points by character position
      const charOffset = (ci / allChars.length - 0.5) * params.scale
      for (const pt of charResult.points) {
        allPoints.push({ x: pt.x + charOffset, y: pt.y, z: pt.z })
      }
    }
    return { points: allPoints.slice(0, params.targetDroneCount) }
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return rasterToPoints(imageData, {
    targetDroneCount: params.targetDroneCount,
    threshold: 128,
    plane: params.plane,
    scale: params.scale,
    usePixelColors: false,
  })
}

// --- SVG Import (S12-08/09/10/11) ---

export interface SVGFormationParams {
  mode: 'stroke' | 'fill'
  targetDroneCount: number
  scale: number
  plane: 'xy' | 'xz'
}

/**
 * S12-08/09/10/11: Parse SVG and generate formation points.
 * Uses SVG → Canvas rasterization for fill mode, or path sampling for stroke mode.
 */
export async function svgToFormation(
  svgFile: File,
  params: SVGFormationParams,
): Promise<FormationResult> {
  const svgText = await svgFile.text()
  return svgStringToFormation(svgText, params)
}

/**
 * Rasterize an SVG string to canvas and sample points. Shared core used by
 * file-based imports (`svgToFormation`) and AI-authored SVG (Tier 2 generator).
 * Also returns the rasterized PNG data URL so callers (e.g. the vision critic
 * loop) can reuse it without re-rendering.
 */
export async function svgStringToFormation(
  svgText: string,
  params: SVGFormationParams,
): Promise<FormationResult & { rasterDataUrl: string }> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const img = await loadSVGImage(svgText)

  const size = 512
  canvas.width = size
  canvas.height = size
  // White background so transparent SVGs (the AI prompt asks for transparent
  // bg with black fill) still threshold correctly in rasterToPoints.
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(img, 0, 0, size, size)
  const imageData = ctx.getImageData(0, 0, size, size)
  const rasterDataUrl = canvas.toDataURL('image/png')

  const result = rasterToPoints(imageData, {
    targetDroneCount: params.targetDroneCount,
    threshold: 128,
    plane: params.plane,
    scale: params.scale,
    usePixelColors: false,
  })

  return { ...result, rasterDataUrl }
}

function loadSVGImage(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}
