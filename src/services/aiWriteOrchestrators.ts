// ============================================================================
// AI Write Tools — Orchestrator Domain (4 tools)
// Large AI-driven tools that drive the show end-to-end. Extracted from
// `aiWriteTools.ts` (2026-05-21) as wave 4b of the god-module split.
// Side-effect import — registers tools at module load.
// ============================================================================

import { registerTool } from './aiToolEngine'
import { buildShowFromOutline, type ShowOutline, type ShowAct } from './aiShowBuilder'
import { useAudioStore } from '../stores/audioStore'

// ── create_show_from_outline ────────────────────────────────────────────────

registerTool({
  name: 'create_show_from_outline',
  description: `Build an entire drone show from a structured outline. This is the most powerful tool — it creates all formations, builds the graph, connects everything, applies keyframes/colors/idle behaviors, runs auto-timing, validates physics, and auto-fixes violations. Use this when the user asks to "create a show" or describes a full performance.

Typical show structure:
- 3-7 acts for a 2-3 minute show
- Each act has 1 formation lasting 5-15 seconds
- Transitions between acts last 2-5 seconds
- Vary altitude between 12-25m across acts
- Vary transition strategies (don't repeat the same one)
- Use color programs for visual interest
- Add idle behaviors for leftover drones`,
  inputSchema: {
    type: 'object',
    properties: {
      outline: {
        type: 'object',
        description: 'The show outline',
        properties: {
          name: { type: 'string', description: 'Show name' },
          droneCount: { type: 'number', description: 'Total drones (50-500)' },
          acts: {
            type: 'array',
            description: 'Ordered acts of the show',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Act label (e.g., "Act 1 — Opening")' },
                formations: {
                  type: 'array',
                  description: 'Formations in this act (usually 1)',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Formation name' },
                      generator: {
                        type: 'object',
                        description: 'Generator config',
                        properties: {
                          type: { type: 'string', description: 'grid, ring, sphere, spiral, line, heart, star, or text' },
                          params: { type: 'object', description: 'Generator params. Ring: {count, radius}. Grid: {cols, rows, spacing}. Sphere: {count, radius}. Heart: {count, size}. Star: {count, points_n, outerRadius, innerRadius}. Text: {text, fontSize, scale}.' },
                        },
                      },
                      duration: { type: 'number', description: 'Duration in seconds (5-15)' },
                      altitude: { type: 'number', description: 'Y position in meters (12-25)' },
                      colorProgramId: { type: 'string', description: 'Color program: solid-white, solid-red, solid-blue, solid-green, gradient-blue-red, gradient-warm, rainbow, rainbow-index, pulse-white, chase-rgb' },
                      keyframes: {
                        type: 'array',
                        description: 'Animation keyframes (optional)',
                        items: {
                          type: 'object',
                          properties: {
                            time: { type: 'number', description: 'Time within formation duration' },
                            position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
                            rotation: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
                            scale: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
                            easing: { type: 'string', description: 'Easing: linear, ease-in, ease-out, ease-in-out, ease-in-out-cubic, etc.' },
                          },
                        },
                      },
                      idleBehavior: {
                        type: 'object',
                        description: 'Idle behavior for leftover drones',
                        properties: {
                          behavior: { type: 'string', description: 'hover, orbit, figure8, breathe, swarm, sparkle, pulse, wave, spin, drift' },
                          radius: { type: 'number' },
                          speed: { type: 'number' },
                        },
                      },
                    },
                  },
                },
                transition: {
                  type: 'object',
                  description: 'Transition to next act (omit for last act)',
                  properties: {
                    strategyId: { type: 'string', description: 'shortest-path, ant-walk, stagger, spiral, explosion, implosion, cascade, morph, color-sweep, bounce' },
                    parameters: { type: 'object', description: 'Strategy params' },
                    duration: { type: 'number', description: 'Duration in seconds (2-5)' },
                  },
                },
              },
            },
          },
        },
      },
    },
    required: ['outline'],
  },
  isWriteTool: true,
  execute: (params) => {
    const outline = params.outline as ShowOutline
    if (!outline || !outline.acts || !Array.isArray(outline.acts)) {
      return { success: false, error: 'Invalid outline: must have name, droneCount, and acts array' }
    }
    const result = buildShowFromOutline(outline)
    return {
      success: true,
      data: {
        summary: result.summary,
        duration: result.duration,
        violations: result.violations,
        formationCount: result.formationIds.size,
        edgeCount: result.edgeIds.length,
      },
    }
  },
})

// ── analyze_image_for_formation ─────────────────────────────────────────────

registerTool({
  name: 'analyze_image_for_formation',
  description: 'Analyze an image using Claude Vision to suggest optimal formation parameters (drone count, threshold, scale). Send the image as base64 data. Returns analysis and auto-creates a formation.',
  inputSchema: {
    type: 'object',
    properties: {
      imageBase64: { type: 'string', description: 'Base64-encoded image data (data URL or raw base64)' },
      autoCreate: { type: 'boolean', description: 'If true, auto-create the formation with suggested params (default true)' },
    },
    required: ['imageBase64'],
  },
  isWriteTool: true,
  execute: () => {
    // The Vision API call is async; the chat service handles it out-of-band.
    // This sync handler exists so the tool surfaces in registries, with a
    // hint pointing the user at the right entry point.
    return {
      success: true,
      data: {
        message: 'Image analysis requires async Vision API call. Use the AI chat to say "analyze this image" with the image attached, or use the "AI Analyze" button in the import panel.',
        note: 'Direct tool execution is sync-only. The chat service handles async Vision calls.',
      },
    }
  },
})

