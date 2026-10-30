import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, effectiveSystemPrompt, resolveConfig, type Config } from '../src/config'
import { DEFAULT_SYSTEM_PROMPT } from '../src/prompts'

function config(overrides: Partial<Config> = {}): Config {
  return Object.assign({}, DEFAULT_CONFIG, overrides)
}

describe('resolveConfig', () => {
  it('drops legacy model overrides from a stored section', () => {
    const legacy = Object.assign(config(), { provider: 'zhipu', model: 'glm-5.3' })
    expect(resolveConfig(legacy)).not.toHaveProperty('provider')
    expect(resolveConfig(legacy)).not.toHaveProperty('model')
  })
  it('validates primitive and bounded fields', () => {
    expect(() => resolveConfig(config({ temperature: Number.NaN }))).toThrow(/temperature/)
    expect(() => resolveConfig(config({ maxInputChars: 4096.9 }))).toThrow(/maxInputChars/)
    expect(() => resolveConfig(config({ timeoutMs: -1 }))).toThrow(/timeoutMs/)
    expect(() => resolveConfig(config({ enabled: 'yes' as never }))).toThrow(/enabled/)
  })
  it('defaults and validates strategy mode', () => {
    expect(resolveConfig(config()).strategyMode).toBe('replace-default')
    expect(resolveConfig(config({ strategyMode: 'bogus' as never })).strategyMode).toBe('replace-default')
    expect(resolveConfig(config({ strategyMode: 'extend-default' })).strategyMode).toBe('extend-default')
  })
  it('strips unknown legacy fields', () => {
    const legacy = Object.assign(config(), { legacySetting: 'old-value' })
    expect(resolveConfig(legacy)).not.toHaveProperty('legacySetting')
  })
  it('uses documented streaming and context defaults', () => {
    const resolved = resolveConfig(config())
    expect(resolved).toMatchObject({ streaming: true, contextAware: true, contextMaxMessages: 8, contextMaxChars: 4000 })
  })
  it('tolerates older sections without streaming flags', () => {
    const partial = Object.assign({}, config()) as Partial<Config>
    delete partial.streaming
    delete partial.contextAware
    expect(resolveConfig(partial as Config)).toMatchObject({ streaming: true, contextAware: true })
  })
  it('accepts zero context and rejects out-of-range context', () => {
    const resolved = resolveConfig(config({ contextMaxMessages: 0, contextMaxChars: 0 }))
    expect(resolved).toMatchObject({ contextMaxMessages: 0, contextMaxChars: 0 })
    expect(() => resolveConfig(config({ contextMaxMessages: 99 }))).toThrow(/contextMaxMessages/)
    expect(() => resolveConfig(config({ contextMaxChars: -1 }))).toThrow(/contextMaxChars/)
  })
})

describe('effectiveSystemPrompt', () => {
  it('uses the built-in strategy when blank', () => {
    expect(effectiveSystemPrompt(config({ systemPrompt: '' }), DEFAULT_SYSTEM_PROMPT)).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(effectiveSystemPrompt(config({ systemPrompt: '  \n' }), DEFAULT_SYSTEM_PROMPT)).toBe(DEFAULT_SYSTEM_PROMPT)
  })
  it('uses replace and extend modes', () => {
    expect(effectiveSystemPrompt(config({ systemPrompt: 'You are terse.' }), DEFAULT_SYSTEM_PROMPT)).toBe('You are terse.')
    expect(effectiveSystemPrompt(config({ systemPrompt: 'Bullets.', strategyMode: 'extend-default' }), DEFAULT_SYSTEM_PROMPT)).toContain('Bullets.')
  })
})
