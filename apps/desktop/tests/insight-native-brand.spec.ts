import { describe, expect, it } from 'vitest'
import { insightNativeLocale, insightWindowTitle } from '../src/insight-native-brand.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

describe('Insight native branding', () => {
  it('keeps root pages and conversation names under the Insight product name', () => {
    expect(insightWindowTitle('DSH 本地构建', '因赛AI')).toBe('因赛AI')
    expect(insightWindowTitle('方案 — DSH 本地构建', '因赛AI')).toBe('方案 — 因赛AI')
    expect(insightWindowTitle('A — B — DeepSeek Harness', '因赛AI')).toBe('A — B — 因赛AI')
  })
  it('does not mutate the official native dictionary', () => {
    const official = resolveDesktopLocale('zh-CN')
    const branded = insightNativeLocale(official, '因赛AI')
    expect(branded.messages.aboutProduct).toBe('因赛AI')
    expect(official.messages.aboutProduct).toBe('DeepSeek Harness')
  })
})
