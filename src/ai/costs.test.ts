import { beforeEach, describe, expect, it } from 'vitest'
import { formatUsd, recordClaude, recordImage, spentSince, typicalCost, useCosts } from './costs'

describe('AI cost tracker', () => {
  beforeEach(() => { useCosts.getState().reset(); useCosts.getState().setClaudePrice('claude-opus-5-5', null) })

  it('prices Claude calls by the model that answered, cache reads and writes included', () => {
    recordClaude('claude-opus-5-5', { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 4_000 }, 'Look & fix (picture)')
    // 10k × $4 + 2k × $20 + 50k × $0.20 + 4k × $5, per million
    const e = useCosts.getState().entries[0]!
    expect(e.usd).toBeCloseTo(0.04 + 0.04 + 0.01 + 0.02, 10)
    // A refusal fallback answered by another model is priced at that model's rates.
    recordClaude('claude-opus-4-8', { input_tokens: 1_000_000, output_tokens: 0 }, 'Copilot')
    expect(useCosts.getState().entries[1]!.usd).toBeCloseTo(5, 10)
  })

  it('prices a picture from the usage OpenAI returns (a square medium gpt-image-2 picture ≈ $0.053)', () => {
    recordImage('gpt-image-2', { input_tokens: 105, output_tokens: 1756, input_tokens_details: { text_tokens: 105, image_tokens: 0 } }, 'Picture')
    expect(useCosts.getState().entries[0]!.usd).toBeCloseTo((105 * 5 + 1756 * 30) / 1e6, 10)
    expect(formatUsd(useCosts.getState().total)).toBe('$0.05')
  })

  it('keeps totals, lets prices be overridden, and estimates from recent calls', () => {
    useCosts.getState().setClaudePrice('claude-opus-5-5', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })
    recordClaude('claude-opus-5-5', { input_tokens: 500_000, output_tokens: 500_000 }, 'Picture description')
    recordClaude('claude-opus-5-5', { input_tokens: 0, output_tokens: 20_000 }, 'Picture description')
    expect(useCosts.getState().total).toBeCloseTo(1.02, 10)
    expect(spentSince(useCosts.getState().entries, 0)).toBeCloseTo(1.02, 10)
    expect(typicalCost(useCosts.getState().entries, 'Picture description', 9)).toBeCloseTo(1, 10)
    expect(typicalCost(useCosts.getState().entries, 'Never ran', 0.03)).toBe(0.03)
    expect(formatUsd(0.0042)).toBe('$0.004')
  })
})
