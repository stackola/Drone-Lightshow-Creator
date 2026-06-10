// ============================================================================
// AI Write Tools — Formation Domain (5 tools)
// Extracted from `aiWriteTools.ts` (2026-05-21) as part of the god-module split.
// Side-effect import — registers tools at module load.
// ============================================================================

import { useFormationStore } from '../stores/formationStore'
import { registerTool } from './aiToolEngine'
import { textToFormation } from './formationImport'
import type { Vec3 } from '../graph/types'

// ── create_formation ────────────────────────────────────────────────────────

registerTool({
  name: 'create_formation',
  description: 'Create a new formation from a registered generator (ring, grid, sphere, heart, star, spiral, line). Returns the formation ID and point count.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Human-readable name (e.g., "Opening Ring", "Grand Sphere")' },
      generatorId: { type: 'string', description: 'Generator: grid, ring, sphere, spiral, line, heart, star', enum: ['grid', 'ring', 'sphere', 'spiral', 'line', 'heart', 'star'] },
      params: { type: 'object', description: 'Generator params. Ring: {count, radius}. Grid: {cols, rows, spacing}. Sphere: {count, radius}. Heart: {count, size}. Star: {count, points_n, outerRadius, innerRadius}. Spiral: {count, turns, radius}. Line: {count, length, arcAngle}.' },
    },
    required: ['name', 'generatorId', 'params'],
  },
  isWriteTool: true,
  execute: (params) => {
    const name = params.name as string
    const generatorId = params.generatorId as string
    const genParams = (params.params ?? {}) as Record<string, number>
    const id = useFormationStore.getState().addFormation(name, generatorId, genParams)
    const points = useFormationStore.getState().getPoints(id)
    return { success: true, data: { formationId: id, pointCount: points?.length ?? 0 } }
  },
})

// ── update_formation ────────────────────────────────────────────────────────

registerTool({
  name: 'update_formation',
  description: 'Update an existing formation: change name, generator, or parameters. Regenerates points.',
  inputSchema: {
    type: 'object',
    properties: {
      formationId: { type: 'string', description: 'Formation ID to update' },
      name: { type: 'string', description: 'New name (optional)' },
      generatorId: { type: 'string', description: 'New generator (optional)' },
      parameters: { type: 'object', description: 'New generator params (optional)' },
    },
    required: ['formationId'],
  },
  isWriteTool: true,
  execute: (params) => {
    const store = useFormationStore.getState()
    const id = params.formationId as string
    if (!store.getFormation(id)) return { success: false, error: `Formation not found: ${id}` }
    const patch: Record<string, unknown> = {}
    if (params.name) patch.name = params.name
    if (params.generatorId) patch.generatorId = params.generatorId
    if (params.parameters) patch.parameters = params.parameters
    store.updateFormation(id, patch)
    store.regeneratePoints(id)
    const points = store.getPoints(id)
    return { success: true, data: { formationId: id, pointCount: points?.length ?? 0 } }
  },
})

// ── delete_formation ────────────────────────────────────────────────────────

registerTool({
  name: 'delete_formation',
  description: 'Delete a formation definition and its generated points.',
  inputSchema: {
    type: 'object',
    properties: {
      formationId: { type: 'string', description: 'Formation ID to delete' },
    },
    required: ['formationId'],
  },
  isWriteTool: true,
  execute: (params) => {
    useFormationStore.getState().removeFormation(params.formationId as string)
    return { success: true, data: { deleted: params.formationId } }
  },
})

// ── create_formation_from_text ──────────────────────────────────────────────

registerTool({
  name: 'create_formation_from_text',
  description: 'Create a formation from text (renders via Canvas 2D). Great for logos, words, numbers. Returns formation ID.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to render (e.g., "HELLO", "2024")' },
      droneCount: { type: 'number', description: 'Target number of drones' },
      fontSize: { type: 'number', description: 'Font size in px (default 48)' },
      fontWeight: { type: 'string', description: 'normal or bold (default bold)', enum: ['normal', 'bold'] },
      alignment: { type: 'string', description: 'left, center, right (default center)', enum: ['left', 'center', 'right'] },
      scale: { type: 'number', description: 'World-space scale (default 30)' },
      plane: { type: 'string', description: 'xy (front) or xz (top) (default xy)', enum: ['xy', 'xz'] },
    },
    required: ['text', 'droneCount'],
  },
  isWriteTool: true,
  execute: (params) => {
    const result = textToFormation({
      text: params.text as string,
      fontFamily: 'sans-serif',
      fontSize: (params.fontSize as number) ?? 48,
      fontWeight: ((params.fontWeight as string) ?? 'bold') as 'normal' | 'bold',
      alignment: ((params.alignment as string) ?? 'center') as 'left' | 'center' | 'right',
      targetDroneCount: params.droneCount as number,
      scale: (params.scale as number) ?? 30,
      plane: ((params.plane as string) ?? 'xy') as 'xy' | 'xz',
      perCharacterGrouping: false,
    })
    const store = useFormationStore.getState()
    const name = `Text: ${params.text as string}`
    const id = store.addFormation(name, 'grid', { count: result.points.length, cols: 1, spacing: 1 })
    useFormationStore.setState((s) => {
      s.generatedPoints.set(id, result.points)
      const f = s.formations.find((f) => f.id === id)
      if (f) f.pointCount = result.points.length
    })
    return { success: true, data: { formationId: id, pointCount: result.points.length, name } }
  },
})

// ── set_formation_points ────────────────────────────────────────────────────

registerTool({
  name: 'set_formation_points',
  description: 'Directly set custom 3D point positions for a formation. Use when you need precise control over drone placement.',
  inputSchema: {
    type: 'object',
    properties: {
      formationId: { type: 'string', description: 'Formation ID' },
      points: { type: 'array', description: 'Array of {x, y, z} positions in meters', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } } },
    },
    required: ['formationId', 'points'],
  },
  isWriteTool: true,
  execute: (params) => {
    const id = params.formationId as string
    const points = params.points as Vec3[]
    if (!useFormationStore.getState().getFormation(id)) return { success: false, error: `Formation not found: ${id}` }
    useFormationStore.setState((s) => {
      s.generatedPoints.set(id, points)
      const f = s.formations.find((f) => f.id === id)
      if (f) f.pointCount = points.length
    })
    return { success: true, data: { formationId: id, pointCount: points.length } }
  },
})
