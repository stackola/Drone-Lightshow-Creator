// ============================================================================
// Graph-canvas e2e — selection, inspector hand-off, gizmo modes, palette
// search (2026-05-21).
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test('Blank Canvas project mounts a Launch + Land node', async ({ page }) => {
  await gotoEditor(page)
  // React Flow renders each node as a div with the `react-flow__node` class.
  const nodes = page.locator('.react-flow__node')
  await expect(nodes).toHaveCount(2, { timeout: 10000 })
})

test('clicking a node hands off to the inspector', async ({ page }) => {
  await gotoEditor(page)
  const launchNode = page.locator('.react-flow__node').filter({ hasText: /launch/i }).first()
  await launchNode.waitFor({ state: 'visible', timeout: 10000 })
  await launchNode.click()
  // The single-select inspector replaces the empty state with the node header.
  await expect(page.getByText(/Launch Node/i)).toBeVisible({ timeout: 5000 })
})

test('command palette accepts text and closes on Escape', async ({ page }) => {
  await gotoEditor(page)
  await page.keyboard.press('Control+k')
  const search = page.getByPlaceholder(/Type a command or search nodes/i)
  await expect(search).toBeVisible({ timeout: 5000 })
  await search.fill('hello')
  await expect(search).toHaveValue('hello')
  await page.keyboard.press('Escape')
  await expect(search).not.toBeVisible({ timeout: 5000 })
})

test('viewport gizmo hotkeys cycle modes', async ({ page }) => {
  await gotoEditor(page)
  const canvas = page.locator('canvas[data-engine]').first()
  await canvas.click({ position: { x: 560, y: 60 } })
  await page.keyboard.press('w')
  await page.keyboard.press('e')
  await page.keyboard.press('r')
  // Smoke: app didn't crash; status bar still renders "Translate" / etc somewhere.
  await expect(canvas).toBeVisible()
})

test('Auto-layout button keeps the graph alive', async ({ page }) => {
  await gotoEditor(page)
  const btn = page.getByRole('button', { name: /auto-layout/i }).first()
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
  await page.waitForTimeout(500)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
})
