// @vitest-environment jsdom
/** Insight occupies both the sidebar and blank-session product-brand seats. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { InsightBrandMark } from '../src/client/Brand.tsx'

const holes = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.fiber.dispose())) })

async function bench(declare = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(holes.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  return { ctx, slots, declareHoles, disposeHoles: declare ? declareHoles() : undefined }
}

describe('Insight client brand slots', () => {
  it('fills the hero mark across declaration changes and removes it on teardown', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(subject.slots.entries('conversation.hero.brand.mark').map(entry => entry.component)).toEqual([InsightBrandMark])
    subject.disposeHoles?.()
    expect(subject.slots.entries('conversation.hero.brand.mark')).toHaveLength(0)
    subject.declareHoles()
    await Promise.resolve()
    expect(subject.slots.entries('conversation.hero.brand.mark')).toHaveLength(1)
    await fiber.dispose()
    expect(subject.slots.entries('conversation.hero.brand.mark')).toHaveLength(0)
  })

  it('preserves hero geometry supplied by the conversation owner', () => {
    const view = render(<InsightBrandMark size={34} className="hero-mark" />)
    const mark = view.container.firstElementChild as HTMLElement
    expect(mark.classList).toContain('hero-mark')
    expect(mark.style.width).toBe('34px')
    expect(mark.style.height).toBe('34px')
  })
})
