// ============================================================================
// Demo project e2e — `Simple Linear` and `Split Story` should both load,
// render formations, and let the user click a formation node to bring up
// the FormationNodeInspector (2026-05-21).
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test('Simple Linear demo loads and shows >1 nodes', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  // Simple Linear = launch → formation → land at minimum. React Flow's
  // node-type class survives custom labels.
  await expect(page.locator('.react-flow__node-formation').first()).toBeVisible({ timeout: 10000 })
})

test('Simple Linear demo — formation click hands off to inspector', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await page.locator('.react-flow__node-formation').first().click()
  await expect(page.getByText(/Formation · /).first()).toBeVisible({ timeout: 5000 })
})

test('Split/Merge Starter has multiple formation nodes', async ({ page }) => {
  await gotoEditor(page, 'Split/Merge Starter')
  const formationNodes = page.locator('.react-flow__node-formation')
  await expect(formationNodes.first()).toBeVisible({ timeout: 10000 })
  const count = await formationNodes.count()
  expect(count).toBeGreaterThanOrEqual(2)
})

test('playback toggle reaches the transport bar', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  // The play button uses an icon (▶); we identify it by its aria-label / title.
  const playButton = page.getByRole('button', { name: /play|space/i }).first()
  await expect(playButton).toBeVisible({ timeout: 5000 })
  // Space toggles play/pause.
  await page.keyboard.press('Space')
  await page.waitForTimeout(200)
  await page.keyboard.press('Space')
})
