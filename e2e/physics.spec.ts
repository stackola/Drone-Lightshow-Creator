// ============================================================================
// Physics e2e — post-cutover, validation is ambient: a StatusStrip badge
// opens the drawer hosting the violations panel. Same copy assertions as
// the legacy tab tests.
// KNOWN-BAD baseline: "Simple Linear demo ships clean physics" fails on a
// clean tree (the demo ships 1 violation — pre-existing collision-margin
// regression family, see memory/test-baseline).
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

async function openPhysicsDrawer(page: import('@playwright/test').Page) {
  await page.getByTestId('physics-badge').click()
  await expect(page.getByTestId('physics-drawer')).toBeVisible()
}

test('blank canvas has zero physics violations', async ({ page }) => {
  await gotoEditor(page)
  await openPhysicsDrawer(page)
  await expect(page.getByText(/Physics validates clean|No physics violations detected|OK/i).first()).toBeVisible({ timeout: 5000 })
})

test('Simple Linear demo ships clean physics', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await page.waitForTimeout(500)
  await openPhysicsDrawer(page)
  await expect(page.getByText(/Physics validates clean|No physics violations detected/i).first()).toBeVisible({ timeout: 5000 })
})

test('Split/Merge demo ships clean physics', async ({ page }) => {
  await gotoEditor(page, 'Split/Merge Starter')
  await page.waitForTimeout(500)
  await openPhysicsDrawer(page)
  // The seed used to ship with "Shortest Path needs 6.3s (has 6.0s)" — the
  // tIntro `preferredDuration` was bumped 6 → 7 in the same change.
  await expect(page.getByText(/Physics validates clean|No physics violations detected/i).first()).toBeVisible({ timeout: 5000 })
})
