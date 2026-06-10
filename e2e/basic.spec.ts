// ============================================================================
// Basic e2e smoke tests — load + global keyboard shortcuts (2026-05-21).
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test('app loads and shows welcome screen', async ({ page }) => {
  await page.goto('/')
  // Welcome screen renders a "Blank Canvas" tile and we can read its text.
  await expect(page.getByText('Blank Canvas')).toBeVisible({ timeout: 10000 })
})

test('blank project loads into editor and renders the 3D viewport', async ({ page }) => {
  await gotoEditor(page)
  await expect(page.locator('canvas[data-engine]').first()).toBeVisible()
})

test('Ctrl+E opens the Export dialog', async ({ page }) => {
  await gotoEditor(page)
  await page.keyboard.press('Control+e')
  await expect(page.getByText('Export Show')).toBeVisible({ timeout: 5000 })
})

test('? opens the keyboard shortcuts overlay', async ({ page }) => {
  await gotoEditor(page)
  // Click somewhere neutral first so the focus isn't sitting on a button that
  // swallows the next key event; then press the literal `?` character.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+/')
  await expect(page.getByText('Keyboard Shortcuts')).toBeVisible({ timeout: 5000 })
})

test('Ctrl+K opens the command palette', async ({ page }) => {
  await gotoEditor(page)
  await page.keyboard.press('Control+k')
  await expect(page.getByPlaceholder(/Type a command or search nodes/i)).toBeVisible({ timeout: 5000 })
})
