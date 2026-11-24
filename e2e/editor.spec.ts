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
