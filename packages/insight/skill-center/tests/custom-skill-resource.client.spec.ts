/** Custom skill resource addresses and Host result propagation. */
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { customSkillAddress, customSkillResourceProvider } from '../src/client/custom-skill-resource.ts'
import type { InsightCustomSkillId } from '../src/shared/skill-inventory.ts'

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const frames: T[] = []
  for await (const frame of source) frames.push(frame)
  return frames
}

describe('custom skill resource', () => {
  it('reads the current Host snapshot from a stable retry address', async () => {
    const listCustom = vi.fn(async () => ({
      ok: true as const,
      value: { complete: true, entries: [{ id: brandString<InsightCustomSkillId>('opaque-id'), name: 'custom', description: 'Custom skill', origin: 'account' as const, removable: true }] },
    }))
    const frames = await collect(customSkillResourceProvider({ listCustom }).open(customSkillAddress(2), {
      signal: new AbortController().signal,
    }))

    expect(frames).toEqual([{ ok: true, value: { complete: true, entries: [{ id: 'opaque-id', name: 'custom', description: 'Custom skill', origin: 'account', removable: true }] } }])
    expect(listCustom).toHaveBeenCalledOnce()
  })

  it('discards a Host response after the client releases the resource', async () => {
    const controller = new AbortController()
    const listCustom = vi.fn(async () => {
      controller.abort()
      return { ok: true as const, value: { complete: true, entries: [] } }
    })
    const frames = await collect(customSkillResourceProvider({ listCustom }).open(customSkillAddress(0), {
      signal: controller.signal,
    }))

    expect(frames).toEqual([])
    expect(listCustom).toHaveBeenCalledWith(controller.signal)
  })

  it.each(['invalid-url', 'dsh-resource://insight-custom-skills/other'])('rejects %s before calling the Host', async (address) => {
    const listCustom = vi.fn()
    const frames = await collect(customSkillResourceProvider({ listCustom }).open(address, {
      signal: new AbortController().signal,
    }))

    expect(frames).toMatchObject([{ ok: false, error: { code: 'gateway/bad-request' } }])
    expect(listCustom).not.toHaveBeenCalled()
  })
})
