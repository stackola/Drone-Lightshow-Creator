// ============================================================================
// Shared Playwright helpers (2026-05-21).
// ============================================================================
// The app gates on the WelcomeScreen modal — every realistic test starts by
// picking a project shape first. `gotoEditor` collapses that boilerplate
// into one call so each spec can focus on what it's actually exercising.
// ============================================================================

import type { Page } from '@playwright/test'

/** Navigate to '/', dismiss the welcome modal by picking the named template,
 *  then wait for the main 3D viewport's canvas element to mount.
 *
 *  Side-effect: pre-seeds localStorage so the tutorial overlay + tooltip tour
 *  don't fire on fresh browser contexts (they normally do, and they intercept
 *  pointer events for the entire screen).
 */
export async function gotoEditor(
  page: Page,
  template: 'Blank Canvas' | 'Simple Linear' | 'Split/Merge Starter' = 'Blank Canvas',
): Promise<void> {
  // Hop to about:blank first so we have a document to set localStorage on,
  // then seed the keys, then go to '/'. This is the standard Playwright
  // pattern for dismissing first-run overlays before the app sees them.
  await page.goto('about:blank')
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem('tutorial-dismissed', 'true')
      localStorage.setItem('tooltip-tour-dismissed', 'true')
      // Default landing mode is 'build'. Most specs assert against the node
      // graph, so pin 'graph' mode (= GraphSheet pinned open over the stage).
      // Build-mode behaviour is covered by buildmode.spec.ts, which seeds
      // its own mode.
      localStorage.setItem('drone-uimode-v1', JSON.stringify({ mode: 'graph', viewId: 'iso', graphDockOpen: false }))
    } catch {
      /* localStorage might be blocked in some contexts; ignore */
    }
  })
  await page.goto('/')
  const btn = page.getByRole('button', { name: template, exact: false }).first()
  await btn.waitFor({ state: 'visible', timeout: 10000 })
  await btn.click()
  // The 3D viewport mounts a <canvas data-engine="..."> as soon as it's
  // visible. Wait for it (10s) so subsequent interactions don't race the
  // initial bake/eval.
  await page.locator('canvas[data-engine]').first().waitFor({ state: 'visible', timeout: 10000 })
}
