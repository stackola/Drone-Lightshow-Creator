import { test, expect, type Page, type Request } from '@playwright/test'

// A mock Claude API: answers /v1/messages with real-format server-sent events
// (thinking, text, tool_use with streamed input), so the actual SDK, streaming
// loop, tool execution and UI are exercised without a key or network.

type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
interface Reply { blocks: Block[]; stop: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' }
type Responder = (body: Record<string, unknown>, req: Request) => Reply | { status: number; error: string }

let msgId = 0
function sse(reply: Reply): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let out = ev('message_start', { message: { id: `msg_${++msgId}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } })
  reply.blocks.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      const mid = Math.ceil(b.text.length / 2)
      for (const part of [b.text.slice(0, mid), b.text.slice(mid)]) if (part) out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: part } })
    } else if (b.type === 'thinking') {
      out += ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      out += ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: b.thinking } })
      out += ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'c2lnbmF0dXJl' } })
    } else {
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      const json = JSON.stringify(b.input)
      const mid = Math.ceil(json.length / 2)
      out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(0, mid) } })
      out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(mid) } })
    }
    out += ev('content_block_stop', { index })
  })
  out += ev('message_delta', { delta: { stop_reason: reply.stop, stop_sequence: null }, usage: { output_tokens: 300 } })
  out += ev('message_stop', {})
  return out
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

async function mockClaude(page: Page, responder: Responder) {
  const seen: { body: Record<string, unknown>; headers: Record<string, string> }[] = []
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (req.url().includes('/v1/models/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-10-01T00:00:00Z' }) })
    const body = req.postDataJSON() as Record<string, unknown>
    seen.push({ body, headers: await req.allHeaders() })
    const r = responder(body, req)
    if ('status' in r) return route.fulfill({ status: r.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: r.error } }) })
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(r) })
  })
  return seen
}

async function open(page: Page, withKey = true) {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.clear()
    localStorage.setItem('dsd.hint.dismissed', '1')
    if (key) localStorage.setItem('dsd.ai.settings.v1', JSON.stringify({ apiKey: 'sk-ant-test', baseURL: '' }))
  }, withKey)
  await page.goto('/')
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 20000 })
}

type Msg = { role: string; content: string | { type: string; text?: string; content?: unknown }[] }
const lastIsToolResult = (body: Record<string, unknown>) => {
  const msgs = body.messages as Msg[]
  const last = msgs[msgs.length - 1]!
  return Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')
}
const firstSceneId = (body: Record<string, unknown>) => /\[(scene_[a-z0-9]+)\]/.exec(JSON.stringify(body.messages))![1]!

test('copilot edits the show with tools; one undo reverts the whole request', async ({ page }) => {
  const seen = await mockClaude(page, (body) =>
    lastIsToolResult(body)
      ? { blocks: [{ type: 'text', text: 'Added a **rocket** finale and turned the opening into a rainbow.' }], stop: 'end_turn' }
      : {
          blocks: [
            { type: 'thinking', thinking: 'The user wants a rocket at the end.' },
            { type: 'tool_use', id: 'toolu_1', name: 'add_scene', input: { scene: { name: 'Rocket finale', shape: { kind: 'cone', radius: 0.3 }, light: { effect: 'gradient', color: '#ff5500', color2: '#ffd36e' }, spin: 15 } } },
            { type: 'tool_use', id: 'toolu_2', name: 'set_light', input: { scene_id: firstSceneId(body), light: { effect: 'rainbow' } } },
          ],
          stop: 'tool_use',
        },
  )
  await open(page)
  await page.keyboard.press('Control+k')
  await page.getByLabel('Message the copilot').fill('Add a rocket finale and make the opening a rainbow')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Added a rocket finale')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.cp-tool')).toHaveCount(2)
  await expect(page.locator('.cp-tool.error')).toHaveCount(0)
  await expect(page.locator('.srow', { hasText: 'Rocket finale' })).toBeVisible()
  await expect(page.locator('.status-btn')).toContainText('Safe to fly')

  // Request shape: Opus 5.5, refusal fallbacks, adaptive thinking, cached system, eager tool streaming.
  const first = seen[0]!
  // This SDK version sends API keys as a bearer token.
  expect(first.headers['authorization']).toBe('Bearer sk-ant-test')
  expect(first.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
  expect(first.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01')
  expect(first.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', thinking: { type: 'adaptive', display: 'summarized' } })
  expect((first.body.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: 'ephemeral' })
  expect((first.body.tools as { eager_input_streaming?: boolean }[]).every((t) => t.eager_input_streaming)).toBe(true)
  // The thinking block went back unchanged and both tool results came back in one message.
  const second = seen[1]!.body.messages as Msg[]
  expect((second[1]!.content as { type: string }[])[0]!.type).toBe('thinking')
  expect((second[2]!.content as { type: string }[]).map((b) => b.type)).toEqual(['tool_result', 'tool_result'])

  await page.locator('.cp-turn').getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.srow', { hasText: 'Rocket finale' })).toHaveCount(0)
})

test('copilot looks at formations (vision) and invalid tool input is returned, not run', async ({ page }) => {
  const seen = await mockClaude(page, (body) => {
    const n = (body.messages as Msg[]).length
    if (n === 1) return { blocks: [{ type: 'tool_use', id: 't1', name: 'look_at_scenes', input: {} }, { type: 'tool_use', id: 't2', name: 'set_light', input: { scene_id: firstSceneId(body), light: { effect: 'lava' } } }], stop: 'tool_use' }
    return { blocks: [{ type: 'text', text: 'The heart reads well; the text is a little wide.' }], stop: 'end_turn' }
  })
  await open(page)
  await page.keyboard.press('Control+k')
  await page.getByLabel('Message the copilot').fill('How do the scenes look?')
  await page.keyboard.press('Enter')
  await expect(page.getByText('The heart reads well')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.cp-tool.error')).toHaveCount(1)
  const results = (seen[1]!.body.messages as Msg[])[2]!.content as { type: string; is_error?: boolean; content: { type: string; source?: { data: string } }[] | string }[]
  const image = (results[0]!.content as { type: string; source?: { data: string } }[]).find((b) => b.type === 'image')
  expect(image?.source?.data.startsWith('iVBOR')).toBe(true) // a PNG
  expect(results[1]!.is_error).toBe(true)
})

const PLAN = {
  title: 'NOVA launch',
  concept: 'From a single spark to the reveal of NOVA.',
  scenes: [
    { name: 'Spark', shape: { kind: 'circle' }, light: { effect: 'pulse', color: '#00d1b2', beat_sync: false }, hold_seconds: 5 },
    { name: 'Countdown', shape: { kind: 'text', text: '3', font: 'pixel' }, light: { effect: 'solid', color: '#ffffff' }, hold_seconds: 2, spare_fraction: 0.5 },
    { name: 'NOVA', shape: { kind: 'text', text: 'NOVA' }, light: { effect: 'wave', color: '#00d1b2', color2: '#ffffff' }, hold_seconds: 7 },
    { name: 'Bolt', shape: { kind: 'star', points: 4, inner: 0.3 }, light: { effect: 'chase', color: '#0b3b37', color2: '#7fffe8' }, hold_seconds: 6 },
  ],
  cues: [{ scene_index: 2, offset_seconds: 0, duration_seconds: 1, blend: 'add', light: { effect: 'flash' } }],
}

test('Show Director turns a brief into a safe show', async ({ page }) => {
  const seen = await mockClaude(page, () => ({ blocks: [{ type: 'tool_use', id: 'plan_1', name: 'submit_show_plan', input: PLAN }], stop: 'tool_use' }))
  await open(page)
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  await page.getByText('Generate a show from a brief…').click()
  await page.getByLabel(/Describe the show/).fill('Launch of the NOVA electric car, teal and white')
  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByText('Passes every safety check')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.result-grid figure')).toHaveCount(4)
  // The plan is handed over as a (non-strict) tool call: no grammar limits on its size.
  const body = seen[0]!.body as { output_config?: { format?: unknown; effort?: string }; tools?: { name: string; strict?: boolean }[] }
  expect(body.output_config?.format).toBeUndefined()
  expect(body.output_config?.effort).toBe('high')
  expect(body.tools?.map((t) => t.name)).toEqual(['submit_show_plan'])
  expect(body.tools?.[0]?.strict).toBeUndefined()
  await page.getByRole('button', { name: 'Use this show' }).click()
  await expect(page.locator('.title-input')).toHaveValue('NOVA launch')
  await expect(page.locator('.slist .srow')).toHaveCount(6)
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 15000 })
})

const ROCKET_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><path d="M200 30 C260 90 270 190 250 290 L150 290 C130 190 140 90 200 30 Z" fill="#e8f1ff"/><path d="M150 230 L95 320 L155 300 Z M250 230 L305 320 L245 300 Z" fill="#ff5a5a"/><path d="M165 290 L235 290 L200 380 Z" fill="#ffb02e"/></svg>'

const ROCKET_LINES_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><path d="M200 30 C260 90 270 190 250 290 L150 290 C130 190 140 90 200 30 Z" fill="none" stroke="#e8f1ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="200" cy="140" r="26" fill="none" stroke="#38bdf8" stroke-width="6"/><path d="M165 290 L235 290 L200 380 Z" fill="#ffb02e"/></svg>'

test('Describe a formation: words become a drawing become drones', async ({ page }) => {
  const seen = await mockClaude(page, (body) => {
    const tool = (body.tools as { name: string }[] | undefined)?.[0]?.name
    if (tool === 'submit_review') return { blocks: [{ type: 'tool_use', id: 'rev_1', name: 'submit_review', input: { critique: 'The outline needs to be bolder.', done: false, name: 'Rocket', svg: ROCKET_LINES_SVG } }], stop: 'tool_use' }
    return { blocks: [{ type: 'tool_use', id: 'draw_1', name: 'submit_drawing', input: { name: 'Rocket', svg: ROCKET_SVG } }], stop: 'tool_use' }
  })
  await open(page)
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  await page.getByText('Describe a formation…').click()
  await page.getByLabel('What should the drones draw?').fill('a rocket taking off')
  await page.getByRole('button', { name: 'Draw' }).click()
  await expect(page.getByAltText('Drawing of Rocket')).toBeVisible({ timeout: 15000 })
  // Claude compared its drawing with the drones (both as images) and redrew it with strokes.
  await expect(page.getByText(/Claude checked the drones: The outline needs to be bolder/)).toBeVisible()
  const review = (seen[1]!.body.messages as Msg[])[0]!.content as { type: string; text?: string }[]
  expect(review.filter((b) => b.type === 'image')).toHaveLength(2)
  expect(review.some((b) => b.text?.includes('Drone budget: 200 drones'))).toBe(true)
  await page.getByRole('button', { name: 'Add as new scene' }).click()
  await expect(page.locator('.srow', { hasText: 'Rocket' })).toBeVisible()
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 15000 })
  // The strokes are lines of drones in the saved shape.
  await expect.poll(() => page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('dsd.doc.v1') ?? 'null')
    const rocket = doc?.scenes?.find((s: { name: string }) => s.name === 'Rocket')
    return rocket?.layers?.[0]?.shape?.lines?.length ?? -1
  })).toBeGreaterThanOrEqual(2)
})

test('Client pitch is written from the real show (with images) and streams in', async ({ page }) => {
  const seen = await mockClaude(page, () => ({ blocks: [{ type: 'text', text: '# A sky that says hello\n\nFor **[client]**, 200 drones…\n\n## The show\n- 0:36 A sunrise disc\n- 0:59 HELLO' }], stop: 'end_turn' }))
  await open(page)
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  await page.getByText('Write a client pitch…').click()
  await page.getByLabel('Client', { exact: true }).fill('Hartmann Bakery')
  await page.getByRole('button', { name: 'Write pitch' }).click()
  await expect(page.getByRole('heading', { name: 'A sky that says hello' })).toBeVisible({ timeout: 15000 })
  const content = (seen[0]!.body.messages as Msg[])[0]!.content as { type: string; text?: string }[]
  expect(content.some((b) => b.type === 'image')).toBe(true)
  expect(content.some((b) => b.text?.includes('Hartmann Bakery'))).toBe(true)
})

test('API errors are explained in plain language', async ({ page }) => {
  await mockClaude(page, () => ({ status: 401, error: 'invalid x-api-key' }))
  await open(page)
  await page.keyboard.press('Control+k')
  await page.getByLabel('Message the copilot').fill('hello')
  await page.keyboard.press('Enter')
  await expect(page.getByText('The API key was rejected')).toBeVisible({ timeout: 15000 })
})

test('without a key the copilot asks to connect, and the key can be tested', async ({ page }) => {
  await mockClaude(page, () => ({ blocks: [{ type: 'text', text: 'ok' }], stop: 'end_turn' }))
  await open(page, false)
  await page.keyboard.press('Control+k')
  await expect(page.getByText('Connect Claude')).toBeVisible()
  await page.getByLabel('Claude API key').fill('sk-ant-new')
  await page.getByRole('button', { name: 'Save & test' }).click()
  await expect(page.getByText(/Connected — Claude Opus 5.5/).first()).toBeVisible({ timeout: 10000 })
  await expect(page.getByLabel('Message the copilot')).toBeVisible()
  await page.reload()
  await page.keyboard.press('Control+k')
  await expect(page.getByLabel('Message the copilot')).toBeVisible()
})

// --- 3D models with look and fix -------------------------------------------------------

const SNOWMAN = {
  name: 'Snowman',
  parts: [
    { type: 'sphere', center: [0, -0.5, 0], radius: 0.5, color: '#ffffff' },
    { type: 'sphere', center: [0, 0.25, 0], radius: 0.35, color: '#e8f1ff' },
    { type: 'cone', from: [0, 0.25, 0.3], to: [0, 0.25, 0.7], radius: 0.08, radius_top: 0, color: '#ff8a00' },
  ],
}
const SNOWMAN_HAT = { ...SNOWMAN, parts: [...SNOWMAN.parts, { type: 'cylinder', from: [0, 0.55, 0], to: [0, 0.9, 0], radius: 0.22, color: '#ff3366' }] }
const isReview = (body: Record<string, unknown>) => (body.tools as { name: string }[] | undefined)?.[0]?.name === 'submit_review'
const submit = (name: string, input: unknown) => ({ blocks: [{ type: 'tool_use' as const, id: `${name}_${Math.random().toString(36).slice(2, 8)}`, name, input }], stop: 'tool_use' as const })

test('3D model: built, looked at from four angles, fixed until right, added to the show', async ({ page }) => {
  let reviews = 0
  const seen = await mockClaude(page, (body) => {
    if (!isReview(body)) return submit('submit_model', SNOWMAN)
    reviews++
    const reply = reviews === 1
      ? { critique: 'Reads as a snowman, but it needs the hat from the brief.', done: false, model: SNOWMAN_HAT }
      : { critique: 'A clear snowman with a red hat.', done: true, model: SNOWMAN_HAT }
    return submit('submit_review', reply)
  })
  await open(page)
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  await page.getByText('Create a 3D model…').click()
  await page.getByLabel('What 3D object should the drones form?').fill('a snowman with a hat')
  await page.getByRole('button', { name: 'Build' }).click()
  await expect(page.getByText('A clear snowman with a red hat.')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.m3d-attempt')).toHaveCount(2)
  await expect(page.getByText('it needs the hat from the brief')).toBeVisible()
  // Each review looked at a real four-view render of the drones.
  const review = (seen[1]!.body.messages as Msg[])[0]!.content as { type: string; source?: { data: string } }[]
  expect(review.find((b) => b.type === 'image')?.source?.data.startsWith('iVBOR')).toBe(true)
  await page.getByRole('button', { name: 'Add as new scene' }).click()
  await expect(page.locator('.srow', { hasText: 'Snowman' })).toBeVisible()
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 15000 })
  await expect(page.locator('.layer-card').getByText('Snowman · 4 parts')).toBeVisible()
})

test('3D model: improve an existing model with designer feedback', async ({ page }) => {
  let feedbackSeen = ''
  await mockClaude(page, (body) => {
    if (!isReview(body)) return submit('submit_model', SNOWMAN)
    feedbackSeen = JSON.stringify(body.messages)
    return submit('submit_review', { critique: 'Added the hat you asked for.', done: false, model: SNOWMAN_HAT })
  })
  await open(page)
  // Build without look-and-fix rounds, add it, then improve from the inspector.
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  await page.getByText('Create a 3D model…').click()
  await page.getByLabel('What 3D object should the drones form?').fill('a snowman')
  await page.getByRole('radio', { name: 'None' }).click()
  await page.getByRole('button', { name: 'Build' }).click()
  await page.getByRole('button', { name: 'Add as new scene' }).click()
  await expect(page.locator('.layer-card').getByText('Snowman · 3 parts')).toBeVisible()
  await page.locator('.layer-card').getByRole('button', { name: 'Improve' }).click()
  await expect(page.locator('.m3d-attempt')).toHaveCount(1) // the current model, as seen now
  await page.getByLabel('Tell Claude what to change').fill('give it a red top hat')
  await page.getByRole('button', { name: 'Fix', exact: true }).click()
  await expect(page.getByText('Added the hat you asked for.')).toBeVisible({ timeout: 15000 })
  expect(feedbackSeen).toContain('give it a red top hat')
  await page.getByRole('button', { name: 'Apply to scene' }).click()
  await expect(page.locator('.layer-card').getByText('Snowman · 4 parts')).toBeVisible()
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 15000 })
})
