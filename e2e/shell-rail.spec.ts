// ============================================================================
// Shell-rebuild Phase 2 — floating left rail (LeftRail + FormationsPanel).
// Covers: default-open Formations panel, search filtering, library Add,
// and icon-strip toggling.
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test.beforeEach(async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  // gotoEditor seeds graph mode, which pins the GraphSheet (z-30) over the
  // floating rail (z-20) — switch to Build so the rail is interactable.
  await page.getByTestId('mode-toggle-build').click()
  await expect(page.getByTestId('graph-sheet')).toBeHidden()
})

test('rail renders with the Formations panel open by default', async ({ page }) => {
  await expect(page.getByTestId('left-rail')).toBeVisible()
  await expect(page.getByTestId('rail-strip')).toBeVisible()
  await expect(page.getByTestId('rail-panel-formations')).toBeVisible()
  // Simple Linear seeds two project formations.
  const rows = page.getByTestId('rail-formation-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Opening Ring' })).toBeVisible()
  await expect(rows.filter({ hasText: 'Final Grid' })).toBeVisible()
  // Both are placed once on the graph → usage badges.
  await expect(rows.filter({ hasText: 'Opening Ring' }).getByText('×1')).toBeVisible()
})

test('search filters the project formation list', async ({ page }) => {
  const search = page.getByTestId('rail-formation-search')
  await search.fill('ring')
  const rows = page.getByTestId('rail-formation-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Opening Ring')
  await search.fill('zzz-no-match')
  await expect(rows).toHaveCount(0)
  await expect(page.getByText(/No project formations match/)).toBeVisible()
  await search.fill('')
  await expect(rows).toHaveCount(2)
})

test('library Add button adds the formation to the project', async ({ page }) => {
  const rows = page.getByTestId('rail-formation-row')
  await expect(rows).toHaveCount(2)
  await page.getByRole('button', { name: 'Add Firework Burst' }).click()
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'Firework Burst' })).toBeVisible()
  // Toast confirms, detail footer opens for the new def.
  await expect(page.getByText(/Added "Firework Burst" to project/).first()).toBeVisible()
  await expect(page.getByTestId('rail-formation-detail')).toBeVisible()
})

test('icon strip toggles sections open and closed', async ({ page }) => {
  // Same icon click closes the open panel.
  await page.getByTestId('rail-icon-formations').click()
  await expect(page.getByTestId('rail-panel-formations')).toBeHidden()
  // Another icon opens its panel.
  await page.getByTestId('rail-icon-planes').click()
  await expect(page.getByTestId('rail-panel-planes')).toBeVisible()
  await expect(page.getByRole('button', { name: /Add Build Plane/ })).toBeVisible()
  await page.getByTestId('rail-icon-formations').click()
  await expect(page.getByTestId('rail-panel-formations')).toBeVisible()
})
