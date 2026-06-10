// ============================================================================
// Tests: AI SVG Formation Generator — sanitizer + tool param validation
// ============================================================================
// The actual rasterization path uses Canvas 2D + Image (browser-only), so we
// can only smoke-test the canvas-dependent paths here; the validation paths
// that run before the canvas call are fully tested.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { executeToolAsync } from './aiToolEngine'
import './aiWriteTools' // side-effect: registers all tools including the SVG generator
import { sanitizeSvg, getCachedRaster } from './aiSvgFormationGenerator'
import { useFormationStore } from '../stores/formationStore'
import { initRegistries } from '../registries/init'

initRegistries()

function reset() {
  useFormationStore.getState().loadFormations([], new Map())
}

describe('sanitizeSvg', () => {
  it('strips markdown code fences', () => {
    const wrapped = '```svg\n<svg viewBox="0 0 100 100"><rect/></svg>\n```'
    const cleaned = sanitizeSvg(wrapped)
    expect(cleaned.startsWith('<svg')).toBe(true)
    expect(cleaned.endsWith('</svg>')).toBe(true)
    expect(cleaned).not.toContain('```')
  })

  it('extracts the <svg> block when prose surrounds it', () => {
    const noisy = 'Sure! Here is the SVG: <svg viewBox="0 0 10 10"><circle r="5"/></svg> Hope this helps!'
    expect(sanitizeSvg(noisy)).toBe('<svg viewBox="0 0 10 10"><circle r="5"/></svg>')
  })

  it('removes <script> tags', () => {
    const malicious = '<svg><script>alert(1)</script><rect/></svg>'
    expect(sanitizeSvg(malicious)).not.toContain('<script')
    expect(sanitizeSvg(malicious)).not.toContain('alert')
  })

  it('removes inline event handlers', () => {
    const malicious = '<svg><rect onclick="boom()" onload="hack()"/></svg>'
    const cleaned = sanitizeSvg(malicious)
    expect(cleaned).not.toContain('onclick')
    expect(cleaned).not.toContain('onload')
  })

  it('removes external xlink:href URLs', () => {
    const malicious = '<svg><use xlink:href="http://evil.com/x.svg"/></svg>'
    expect(sanitizeSvg(malicious)).not.toContain('http://evil.com')
  })

  it('leaves a clean SVG untouched (modulo trim)', () => {
    const clean = '<svg viewBox="0 0 512 512"><path d="M0 0L100 100Z" fill="black"/></svg>'
    expect(sanitizeSvg(clean)).toBe(clean)
  })
})

describe('create_formation_from_svg tool', () => {
  beforeEach(reset)

  it('rejects missing svg parameter at validation level', async () => {
    const r = await executeToolAsync('create_formation_from_svg', {
      name: 'Test',
      concept: 'test',
      droneCount: 50,
      // svg omitted
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/svg/i)
  })

  it('rejects a non-positive droneCount', async () => {
    const r = await executeToolAsync('create_formation_from_svg', {
      name: 'Test',
      concept: 'test',
      svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="black"/></svg>',
      droneCount: 0,
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/droneCount/)
  })

  it('rejects input that contains no <svg> element after sanitation', async () => {
    const r = await executeToolAsync('create_formation_from_svg', {
      name: 'Test',
      concept: 'test',
      svg: 'just some prose, no svg here',
      droneCount: 50,
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/svg/i)
  })

  it('rasterization fails gracefully without a DOM (node env)', async () => {
    // In node there is no document/Image, so svgStringToFormation throws.
    // The tool should surface this as a clean error rather than crash.
    const r = await executeToolAsync('create_formation_from_svg', {
      name: 'Eiffel',
      concept: 'eiffel tower',
      svg: '<svg viewBox="0 0 100 100"><polygon points="50,0 100,100 0,100" fill="black"/></svg>',
      droneCount: 40,
    })
    expect(r.success).toBe(false)
    // Either rasterization error OR document-not-defined — both acceptable here.
    expect(r.error).toBeTruthy()
  })
})

describe('critique_formation tool', () => {
  beforeEach(reset)

  it('errors cleanly when no raster is cached for the formationId', async () => {
    const r = await executeToolAsync('critique_formation', { formationId: 'nonexistent-id' })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/no svg raster cached/i)
  })

  it('only critiques formations created via create_formation_from_svg', () => {
    // Sanity: a formation created another way is not in the raster cache.
    const id = useFormationStore.getState().addFormation('Plain Ring', 'ring', { count: 30, radius: 8 })
    expect(getCachedRaster(id)).toBeUndefined()
  })
})
