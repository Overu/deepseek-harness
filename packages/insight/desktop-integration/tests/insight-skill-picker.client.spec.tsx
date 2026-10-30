// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { InputActions, InputState, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { InsightSkillPicker, type InsightSkillInventoryLoader } from '../src/client/InsightSkillPicker.tsx'
import type { InsightSkillInventorySnapshot } from '../src/shared/skill-inventory.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type PickerProps = ComponentProps<typeof InsightSkillPicker>

/** Build the complete public input state consumed by the Picker. */
function inputHook(selectedSkills: readonly string[] = [], phase: InputState['phase'] = 'plain'): PickerProps['useInput'] {
  const state: InputState = {
    draft: '',
    attachmentIds: [],
    draftRev: 0,
    phase,
    occurrences: [],
    selectedSkills,
    queue: [],
  }
  return selector => selector(state)
}

/** Build the complete stable input action face while exposing the selected action. */
function inputActions(toggleSkill = vi.fn()): InputActions {
  const span: TokenSpan = { start: 0, end: 0, draftRev: 0 }
  return {
    insertQuote: () => false,
    toggleSkill,
    captureInsertion: () => span,
    insertText: () => false,
    setDraft: () => {},
    persistDraft: () => {},
    addAttachments: () => false,
    removeAttachment: () => {},
    pruneAttachments: () => {},
    submit: () => {},
  }
}

function props(input: PickerProps['useInput'] = inputHook(), actions = inputActions(), loadInventory: InsightSkillInventoryLoader = async () => ({ complete: true, entries: [] })): PickerProps {
  return {
    sessionId: 'session-1' as PickerProps['sessionId'],
    useInput: input,
    inputActions: actions,
    loadInventory,
  }
}