// ── generate_music_synced_show ──────────────────────────────────────────────

registerTool({
  name: 'generate_music_synced_show',
  description: 'Generate a show synchronized to loaded music. Reads BPM, beats, and sections from the audio store. Creates formations timed to beats and transitions on bar boundaries. Requires audio to be loaded first.',
  inputSchema: {
    type: 'object',
    properties: {
      theme: { type: 'string', description: 'Theme for the show (e.g., "celebration", "dramatic", "gentle")' },
      style: { type: 'string', description: 'Visual style: gentle, dynamic, dramatic', enum: ['gentle', 'dynamic', 'dramatic'] },
      droneCount: { type: 'number', description: 'Number of drones (default 100)' },
    },
    required: [],
  },
  isWriteTool: true,
  execute: (params) => {
    const audioState = useAudioStore.getState()

    if (!audioState.isAudioLoaded) {
      return { success: false, error: 'No audio loaded. Import an audio file first, then try again.' }
    }

    const bpm = audioState.bpm
    const beatInterval = 60 / bpm
    const duration = audioState.duration
    const droneCount = (params.droneCount as number) ?? 100
    const style = (params.style as string) ?? 'dynamic'

    // Map energy to show structure — divide audio into sections by beat count.
    const totalBeats = Math.floor(duration / beatInterval)
    const beatsPerAct = style === 'gentle' ? 16 : style === 'dynamic' ? 8 : 12
    const actCount = Math.max(2, Math.min(8, Math.floor(totalBeats / beatsPerAct)))

    const generators = ['ring', 'sphere', 'star', 'heart', 'spiral', 'grid', 'line']
    const strategies = style === 'gentle'
      ? ['morph', 'stagger', 'shortest-path']
      : style === 'dynamic'
        ? ['explosion', 'spiral', 'cascade', 'bounce']
        : ['implosion', 'explosion', 'morph', 'stagger']
    const colors = ['rainbow', 'gradient-blue-red', 'solid-red', 'chase-rgb', 'pulse-white', 'gradient-warm']

    const acts: ShowAct[] = []

    for (let i = 0; i < actCount; i++) {
      const actBeats = beatsPerAct
      const actDuration = actBeats * beatInterval
      const formDuration = actDuration * 0.7 // 70% formation, 30% transition
      const transDuration = actDuration * 0.3

      const altitude = 15 + (i % 3) * 5

      const gen = generators[i % generators.length]!
      const genParams: Record<string, unknown> = gen === 'grid'
        ? { cols: Math.ceil(Math.sqrt(droneCount)), rows: Math.ceil(Math.sqrt(droneCount)), spacing: 2 }
        : gen === 'star'
          ? { count: droneCount, points_n: 5, outerRadius: 12, innerRadius: 5 }
          : gen === 'heart'
            ? { count: droneCount, size: 10 }
            : { count: droneCount, radius: 10 + i * 2 }

      const act: ShowAct = {
        label: `Act ${i + 1}`,
        formations: [{
          name: `${gen.charAt(0).toUpperCase() + gen.slice(1)} ${i + 1}`,
          generator: { type: gen, params: genParams },
          duration: Math.round(formDuration * 10) / 10,
          altitude,
          colorProgramId: colors[i % colors.length],
        }],
      }

      if (i < actCount - 1) {
        act.transition = {
          strategyId: strategies[i % strategies.length]!,
          duration: Math.max(2, Math.round(transDuration * 10) / 10),
        }
      }

      acts.push(act)
    }

    const outline: ShowOutline = {
      name: `Music Show (${bpm} BPM)`,
      droneCount,
      acts,
    }
    const result = buildShowFromOutline(outline)

    return {
      success: true,
      data: {
        summary: result.summary,
        bpm,
        totalBeats,
        actCount,
        duration: result.duration,
        style,
      },
    }
  },
})

// ── generate_show_structure ─────────────────────────────────────────────────

registerTool({
  name: 'generate_show_structure',
  description: 'Generate a ShowOutline JSON from a free-text description WITHOUT building it yet. Returns the outline for user review and confirmation. The user can request changes before you build it with create_show_from_outline.',
  inputSchema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Free-text show description (e.g., "3-minute patriotic show with 200 drones")' },
      droneCount: { type: 'number', description: 'Number of drones (optional, AI infers from description)' },
    },
    required: ['description'],
  },
  isWriteTool: false,
  execute: (params) => {
    return {
      success: true,
      data: {
        instruction: 'Generate a ShowOutline JSON based on the description. Present it to the user in a readable format (act names, formation types, timings, colors) and ask for confirmation before calling create_show_from_outline.',
        description: params.description,
        droneCount: params.droneCount ?? null,
        template: {
          name: 'string',
          droneCount: 'number (50-500)',
          acts: [{
            label: 'string (e.g., "Act 1 — Opening")',
            formations: [{
              name: 'string',
              generator: { type: 'ring|grid|sphere|heart|star|spiral|line|text', params: {} },
              duration: 'number (5-15s)',
              altitude: 'number (12-25m)',
              colorProgramId: 'solid-white|solid-red|solid-blue|solid-green|gradient-blue-red|gradient-warm|rainbow|rainbow-index|pulse-white|chase-rgb',
            }],
            transition: { strategyId: 'shortest-path|spiral|explosion|implosion|cascade|morph|bounce|stagger', duration: 'number (2-5s)' },
          }],
        },
      },
    }
  },
})
