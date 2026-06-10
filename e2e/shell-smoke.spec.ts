// ============================================================================
// Shell-rebuild smoke tests — the new shell (?shell=next / drone-shell-next)
// boots, renders its frame, and core flows work. Grows per phase; legacy
// specs stay pinned to the legacy shell until migrated.
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test('new shell boots with frame: topbar, rail, stage, dock, status', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await expect(page.getByTestId('left-rail')).toBeVisible()
  await expect(page.getByTestId('mode-toggle-build')).toBeVisible()
  // Stage canvas is up (gotoEditor already waited for canvas[data-engine]).
  await expect(page.locator('canvas[data-engine]').first()).toBeVisible()
  // Status strip shows save state.
  await expect(page.getByText(/Saved|Unsaved/).first()).toBeVisible()
})

test('graph mode opens the graph sheet over the stage', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await page.getByTestId('mode-toggle-graph').click()
  await expect(page.getByTestId('graph-sheet')).toBeVisible()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await page.getByTestId('mode-toggle-build').click()
  await expect(page.getByTestId('graph-sheet')).toBeHidden()
})

test('export dialog and shortcuts overlay work in the new shell', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await page.keyboard.press('Control+e')
  await expect(page.getByRole('dialog').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+?')
  await expect(page.getByText('Keyboard Shortcuts').first()).toBeVisible()
})

test('undo toast works in the new shell (registry shortcuts live)', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  // gotoEditor seeds graph mode (pins the GraphSheet over the stage) —
  // switch to Build so the stage receives the right-click.
  await page.getByTestId('mode-toggle-build').click()
  await expect(page.getByTestId('graph-sheet')).toBeHidden()
  const canvas = page.locator('canvas[data-engine]').first()
  // x=560: clear of the floating left rail (icon strip + 280px panel, Phase 2)
  // which now overlays the stage's left ~340px.
  await canvas.click({ button: 'right', position: { x: 560, y: 220 } })
  await page.getByRole('button', { name: 'Add Idle' }).click()
  await expect(page.getByText(/Idle added/).first()).toBeVisible({ timeout: 5000 })
  await page.keyboard.press('Control+z')
  await expect(page.getByText(/Undo: Add Idle/).first()).toBeVisible({ timeout: 5000 })
})
