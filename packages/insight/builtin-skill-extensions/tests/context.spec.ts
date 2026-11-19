import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import Tools from '@deepseek-ai/dsh-tools'
import { expect, it } from 'vitest'
import * as BuiltinSkillExtensions from '../src/index.ts'

const config = {
  pdfMaxInputBytes: 67_108_864,
  pdfMaxPagesPerCall: 100,
  pdfMaxOutputBytes: 98_304,
  pptxRetryMaxInputBytes: 167_772_160,
  pptxRenderTimeoutMs: 120_000,
  pptxRenderGraceMs: 1000,
}

it('registers Office tools and guidance until the plugin unloads', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    await ctx.plugin(NativeExecutor)
    const plugin = await ctx.plugin({
      inject: ['systemPrompt', 'tools'],
      apply: scope => BuiltinSkillExtensions.apply(scope, config),
    })

    const { contexts } = await ctx.systemPrompt.assemble()
    const guidance = contexts.find(context => context.name === BuiltinSkillExtensions.name)?.text
    expect(guidance).toContain('Cite the original PDF page numbers')
    expect(guidance).toContain('visual inspection was not completed')
    expect(ctx.tools.get('pdf_extract_text')).toBeDefined()
    expect(ctx.tools.get('office_render_pptx')).toBeDefined()

    await plugin.dispose()
    expect((await ctx.systemPrompt.assemble()).contexts.some(context => context.name === BuiltinSkillExtensions.name)).toBe(false)
    expect(ctx.tools.get('pdf_extract_text')).toBeUndefined()
    expect(ctx.tools.get('office_render_pptx')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
  }
})

it.each([0, 1.5, 167_772_161])('rejects a PPTX retry limit of %s bytes', (pptxRetryMaxInputBytes) => {
  expect(() => BuiltinSkillExtensions.Config({ ...config, pptxRetryMaxInputBytes })).toThrow()
})
