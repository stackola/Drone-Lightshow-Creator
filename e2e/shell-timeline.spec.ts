// ============================================================================
// Shell Phase 4 — TimelineDock: track rows, clips, transition segments,
// click-to-seek. Runs against the new shell (?shell=next).
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test('timeline dock renders tracks and clips for Simple Linear', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await expect(page.getByTestId('timeline-dock')).toBeVisible()
  // Simple Linear is one flow chain: launch → ring → grid → land.
  await expect(page.getByTestId('timeline-track').first()).toBeVisible()
  expect(await page.getByTestId('timeline-track').count()).toBeGreaterThanOrEqual(1)
  const clips = page.locator('[data-testid^="timeline-clip-"]')
  await expect(clips.first()).toBeVisible()
  expect(await clips.count()).toBeGreaterThanOrEqual(2)
})

test('clicking a clip selects its node and routes the inspector', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  // Second clip = the "Opening Ring" formation.
  const clip = page.locator('[data-testid^="timeline-clip-"]').nth(1)
  await clip.click()
  await expect(clip).toHaveAttribute('data-selected', 'true')
  // The floating inspector leaves its empty state for the node inspector.
  const inspector = page.getByTestId('inspector-card')
  await expect(inspector).toBeVisible()
  await expect(inspector.getByText('Nothing selected')).toBeHidden()
})

test('clicking a transition segment opens the edge inspector', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  const segment = page.getByTestId('transition-segment').first()
  await expect(segment).toBeVisible()
  await segment.click()
  const inspector = page.getByTestId('inspector-card')
  await expect(inspector.getByText('Flow Edge').first()).toBeVisible()
  await expect(inspector.getByText(/Transition/i).first()).toBeVisible()
})

test('clicking the ruler seeks the playhead', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  const playhead = page.getByTestId('timeline-playhead')
  const before = await playhead.boundingBox()
  // pxPerSecond defaults to 100 → x=250 ≈ 2.5s.
  await page.getByTestId('timeline-ruler').click({ position: { x: 250, y: 10 } })
  await expect(async () => {
    const after = await playhead.boundingBox()
    expect(after!.x).toBeGreaterThan(before!.x + 100)
  }).toPass()
  // Status strip time readout reflects the seek.
  await expect(page.getByText(/2\.5s/).first()).toBeVisible()
})
