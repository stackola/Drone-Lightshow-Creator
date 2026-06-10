import { test, expect } from '@playwright/test'

// Locks in the new default: the app lands in the view-first "Build" mode (no
// node-graph dock), and the header Build|Graph toggle reveals the classic node
// editor on demand. This spec deliberately seeds 'build' mode (the production
// default), unlike _helpers.gotoEditor which pins 'graph' for the legacy suite.
async function gotoBuildMode(page: import('@playwright/test').Page) {
  await page.goto('about:blank')
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem('tutorial-dismissed', 'true')
      localStorage.setItem('tooltip-tour-dismissed', 'true')
      localStorage.setItem('drone-uimode-v1', JSON.stringify({ mode: 'build', viewId: 'iso', graphDockOpen: false }))
    } catch {
      /* ignore */
    }
  })
  await page.goto('/')
  const btn = page.getByRole('button', { name: 'Simple Linear', exact: false }).first()
  await btn.waitFor({ state: 'visible', timeout: 10000 })
  await btn.click()
  await page.locator('canvas[data-engine]').first().waitFor({ state: 'visible', timeout: 10000 })
}

test('lands in Build mode with the view switcher and no node graph', async ({ page }) => {
  await gotoBuildMode(page)
  await expect(page.getByTestId('view-switcher')).toBeVisible()
  // The node-graph dock is hidden in build mode.
  await expect(page.locator('.react-flow__node').first()).toBeHidden()
})

test('Graph toggle reveals the node editor; Build toggle hides it again', async ({ page }) => {
  await gotoBuildMode(page)
  await page.getByTestId('mode-toggle-graph').click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await page.getByTestId('mode-toggle-build').click()
  await expect(page.getByTestId('view-switcher')).toBeVisible()
})

test('right-click on the stage opens the context menu and adds a wired node', async ({ page }) => {
  await gotoBuildMode(page)
  const canvas = page.locator('canvas[data-engine]').first()
  await canvas.click({ button: 'right', position: { x: 560, y: 220 } })
  await expect(page.getByText('Add at playhead')).toBeVisible()
  await page.getByRole('button', { name: 'Add Idle' }).click()
  // The new node is auto-wired into the flow (Simple Linear's launch has a
  // free flow-out at t=0), so the toast reports the wiring.
  await expect(page.getByText(/Idle added/).first()).toBeVisible({ timeout: 5000 })
})

test('editor keyboard shortcuts are live in Build mode (Ctrl+Z undo toast)', async ({ page }) => {
  await gotoBuildMode(page)
  const canvas = page.locator('canvas[data-engine]').first()
  await canvas.click({ button: 'right', position: { x: 560, y: 220 } })
  await page.getByRole('button', { name: 'Add Idle' }).click()
  await expect(page.getByText(/Idle added/).first()).toBeVisible({ timeout: 5000 })
  await page.keyboard.press('Control+z')
  await expect(page.getByText(/Undo: Add Idle/).first()).toBeVisible({ timeout: 5000 })
})