describe('InsightSkillPicker', () => {
  it('uses the Shell source groups and installed display labels while toggling the native invocation name', async () => {
    const toggleSkill = vi.fn()
    render(<InsightSkillPicker {...props(inputHook(), inputActions(toggleSkill), async () => ({ complete: true, entries: [
      { name: 'creative', description: 'Long routing description', displayName: '创意专家', shortDescription: '生成品牌创意', origin: 'platform', availability: 'callable' },
      { name: 'personal', description: '账号自定义', origin: 'account', availability: 'callable' },
      { name: 'shared', description: '共享自定义', origin: 'shared', availability: 'callable' },
    ] }))} />)
    expect(screen.getByText('专家技能')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['平台预置', '用户自定义'])
    expect(await screen.findByRole('button', { name: '创意专家' })).toBeTruthy()
    expect(screen.getByText('生成品牌创意')).toBeTruthy()
    expect(screen.queryByText('Long routing description')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '搜索技能' }), { target: { value: '品牌' } })
    fireEvent.click(screen.getByRole('button', { name: '创意专家' }))
    expect(toggleSkill).toHaveBeenCalledWith('creative')
    fireEvent.change(screen.getByRole('combobox', { name: '搜索技能' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('tab', { name: '用户自定义' }))
    expect(screen.getByRole('button', { name: 'personal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'shared' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '选择技能' })).toBeNull()
  })

  it('shows categorized non-callable feedback, preserves search focus, and delegates an explicit token toggle', async () => {
    const toggleSkill = vi.fn()
    const loadInventory = vi.fn(async () => ({ complete: true, entries: [
      { name: 'tikhub', description: '内置检索', origin: 'platform' as const, availability: 'callable' as const },
      { name: 'old-search', description: '旧版本', origin: 'account' as const, availability: 'shadowed' as const },
    ] }))
    render(<InsightSkillPicker {...props(inputHook(), inputActions(toggleSkill), loadInventory)} />)
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    const search = await screen.findByRole('combobox', { name: '搜索技能' })
    expect(document.activeElement).toBe(search)
    expect(await screen.findByText('tikhub')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'tikhub' }))
    expect(toggleSkill).toHaveBeenCalledWith('tikhub')
    expect(document.activeElement).toBe(search)
    fireEvent.click(screen.getByRole('tab', { name: '用户自定义' }))
    expect(await screen.findByText('已被更高优先级版本覆盖')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'old-search' }).disabled).toBe(true)
  })

  it('closes on Session changes and only opens the new Session after an explicit click', async () => {
    const loadInventory = vi.fn(async (sessionId: string) => ({ complete: true, entries: [{
      name: sessionId === 'session-1' ? 'first-skill' : 'second-skill',
      description: '测试技能', origin: 'platform' as const, availability: 'callable' as const,
    }] }))
    const view = render(<InsightSkillPicker {...props(inputHook(), inputActions(), loadInventory)} />)
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    expect(await screen.findByText('first-skill')).toBeTruthy()

    view.rerender(<InsightSkillPicker {...props(inputHook(), inputActions(), loadInventory)} sessionId={'session-2' as PickerProps['sessionId']} />)
    expect(screen.queryByRole('dialog', { name: '选择技能' })).toBeNull()
    expect(loadInventory).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    expect(await screen.findByText('second-skill')).toBeTruthy()
    expect(screen.queryByText('first-skill')).toBeNull()

    view.rerender(<InsightSkillPicker {...props(inputHook(), inputActions(), loadInventory)} sessionId={'session-1' as PickerProps['sessionId']} />)
    expect(screen.queryByRole('dialog', { name: '选择技能' })).toBeNull()
  })

  it('does not show a previous Session’s directory failure after opening another Session', async () => {
    const loadInventory = vi.fn(async (sessionId: string): Promise<InsightSkillInventorySnapshot> => {
      if (sessionId === 'session-1') throw new Error('offline')
      return { complete: true, entries: [] }
    })
    const view = render(<InsightSkillPicker {...props(inputHook(), inputActions(), loadInventory)} />)
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    expect(await screen.findByText('无法读取技能目录，请稍后重试')).toBeTruthy()
    view.rerender(<InsightSkillPicker {...props(inputHook(), inputActions(), loadInventory)} sessionId={'session-2' as PickerProps['sessionId']} />)
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    expect(screen.queryByText('无法读取技能目录，请稍后重试')).toBeNull()
  })

  it('preserves the active entry across refreshes and releases refresh resources after phase locks the input', async () => {
    vi.useFakeTimers()
    const toggleSkill = vi.fn()
    const signals: AbortSignal[] = []
    const snapshots: readonly InsightSkillInventorySnapshot[] = [{ complete: true, entries: [
      { name: 'first', description: '一', origin: 'platform', availability: 'callable' },
      { name: 'second', description: '二', origin: 'platform', availability: 'callable' },
    ] }, { complete: true, entries: [
      { name: 'second', description: '更新后二', origin: 'platform', availability: 'callable' },
      { name: 'first', description: '更新后一', origin: 'platform', availability: 'callable' },
    ] }]
    const loadInventory = vi.fn<InsightSkillInventoryLoader>(async (_sessionId, signal) => {
      signals.push(signal)
      return snapshots[Math.min(signals.length - 1, snapshots.length - 1)] ?? { complete: true, entries: [] }
    })
    const initial = props(inputHook(), inputActions(toggleSkill), loadInventory)
    const view = render(<InsightSkillPicker {...initial} />)
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    expect(screen.getByText('正在读取技能目录')).toBeTruthy()
    await vi.advanceTimersByTimeAsync(0)
    const search = screen.getByRole('combobox', { name: '搜索技能' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    const secondBeforeRefresh = screen.getByRole('option', { name: /second/ })
    expect(search.getAttribute('aria-activedescendant')).toBe(secondBeforeRefresh.id)
    expect(secondBeforeRefresh.dataset.active).toBe('true')

    await vi.advanceTimersByTimeAsync(2000)
    const secondAfterRefresh = screen.getByRole('option', { name: /second/ })
    expect(search.getAttribute('aria-activedescendant')).toBe(secondAfterRefresh.id)
    expect(secondAfterRefresh.dataset.active).toBe('true')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(toggleSkill).toHaveBeenCalledWith('second')

    view.rerender(<InsightSkillPicker {...props(inputHook([], 'sending'), inputActions(toggleSkill), loadInventory)} />)
    expect(screen.queryByRole('dialog', { name: '选择技能' })).toBeNull()
    expect(signals[1]?.aborted).toBe(true)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(4000)
    expect(loadInventory).toHaveBeenCalledTimes(2)
  })

  it('moves a visible active option with the legacy search and source-tab keys', async () => {
    const toggleSkill = vi.fn()
    render(<InsightSkillPicker {...props(inputHook(), inputActions(toggleSkill), async () => ({ complete: true, entries: [
      { name: 'first', description: '一', origin: 'platform', availability: 'callable' },
      { name: 'second', description: '二', origin: 'platform', availability: 'callable' },
    ] }))} />)
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    const search = await screen.findByRole('combobox', { name: '搜索技能' })
    const first = await screen.findByRole('option', { name: /first/ })
    expect(search.getAttribute('aria-activedescendant')).toBe(first.id)
    expect(first.dataset.active).toBe('true')
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    const second = screen.getByRole('option', { name: /second/ })
    expect(search.getAttribute('aria-activedescendant')).toBe(second.id)
    fireEvent.keyDown(await screen.findByRole('combobox', { name: '搜索技能' }), { key: 'Enter' })
    expect(toggleSkill).toHaveBeenCalledWith('second')

    const account = screen.getByRole('tab', { name: '用户自定义' })
    account.focus()
    fireEvent.keyDown(account, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '用户自定义' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: '用户自定义' }), { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '平台预置' }))
  })

  it('selects the cached first callable entry after reopening', async () => {
    const toggleSkill = vi.fn()
    render(<InsightSkillPicker {...props(inputHook(), inputActions(toggleSkill), async () => ({ complete: true, entries: [{
      name: 'tikhub', description: '检索', origin: 'platform', availability: 'callable',
    }] }))} />)
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    await screen.findByRole('combobox', { name: '搜索技能' })
    expect(await screen.findByText('tikhub')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    fireEvent.keyDown(await screen.findByRole('combobox', { name: '搜索技能' }), { key: 'Enter' })
    expect(toggleSkill).toHaveBeenCalledWith('tikhub')
  })

  it('uses the projection-derived selected list rather than parsing or rewriting the draft', async () => {
    const toggleSkill = vi.fn()
    render(<InsightSkillPicker {...props(inputHook(['tikhub']), inputActions(toggleSkill), async () => ({ complete: true, entries: [{
      name: 'tikhub', description: '检索', origin: 'platform', availability: 'callable',
    }, {
      name: 'tikhub', description: '旧版本', origin: 'account', availability: 'shadowed',
    }] }))} />)
    fireEvent.click(screen.getByRole('button', { name: '技能 (1)' }))
    const platformOption = await screen.findByRole('option', { name: /tikhub/ })
    fireEvent.click(await screen.findByRole('button', { name: '✓ tikhub' }))
    expect(toggleSkill).toHaveBeenCalledWith('tikhub')
    fireEvent.click(screen.getByRole('tab', { name: '用户自定义' }))
    expect(screen.queryByRole('button', { name: '✓ tikhub' })).toBeNull()
    expect(screen.getByRole('option', { name: /tikhub/ }).id).not.toBe(platformOption.id)
  })

  it('retains a failed current directory as unconfirmed and keeps it unselectable', async () => {
    const successful = vi.fn(async (): Promise<InsightSkillInventorySnapshot> => ({ complete: true, entries: [{
      name: 'tikhub', description: '检索', origin: 'platform', availability: 'callable',
    }] }))
    const initial = props(inputHook(), inputActions(), successful)
    const view = render(<InsightSkillPicker {...initial} />)
    fireEvent.click(screen.getByRole('button', { name: '技能' }))
    expect(await screen.findByText('tikhub')).toBeTruthy()

    const failed = vi.fn(async () => { throw new Error('offline') })
    view.rerender(<InsightSkillPicker {...props(inputHook(), inputActions(), failed)} />)
    expect(await screen.findByText('无法读取技能目录，请稍后重试')).toBeTruthy()
    expect(screen.getByText('技能目录正在更新')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'tikhub' }).disabled).toBe(true)
  })
})
