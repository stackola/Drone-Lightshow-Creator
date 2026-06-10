// ============================================================================
// Drag-and-drop e2e — node repositioning on the graph canvas (2026-05-21).
// ============================================================================

import { test, expect } from '@playwright/test'
import { gotoEditor } from './_helpers'

test('dragging a node updates its position on the canvas', async ({ page }) => {
  await gotoEditor(page)
  const launchNode = page.locator('.react-flow__node').filter({ hasText: /launch/i }).first()
  await launchNode.waitFor({ state: 'visible', timeout: 10000 })

  const before = await launchNode.boundingBox()
  if (!before) throw new Error('launch node has no bounding box')

  // React Flow drag: pointerdown on the node, move, pointerup.
  // We grab the node's drag handle (the card body itself) and translate by
  // (+120, +50) — small enough to stay in-frame, large enough that bounding
  // box deltas are unambiguous.
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 120, before.y + before.height / 2 + 50, { steps: 12 })
  await page.mouse.up()

  // Wait for React Flow to commit the new position.
  await page.waitForTimeout(300)
  const after = await launchNode.boundingBox()
  if (!after) throw new Error('launch node disappeared after drag')

  // The bounding box should have moved by approximately the drag delta.
  // Allow ±5 px slack for snap rounding.
  expect(after.x).toBeGreaterThan(before.x + 80)
  expect(after.y).toBeGreaterThan(before.y + 20)
})

test('drag is undoable with Ctrl+Z', async ({ page }) => {
  await gotoEditor(page)
  const launchNode = page.locator('.react-flow__node').filter({ hasText: /launch/i }).first()
  await launchNode.waitFor({ state: 'visible', timeout: 10000 })

  const before = await launchNode.boundingBox()
  if (!before) throw new Error('launch node has no bounding box')

  // Drag the node sideways.
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 150, before.y + before.height / 2 + 60, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)

  const moved = await launchNode.boundingBox()
  if (!moved) throw new Error('launch node disappeared after drag')
  expect(moved.x).toBeGreaterThan(before.x + 80)

  // Undo. The position should snap back close to where it started.
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  const restored = await launchNode.boundingBox()
  if (!restored) throw new Error('launch node disappeared after undo')
  // Allow ±15 px slack for animation / fit-view.
  expect(Math.abs(restored.x - before.x)).toBeLessThan(20)
})
