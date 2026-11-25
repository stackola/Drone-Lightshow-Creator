import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake Claude: each request pops the next scripted reply and hands it over through the request's tool.
const replies: unknown[] = []
const requests: { content: { type: string; text?: string; source?: { data: string } }[]; tool: string }[] = []
vi.mock('./client', async (orig) => {
  const real = await orig<typeof import('./client')>()
  return {
    ...real,
    getClient: () => ({
      beta: {
        messages: {
          stream: (body: { messages: { content: never }[]; tools: { name: string }[] }) => {
            const tool = body.tools[0]!.name
            requests.push({ content: body.messages[0]!.content, tool })
            const reply = replies.shift()
            return {
              on: () => {},
              finalMessage: async () => ({ stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', id: `t${requests.length}`, name: tool, input: reply }] }),
            }
          },
        },
      },
    }),
  }
})

const { createModel, lookAndFix, modelShape, partsFromOutput } = await import('./model3d')
type Model3DOutput = import('./model3d').Model3DOutput

const snowman: Model3DOutput = {
  name: 'Snowman',
  parts: [
    { type: 'sphere', center: [0, -0.5, 0], radius: 0.5, color: '#ffffff' },
    { type: 'sphere', center: [0, 0.25, 0], radius: 0.35, color: '#ffffff' },
    { type: 'cone', from: [0, 0.25, 0.3], to: [0, 0.25, 0.65], radius: 0.06, radius_top: 0, color: '#ff8a00' },
  ],
}
const withHat: Model3DOutput = { ...snowman, parts: [...snowman.parts, { type: 'cylinder', from: [0, 0.55, 0], to: [0, 0.85, 0], radius: 0.22, color: '#ff3366' }] }

const renders: number[] = []
const render = (points: Float32Array) => { renders.push(points.length / 3); return 'iVBORfake' }

describe('3D model look and fix', () => {
  beforeEach(() => { replies.length = 0; requests.length = 0; renders.length = 0 })

  it('converts model output to validated parts (snake_case radius_top, junk dropped)', () => {
    const parts = partsFromOutput({ name: 'x', parts: [...snowman.parts, { type: 'teapot' as never, color: '#fff' }] })
    expect(parts).toHaveLength(3)
    expect(parts[2]).toMatchObject({ type: 'cone', radius: 0.06, radiusTop: 0 })
  })

  it('fixes until Claude is satisfied, then stops', async () => {
    replies.push(snowman, { critique: 'Reads as a snowman but needs a hat.', done: false, model: withHat }, { critique: 'Clear snowman with a hat.', done: true, model: withHat })
    const updates: string[] = []
    const attempts = await createModel('a snowman with a hat', { n: 120, rounds: 3, render, onUpdate: (_a, busy) => updates.push(String(busy)) })
    expect(attempts).toHaveLength(2)
    expect(attempts.map((a) => a.verdict)).toEqual(['fixed', 'good'])
    expect(attempts[0]!.critique).toMatch(/needs a hat/)
    expect(attempts[1]!.parts).toHaveLength(4)
    // Each attempt is rendered as the real drone count, and as dense solid surfaces for reference.
    expect(renders).toEqual([120, 600, 120, 600])
    expect(updates).toEqual(['generating', 'looking', 'looking', 'null'])
    // Each review saw the current model and its four-view render.
    const review = requests[1]!.content
    expect(review.some((b) => b.type === 'image' && b.source?.data === 'iVBORfake')).toBe(true)
    expect(review.some((b) => b.text?.includes('"Snowman"'))).toBe(true)
    expect(review.some((b) => b.text?.includes('as solid surfaces'))).toBe(true)
    expect(review.some((b) => b.text?.includes('Drone budget: 120 drones'))).toBe(true)
  })

  it('respects the round limit', async () => {
    replies.push(snowman, { critique: 'Needs a hat.', done: false, model: withHat })
    const attempts = await createModel('a snowman', { n: 80, rounds: 1, render })
    expect(attempts).toHaveLength(2)
    expect(attempts[1]!.verdict).toBeUndefined()
  })

  it('designer feedback always produces a revision and tells Claude about buried parts', async () => {
    const buried = { name: 'Ball', parts: [{ type: 'sphere', center: [0, 0, 0], radius: 1, color: '#fff' }, { type: 'sphere', center: [0, 0, 0], radius: 0.2, color: '#f00' }] }
    replies.push(buried)
    const [first] = await createModel('a ball', { n: 60, rounds: 0, render })
    expect(first!.hiddenParts).toEqual([1])
    replies.push({ critique: 'Fine as is.', done: true, model: snowman })
    const { next } = await lookAndFix('a ball', first!, 60, render, { feedback: 'turn it into a snowman' })
    expect(next?.name).toBe('Snowman')
    const sent = requests[1]!.content.map((b) => b.text ?? '').join('\n')
    expect(sent).toMatch(/Parts 1 \(0-based\) produce no drones/)
    expect(sent).toMatch(/The designer asks: turn it into a snowman/)
  })
})

describe('3D models with moving parts', () => {
  it('keeps joints that parts move with, renders the motion, and settles to what the drones can fly', async () => {
    const bird = {
      name: 'Eagle', relief: true,
      parts: [
        { type: 'ellipsoid', center: [0, 0, 0], radii: [0.15, 0.35, 0.12], rotation: [0, 0, 0], color: '#ffb347' },
        { type: 'plate', center: [0.5, 0.05, 0], points: [[-0.38, -0.08], [0.4, 0.05], [0.3, 0.14], [-0.38, 0.1]], depth: 0.02, rotation: [0, 0, 0], color: '#ff8c2e', joint: 'r' },
        { type: 'plate', center: [-0.5, 0.05, 0], points: [[0.38, -0.08], [-0.4, 0.05], [-0.3, 0.14], [0.38, 0.1]], depth: 0.02, rotation: [0, 0, 0], color: '#ff8c2e', joint: 'l' },
        { type: 'tube', path: [[0, -0.3, 0], [0.05, -0.55, 0.02], [0, -0.75, 0]], radius: 0.01, color: '#ffd27a' },
      ],
      joints: [
        { id: 'r', name: 'Right wing', kind: 'swing', pivot: [0.12, 0.05, 0], axis: [0, 0, 1], amount: 25, period: 8 },
        { id: 'l', name: 'Left wing', kind: 'swing', pivot: [-0.12, 0.05, 0], axis: [0, 0, -1], amount: 25, period: 8 },
        { id: 'unused', name: 'Nothing', kind: 'turn', pivot: [0, 0, 0], axis: [0, 1, 0], amount: 10 },
      ],
    }
    replies.push(bird)
    const strips: number[] = []
    const [a] = await createModel('an eagle flapping its wings', { n: 150, rounds: 0, render: { views: render, strip: (frames) => { strips.push(frames.length); return 'strip' } } })
    expect(a!.joints!.map((j) => j.id)).toEqual(['r', 'l'])
    expect(a!.relief).toBe(true)
    expect(a!.motion).toBe('strip')
    expect(strips).toEqual([3]) // at rest and at both ends of the swing
    const shape = modelShape(a!)
    expect(shape.joints).toHaveLength(2)
    expect(shape.relief).toBe(true)
    expect(shape.parts.filter((p) => p.joint).length).toBe(2)
  })
})
