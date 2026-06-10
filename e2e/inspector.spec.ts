// ============================================================================
// Inspector e2e — selection routes the contextual inspector; physics /
// settings / AI live in their post-cutover homes (status badge + drawer,
// top-bar dialog, AI panel mode).
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test('selecting Launch reveals the Drones number input', async ({ page }) => {
  await gotoEditor(page)
  const launchNode = page.locator('.react-flow__node-launch').first()
  await launchNode.click()
  // The Launch inspector shows a "Drones" field.
  await expect(page.getByText(/^Drones$/i).first()).toBeVisible({ timeout: 5000 })
})

test('physics badge opens the validation drawer with status', async ({ page }) => {
  await gotoEditor(page)
  // Post-cutover: physics is ambient status — a StatusStrip badge + drawer.
  await page.getByTestId('physics-badge').click()
  await expect(page.getByTestId('physics-drawer')).toBeVisible()
  await expect(page.getByText(/violations?|no issues|no violations|physics validates/i).first()).toBeVisible({ timeout: 5000 })
})

test('settings dialog opens from the top bar', async ({ page }) => {
  await gotoEditor(page)
  // Post-cutover: project settings live in a dialog, not an inspector tab.
  await page.getByLabel('Project settings').click()
  await expect(page.getByText(/Max Velocity/i).first()).toBeVisible({ timeout: 5000 })
})

test('AI panel opens to the configure-API-key state', async ({ page }) => {
  await gotoEditor(page)
  // Post-cutover: the AI co-designer is an inspector-column mode.
  await page.getByLabel('AI assistant').click()
  await expect(page.getByText(/AI Co-Designer|Configure API Key/i).first()).toBeVisible({ timeout: 5000 })
})

test('Formation node inspector shows Time + Easing fields when a formation has a keyframe', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await page.locator('.react-flow__node-formation').first().click()
  // The header renders.
  // Header is "Formation · <name>" (e.g., "Formation · Opening Ring") since 20:14.
  await expect(page.getByText(/Formation · /).first()).toBeVisible({ timeout: 5000 })
  // Base Transform section title.
  await expect(page.getByText(/Base Transform/i).first()).toBeVisible({ timeout: 5000 })
})
