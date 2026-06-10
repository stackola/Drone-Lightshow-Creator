// ============================================================================
// AI SVG Formation Generator — Tier 2: LLM authors SVG, we sample to points
// ============================================================================
// Claude is dramatically better at SVG than at raw 3D coordinates. For concept
// formations ("Eiffel tower", "sports car silhouette", "company logo"), this
// tool lets the model produce a clean SVG, which we rasterize to a canvas and
// sample via the existing rasterToPoints pipeline (same code path as the
// user-facing SVG upload import).
//
// The companion vision critic (aiFormationCritic.ts) is invoked from a
// separate tool (`critique_formation`) so the agent loop can decide whether
// to retry — this keeps each tool single-purpose and synchronous-friendly.
// ============================================================================

import { useFormationStore } from '../stores/formationStore'
import { registerTool, type ToolResult } from './aiToolEngine'
import { svgStringToFormation } from './formationImport'
import { critiqueSvgFormation, type CritiqueResult } from './aiFormationCritic'
import type { Vec3 } from '../graph/types'

// Cache the rasterized PNG per formation so the critic tool can re-evaluate
// without forcing the agent to resend the SVG string. Keyed by formationId.
const rasterCache = new Map<string, { rasterDataUrl: string; concept: string; svg: string }>()

export function getCachedRaster(formationId: string): { rasterDataUrl: string; concept: string; svg: string } | undefined {
  return rasterCache.get(formationId)
}

// Strip code fences, leading prose, and known-unsafe elements before
// handing the SVG to the rasterizer. The browser parses anyway — this is
// belt-and-suspenders sanitation, not a security boundary.
export function sanitizeSvg(raw: string): string {
  let svg = raw.trim()

  // Strip ```svg / ``` markdown fences if Claude wrapped the response.
  svg = svg.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '')

  // Extract just the <svg>…</svg> block if the model added prose around it.
  const match = svg.match(/<svg[\s\S]*?<\/svg>/i)
  if (match) svg = match[0]

  // Remove scripts and external references — defense in depth.
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '')
  svg = svg.replace(/\son\w+="[^"]*"/gi, '')
  svg = svg.replace(/xlink:href="https?:[^"]*"/gi, '')

  return svg
}

