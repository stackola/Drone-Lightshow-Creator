// ============================================================================
// Shell Phase 3 — contextual inspector, physics drawer, settings dialog,
// AI panel mode.
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test('selecting a graph node routes the floating inspector to it', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  // Graph mode is seeded — the sheet is pinned over the stage.
  await expect(page.getByTestId('graph-sheet')).toBeVisible()
  await page.locator('.react-flow__node-launch').first().click()
  // The floating inspector card routes to the Launch inspector.
  const inspector = page.getByTestId('inspector-card')
  await expect(inspector).toBeVisible()
  await expect(inspector.getByText(/^Drones$/i).first()).toBeVisible({ timeout: 5000 })
})

test('physics badge opens the validation drawer', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  const badge = page.getByTestId('physics-badge')
  await expect(badge).toBeVisible()
  await badge.click()
  await expect(page.getByTestId('physics-drawer')).toBeVisible()
  await page.getByLabel('Close physics drawer').click()
  await expect(page.getByTestId('physics-drawer')).toBeHidden()
})

test('settings dialog opens from the top bar', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await page.getByLabel('Project settings').click()
  await expect(page.getByText('Project settings').first()).toBeVisible()
  await expect(page.getByText('Drone Pool').first()).toBeVisible()
  await page.keyboard.press('Escape')
})

test('AI panel mode swaps the inspector column and yields to selection', async ({ page }) => {
  await gotoEditor(page, 'Simple Linear')
  await page.getByLabel('AI assistant').click()
  const inspector = page.getByTestId('inspector-card')
  await expect(page.getByLabel('Close AI panel')).toBeVisible()
  // Selecting a node swaps back to the inspector.
  await page.locator('.react-flow__node-launch').first().click()
  await expect(page.getByLabel('Close AI panel')).toBeHidden()
})
