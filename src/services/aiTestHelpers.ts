// ============================================================================
// AI Test Helpers — gating for tests that hit live AI APIs
// ============================================================================
// Any test that performs a real network call to api.anthropic.com (or any
// other LLM provider) MUST be wrapped in `describeApi` / `itApi`. Without
// gating, CI would either burn credits on every run or fail when there is
// no API key configured.
//
// Enable live-API tests with:
//   RUN_AI_API_TESTS=1 ANTHROPIC_API_KEY=sk-... pnpm test
//
// When the flag is unset, gated suites are skipped (still reported, not run).
// ============================================================================

import { describe, it } from 'vitest'

const FLAG = 'RUN_AI_API_TESTS'

function isEnabled(): boolean {
  const v = (typeof process !== 'undefined' && process.env && process.env[FLAG]) || ''
  return v === '1' || v.toLowerCase() === 'true'
}

/**
 * Use in place of `describe` for any suite whose tests call a real AI API.
 * Skipped unless RUN_AI_API_TESTS=1 is set in the environment.
 */
export const describeApi: typeof describe = (isEnabled() ? describe : describe.skip) as typeof describe

/**
 * Use in place of `it` for an individual test that calls a real AI API.
 * Skipped unless RUN_AI_API_TESTS=1 is set in the environment.
 */
export const itApi: typeof it = (isEnabled() ? it : it.skip) as typeof it

/** Programmatic check, for setup code that should not run without the flag. */
export const aiApiTestsEnabled = isEnabled