registerTool({
  name: 'create_formation_from_svg',
  description: `Create a formation from an SVG silhouette that YOU author. This is the right tool for concept formations: objects, scenes, icons, logos, anything the built-in procedural generators (ring, star, heart, sphere, spiral, line, grid) don't cover.

Why prefer SVG over generate_custom_formation for concepts: you draw in shapes (paths, polygons, circles) instead of computing per-drone coordinates. The system rasterizes your SVG and samples points, so you get a clean silhouette without doing math.

When to use which tool:
- Named primitive (star, ring, heart, sphere, spiral, line, grid) → create_formation with the matching generator.
- Text / letterforms → create_formation_from_text.
- Concept / object / scene / logo (Eiffel tower, sports car, dolphin, lightning bolt, …) → THIS TOOL.
- Custom math-derived point clouds → generate_custom_formation.

SVG authoring rules:
- 512×512 viewBox.
- Black fill on transparent background. Filled shapes (<path>, <polygon>, <circle>, <rect>) — no strokes-only.
- No <text>, no gradients, no filters, no external <image> refs, no <script>.
- Keep the silhouette readable from a distance. Solid masses beat thin lines.
- Center the subject in the viewBox.

After this tool returns, you can optionally call critique_formation with the same formationId and the concept string to get a 0–10 recognizability rating and a concrete suggestion. If the score is below 7, regenerate by calling this tool again with the suggestion folded into the SVG.`,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Formation name (e.g., "Eiffel Tower", "Sports Car")' },
      concept: { type: 'string', description: 'Short description of what the SVG depicts. Used by critique_formation. (e.g., "Eiffel tower silhouette")' },
      svg: { type: 'string', description: 'Complete <svg>…</svg> document. 512×512 viewBox, black fills on transparent background.' },
      droneCount: { type: 'number', description: 'Target number of drones (sampled from the rasterized silhouette).' },
      scale: { type: 'number', description: 'World-space scale in meters (default 25, typical 15–40).' },
      plane: { type: 'string', description: 'xy = vertical wall facing audience (default), xz = ground projection', enum: ['xy', 'xz'] },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
    },
    required: ['name', 'concept', 'svg', 'droneCount'],
  },
  isWriteTool: true,
  execute: async (params): Promise<ToolResult> => {
    const name = params.name as string
    const concept = params.concept as string
    const rawSvg = params.svg as string
    const droneCount = params.droneCount as number
    const scale = (params.scale as number) ?? 25
    const plane = ((params.plane as string) ?? 'xy') as 'xy' | 'xz'
    const tags = (params.tags as string[]) ?? ['AI-generated', 'svg']

    if (!rawSvg || typeof rawSvg !== 'string') {
      return { success: false, error: 'svg parameter missing or not a string' }
    }
    if (!Number.isFinite(droneCount) || droneCount < 1) {
      return { success: false, error: `droneCount must be a positive number, got ${droneCount}` }
    }

    const svg = sanitizeSvg(rawSvg)
    if (!svg.toLowerCase().includes('<svg')) {
      return { success: false, error: 'Sanitized input does not contain an <svg> element. Make sure your response includes a complete <svg>…</svg> document.' }
    }

    let result: Awaited<ReturnType<typeof svgStringToFormation>>
    try {
      result = await svgStringToFormation(svg, {
        mode: 'fill',
        targetDroneCount: droneCount,
        scale,
        plane,
      })
    } catch (err) {
      return { success: false, error: `SVG rasterization failed: ${(err as Error).message}` }
    }

    const points: Vec3[] = result.points
    if (points.length === 0) {
      return { success: false, error: 'Rasterized SVG produced 0 sampled points. The SVG may be empty, fully transparent, or all-white. Use black fills on transparent background.' }
    }

    const store = useFormationStore.getState()
    const id = store.addFormation(name, 'grid', { count: points.length, cols: 1, spacing: 1 })
    useFormationStore.setState((s) => {
      s.generatedPoints.set(id, points)
      const f = s.formations.find((f) => f.id === id)
      if (f) {
        f.pointCount = points.length
        f.tags = tags
      }
    })

    rasterCache.set(id, { rasterDataUrl: result.rasterDataUrl, concept, svg })

    return {
      success: true,
      data: {
        formationId: id,
        name,
        concept,
        droneCount: points.length,
        plane,
        message: `Created SVG formation "${name}" (${points.length} drones). Call critique_formation with formationId="${id}" to evaluate recognizability.`,
      },
    }
  },
})

registerTool({
  name: 'critique_formation',
  description: `Rate how clearly an SVG-generated formation depicts its intended concept. Uses Claude Vision on the rasterized silhouette. Returns a 0–10 score plus a concrete suggestion for improvement.

Use this AFTER create_formation_from_svg, especially when:
- The user requested high quality.
- The concept is complex (vehicles, buildings, animals).
- You're unsure whether the silhouette reads as the intended subject.

If the score is below 7, regenerate with create_formation_from_svg, folding the suggestion into the new SVG. Cap yourself at 3 total attempts to keep cost bounded.`,
  inputSchema: {
    type: 'object',
    properties: {
      formationId: { type: 'string', description: 'ID returned by create_formation_from_svg' },
      concept: { type: 'string', description: 'Optional — overrides the concept stored at creation time' },
    },
    required: ['formationId'],
  },
  isWriteTool: false,
  execute: async (params): Promise<ToolResult> => {
    const formationId = params.formationId as string
    const cached = rasterCache.get(formationId)
    if (!cached) {
      return { success: false, error: `No SVG raster cached for formation ${formationId}. Only formations created via create_formation_from_svg can be critiqued.` }
    }
    const concept = (params.concept as string) || cached.concept

    let critique: CritiqueResult
    try {
      critique = await critiqueSvgFormation(concept, cached.rasterDataUrl)
    } catch (err) {
      return { success: false, error: `Critique failed: ${(err as Error).message}` }
    }

    return {
      success: true,
      data: {
        formationId,
        concept,
        score: critique.score,
        suggestion: critique.suggestion,
        rationale: critique.rationale,
        verdict: critique.score >= 7 ? 'good' : 'retry',
      },
    }
  },
})
