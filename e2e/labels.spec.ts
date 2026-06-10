// ============================================================================
// Readable-label sweep regression tests (2026-05-21).
// ============================================================================
// The graph canvas + inspectors + timeline ruler all resolve to display
// names instead of raw IDs. These tests assert the canonical "user sees
// 'Opening Ring' not 'mpfqj9pa'" promise across the Simple Linear demo.
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test('Simple Linear: formation card shows formation name', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  // The "Opening Ring" formation lives in the seed; its card label should
  // resolve to that name rather than the auto-generated formation id.
  await expect(page.locator('.react-flow__node-formation').filter({ hasText: 'Opening Ring' }).first()).toBeVisible({ timeout: 10000 })
})

test('Simple Linear: transition card shows strategy display name', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await expect(page.locator('.react-flow__node-transition').filter({ hasText: 'Shortest Path' }).first()).toBeVisible({ timeout: 10000 })
})

test('Simple Linear: timeline ruler bars use formation names', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  // The TimelineRulerPanel mirrors the canvas node labels.
  await expect(page.getByText('Opening Ring').first()).toBeVisible({ timeout: 10000 })
})

test('Simple Linear: clicking formation node shows inspector with name in header', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await page.locator('.react-flow__node-formation').first().click()
  // Header is `Formation · Opening Ring` (from 20:14 inspector polish).
  await expect(page.getByText(/Formation · Opening Ring/)).toBeVisible({ timeout: 5000 })
})
