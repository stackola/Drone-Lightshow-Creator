import { test, expect, type Page } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import { readFileSync } from 'node:fs'

/** A mono 16-bit WAV click track at `bpm` — enough for beat detection. */
function clickWav(bpm: number, seconds: number, sr = 22050): Buffer {
  const n = Math.floor(seconds * sr)
  const data = Buffer.alloc(n * 2)
  const period = 60 / bpm
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const ph = (t - 0.25) / period
    const k = ph >= 0 ? (ph - Math.floor(ph)) * period : 1
    const v = k < 0.03 ? Math.sin(k * 2 * Math.PI * 900) * Math.exp(-k / 0.006) * (Math.floor(ph) % 4 === 0 ? 0.9 : 0.5) : 0
    data.writeInt16LE(Math.round(v * 32000), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24)
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="80" fill="#ff3366"/><rect x="70" y="40" width="60" height="120" fill="#33ccff"/></svg>`

async function fresh(page: Page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 20000 })
}

async function chooseFile(page: Page, trigger: () => Promise<void>, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser')
  await trigger()
  await (await chooser).setFiles(file)
}

test('opens on a demo that passes every safety check', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await fresh(page)
  await expect(page.locator('.slist .srow')).toHaveCount(7) // takeoff + 5 scenes + landing
  expect(errors).toEqual([])
})

test('music: beats are detected and shown on the timeline', async ({ page }) => {
  await fresh(page)
  await chooseFile(page, () => page.getByRole('button', { name: 'Load music' }).click(), { name: 'click-120.wav', mimeType: 'audio/wav', buffer: clickWav(120, 20) })
  await expect(page.getByText(/Snap · 120 BPM/)).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.music-clip')).toBeVisible()
  // At fit-to-width zoom only bar lines show; zoomed in, every beat does.
  expect(await page.locator('.ruler .bar').count()).toBeGreaterThan(8)
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click()
  expect(await page.locator('.ruler .beat').count()).toBeGreaterThan(10)
})

test('music: compose an original score to the show, and undo back to the song', async ({ page }) => {
  await fresh(page)
  await chooseFile(page, () => page.getByRole('button', { name: 'Load music' }).click(), { name: 'click-120.wav', mimeType: 'audio/wav', buffer: clickWav(120, 20) })
  await expect(page.locator('.music-clip .mname')).toHaveText('click-120.wav', { timeout: 20000 })
  await page.getByRole('button', { name: 'Music', exact: true }).click()
  await page.getByRole('button', { name: /Compose a score for this show/ }).click()
  await expect(page.getByText(/Composed a .* score/)).toBeVisible()
  await expect(page.locator('.music-clip .mname')).toHaveText(/original score$/, { timeout: 30000 })
  await expect(page.locator('.sec-band', { hasText: /drop/i }).first()).toBeVisible()
  await expect(page.locator('.status-btn')).toContainText('Safe to fly')
  // Undo brings the loaded song back, audio included.
  await page.keyboard.press('Control+z')
  await expect(page.locator('.music-clip .mname')).toHaveText('click-120.wav', { timeout: 20000 })
})

test('groups: a formation splits, each half flies its own formations, then everyone merges', async ({ page }) => {
  await fresh(page)
  await page.locator('.slist .srow:not(.fixed)', { hasText: 'Heart' }).first().click()
  await page.getByRole('button', { name: 'Left | right' }).click()
  await expect(page.locator('.srow.step')).toHaveCount(2)
  await expect(page.locator('.blk.split .split-row')).toHaveCount(2)
  await expect(page.locator('.insp-kind')).toContainText('Left · step 1')
  await expect(page.locator('.status-btn')).toContainText('Safe to fly')
  // Back to the parent; give the right half a second formation of its own.
  await page.locator('.insp-kind .link-btn').click()
  await page.locator('.group-card', { hasText: 'Right' }).getByRole('button', { name: /Formation/ }).click()
  await page.locator('.popover .shape-tile', { hasText: 'Circle' }).click()
  await expect(page.locator('.srow.step')).toHaveCount(3)
  await expect(page.locator('.status-btn')).toContainText('Safe to fly')
  // During the split the stage says so; undo takes the new formation away again.
  await page.locator('.srow.step').first().click()
  await expect(page.locator('.now-label')).toContainText('Groups of')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.srow.step')).toHaveCount(2)
})

test('site: place the show, draw a keep-out zone, and fix the formation that intrudes', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#445"/></svg>',
  }))
  await fresh(page)
  await page.getByRole('button', { name: /Place on a map/ }).click()
  await page.getByLabel('Location').fill('51.5079, -0.0877')
  await page.getByLabel('Location').press('Enter')
  await expect(page.getByText('Launch site 51.507900, -0.087700')).toBeVisible()
  await expect(page.locator('.site-tiles image').first()).toBeAttached()
  // Draw a no-fly zone over the right of the show.
  await page.getByRole('radio', { name: /Zone/ }).first().click()
  const box = (await page.locator('svg.site-map').boundingBox())!
  for (const [fx, fy] of [[0.62, 0.28], [0.75, 0.28], [0.75, 0.42], [0.62, 0.42], [0.62, 0.28]] as const) await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await expect(page.locator('.zone-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.status-btn')).toContainText('1 issue')
  await expect(page.locator('.issue-card, .issue').first()).toContainText(/no-fly zone/)
  await page.getByRole('button', { name: /Fix 1 automatically/ }).click()
  await expect(page.locator('.status-btn')).toContainText('Safe to fly')
  // The site is saved with the show.
  await expect(page.locator('.site-summary')).toContainText('51.50790')
  await expect(page.locator('.site-summary')).toContainText('1 keep-out zone')
})

test('position accuracy widens the spacing everything keeps', async ({ page }) => {
  await fresh(page)
  await page.getByRole('radio', { name: 'RTK+' }).click()
  await expect(page.getByText(/kept 3\.00 m apart/)).toBeVisible()
  const status = page.locator('.status-btn')
  await expect(status).not.toContainText('Planning')
  if (!(await status.textContent())?.includes('Safe to fly')) await page.getByRole('button', { name: /Fix \d+ automatically/ }).click()
  await expect(status).toContainText('Safe to fly', { timeout: 20000 })
  // GPS without RTK needs 8 m between drones: this fleet no longer fits the airspace, and the editor says so.
  await page.getByRole('radio', { name: 'GPS' }).click()
  await expect(page.getByText(/kept 8\.00 m apart/)).toBeVisible()
  await expect(status).not.toContainText('Safe to fly')
})

test('logo import becomes a safe formation with image colours', async ({ page }) => {
  await fresh(page)
  await page.locator('.panel-head .btn.primary').click()
  await chooseFile(page, () => page.locator('.popover .shape-tile', { hasText: 'Image' }).click(), { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(LOGO_SVG) })
  await expect(page.locator('.srow', { hasText: 'logo' })).toBeVisible()
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 20000 })
  await expect(page.locator('.layer-card select.select').last()).toHaveValue('image')
})

test('exports one CSV per drone', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByText('Export trajectories…').click()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ZIP' }).click()
  const zip = unzipSync(readFileSync(await (await dl).path()))
  const csvs = Object.keys(zip).filter((f) => f.endsWith('.csv'))
  expect(csvs).toHaveLength(200)
  const rows = strFromU8(zip[csvs[0]!]!).trim().split('\n')
  expect(rows[0]).toBe('time_s,east_m,north_m,up_m,red,green,blue')
  expect(Number(rows[1]!.split(',')[3])).toBe(0) // starts on the ground
})

test('project files round-trip', async ({ page }) => {
  await fresh(page)
  await page.locator('.stage').click({ position: { x: 300, y: 300 } })
  const saved = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const text = readFileSync(await (await saved).path(), 'utf8')
  expect(JSON.parse(text).format).toBe('drone-show-designer')

  // Change the show, then reopen the saved file.
  await page.locator('.srow', { hasText: 'Heart' }).hover()
  await page.locator('.srow', { hasText: 'Heart' }).getByRole('button', { name: 'Delete scene' }).click()
  await expect(page.locator('.slist .srow')).toHaveCount(6)
  await page.getByRole('button', { name: 'File' }).click()
  await chooseFile(page, () => page.getByText('Open project…').click(), { name: 'show.droneshow.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(page.locator('.slist .srow')).toHaveCount(7)
})

test('light cues: add from the timeline, edit, undo', async ({ page }) => {
  await fresh(page)
  const before = await page.locator('.blk.cue').count()
  await page.locator('.tl-label', { hasText: 'Lights' }).getByRole('button').click()
  await page.getByRole('button', { name: 'Strobe' }).click()
  await expect(page.locator('.blk.cue')).toHaveCount(before + 1)
  await expect(page.locator('.insp-kind')).toHaveText('Light cue')
  await page.keyboard.press('Escape')
  await page.locator('.stage').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.blk.cue')).toHaveCount(before)
})

test('idle drones: spare drones become a halo, and the formation breathes safely', async ({ page }) => {
  await fresh(page)
  await page.locator('.slist .srow', { hasText: 'Heart' }).click()
  await page.getByRole('button', { name: /Shape$/ }).first().click()
  await page.getByRole('button', { name: 'Halo' }).click()
  await expect(page.getByRole('radio', { name: 'Halo' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: 'Breathe', exact: true }).click()
  await expect(page.getByText(/Safe up to \d+%/)).toBeVisible()
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 20000 })
  // Switching the role rebuilds the spare layer in place.
  await page.getByRole('radio', { name: 'Starfield' }).click()
  await expect(page.getByRole('radio', { name: 'Starfield' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 20000 })
})

test('wind test: simulates the show and plays the simulated flight in the viewport', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: /Wind test/ }).click()
  await page.getByRole('radio', { name: 'Calm' }).click()
  await page.getByRole('button', { name: 'Run wind test' }).click()
  await expect(page.locator('.wind-verdict')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.wind-verdict')).toHaveClass(/ok/)
  await page.getByRole('button', { name: 'Watch in viewport' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.sim-badge')).toContainText('Simulated in 2 m/s wind')
  await page.locator('.sim-badge').getByRole('button', { name: 'Show plan' }).click()
  await expect(page.locator('.sim-badge')).toHaveCount(0)
})

test('viewport manipulation: tools, nudging, framing and click-to-deselect', async ({ page }) => {
  await fresh(page)
  await page.locator('.slist .srow', { hasText: 'Heart' }).click()
  const alt = page.getByLabel('Alt').first()
  const before = Number(await alt.inputValue())
  await page.keyboard.press('Alt+ArrowUp')
  await page.keyboard.press('Alt+Shift+ArrowUp')
  await expect(alt).toHaveValue(String(before + 6))
  // One undo step for consecutive nudges.
  await page.keyboard.press('Control+z')
  await expect(alt).toHaveValue(String(before))
  // Tools
  const toolbar = page.locator('.toolbar')
  await page.keyboard.press('e')
  await expect(toolbar.getByRole('radio', { name: /Rotate/ })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('r')
  await expect(toolbar.getByRole('radio', { name: /Scale/ })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('w')
  await expect(toolbar.getByRole('radio', { name: /Move/ })).toHaveAttribute('aria-checked', 'true')
  // F frames the formation in the orbit view.
  await page.keyboard.press('f')
  await expect(page.getByRole('radio', { name: /Orbit/ })).toHaveAttribute('aria-checked', 'true')
  // Clicking empty sky deselects.
  await page.keyboard.press('1')
  const box = (await page.locator('main.stage canvas').first().boundingBox())!
  await page.mouse.click(box.x + 40, box.y + box.height * 0.3)
  await expect(page.locator('.insp-kind').first()).toHaveText(/Show/i)
  await expect(page.locator('.toolbar')).toHaveCount(0)
})

test('transitions: pick a spectacle transition for a flight', async ({ page }) => {
  await fresh(page)
  await page.locator('.slist .srow', { hasText: 'Heart' }).click()
  await page.getByLabel('Transition style').selectOption('swirl')
  await expect(page.getByLabel('Transition style')).toHaveValue('swirl')
  await expect(page.locator('.blk.flight.styled')).toHaveCount(1, { timeout: 20000 })
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 20000 })
  await page.getByLabel('Transition style').selectOption('cascade')
  await page.getByLabel('Ripple direction').selectOption('center')
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 20000 })
  // Undo back to a direct flight.
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.blk.flight.styled')).toHaveCount(0, { timeout: 20000 })
})

test('text effects: LED sign with small letters, and write-on', async ({ page }) => {
  await fresh(page)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'LED sign' }).click()
  await expect(page.getByLabel('LED text')).toHaveValue('WELCOME')
  await page.getByLabel('LED text').fill('HI THERE')
  await page.getByRole('radio', { name: '3×5 (small)' }).click()
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 20000 })
  await page.locator('.slist .srow', { hasText: 'Hello' }).click()
  await page.getByLabel('Light effect').first().selectOption('write')
  await expect(page.getByText('Writes in')).toBeVisible()
})

test('the 15-minute flagship demo plans in the background and passes every check', async ({ page }) => {
  test.setTimeout(240_000)
  await fresh(page)
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: /New show/ }).or(page.getByRole('button', { name: /New show/ })).first().click()
  await page.getByRole('button', { name: /Odyssey/ }).click()
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('.meta')).toContainText('400 drones', { timeout: 180_000 })
  await expect(page.locator('.meta')).toContainText(/1[45]:\d\d/)
  await expect(page.locator('.status-btn')).toContainText('Safe to fly', { timeout: 180_000 })
  await expect(page.locator('.slist .srow', { hasText: 'Tree of life' })).toBeVisible()
  await expect(page.locator('.blk.flight.styled').first()).toBeVisible()
  // Its own score: composed to the show, regenerated in the background, sections on the music lane.
  await expect(page.locator('.music-clip')).toContainText('Odyssey', { timeout: 60_000 })
  await expect(page.locator('.sec-band', { hasText: /drop/i }).first()).toBeVisible()
  await expect(page.locator('.music-clip .mname')).not.toContainText(/composing|not loaded/, { timeout: 60_000 })
})
