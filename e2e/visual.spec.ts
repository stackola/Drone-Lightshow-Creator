// ============================================================================
// Visual regression e2e — captures screenshots of major surfaces (2026-05-21).
// ============================================================================
// These tests don't assert exact pixels (a bake fluctuation or postprocessing
// jitter would make that brittle). They capture annotated PNGs into
// `e2e/__screenshots__/` so a future loop iteration can diff them or so a
// reviewer can eyeball them.
// ============================================================================

import { test } from '@playwright/test'
import { gotoEditor } from './_helpers'

test.describe('visual snapshots', () => {
  test('welcome screen', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: 'e2e/__screenshots__/welcome.png', fullPage: true })
  })

  test('blank editor', async ({ page }) => {
    await gotoEditor(page)
    // Let the viewport settle for one second so any startup animations finish.
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'e2e/__screenshots__/editor-blank.png', fullPage: true })
  })

  test('simple linear demo', async ({ page }) => {
    await gotoEditor(page, 'Simple Linear')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'e2e/__screenshots__/editor-linear.png', fullPage: true })
  })

  test('keyboard shortcuts overlay', async ({ page }) => {
    await gotoEditor(page)
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Shift+/')
    await page.waitForTimeout(300) // wait for fade-in
    await page.screenshot({ path: 'e2e/__screenshots__/shortcuts-overlay.png', fullPage: true })
  })

  test('export dialog', async ({ page }) => {
    await gotoEditor(page)
    await page.keyboard.press('Control+e')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'e2e/__screenshots__/export-dialog.png', fullPage: true })
  })

  test('command palette open', async ({ page }) => {
    await gotoEditor(page)
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'e2e/__screenshots__/command-palette.png', fullPage: true })
  })

  test('selected launch node — inspector hand-off', async ({ page }) => {
    await gotoEditor(page)
    const launchNode = page.locator('.react-flow__node').filter({ hasText: /launch/i }).first()
    await launchNode.waitFor({ state: 'visible', timeout: 10000 })
    await launchNode.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'e2e/__screenshots__/inspector-launch-selected.png', fullPage: true })
  })

  test('multi-select inspector', async ({ page }) => {
    await gotoEditor(page)
    // Click first, shift-click second.
    const nodes = page.locator('.react-flow__node')
    await nodes.first().click()
    await nodes.nth(1).click({ modifiers: ['Shift'] })
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'e2e/__screenshots__/inspector-multi-select.png', fullPage: true })
  })

  test('split/merge demo', async ({ page }) => {
    await gotoEditor(page, 'Split/Merge Starter')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'e2e/__screenshots__/editor-split-merge.png', fullPage: true })
  })
})
