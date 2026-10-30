// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DraftAttachmentId, SubmitOutcome } from '../src/client/contract/input.ts'
import type { ReferenceInsert } from '../src/client/contract/draft-editor.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'

function shell(sink: () => Promise<SubmitOutcome> = async () => ({ kind: 'success' })): SessionInputShell {
  return new SessionInputShell({
    actx: {} as Context,
    defaultSink: () => sink(),
    commandAttachments: {
      serialize: () => Promise.resolve([]),
      release: () => {},
      unsupportedNotice: () => 'unsupported',
    },
  })
}

function reference(): ReferenceInsert {
  return { source: 'fixture', ref: 'one', label: '@one', clipboardText: '@one' }
}

describe('explicit skill input actions', () => {
  it('adds and removes visible complete tokens without treating paths or near names as selections', () => {
    const input = shell()
    input.setDraft('/tikhub /tikhub /usr/bin /tikhubx')

    input.actions.toggleSkill('tikhub')

    expect(input.snapshot.draft).toBe('  /usr/bin /tikhubx')
    expect(input.snapshot.selectedSkills).toEqual(['tikhubx'])
    input.actions.toggleSkill('prompt-enhance')
    expect(input.snapshot.draft).toBe('  /usr/bin /tikhubx /prompt-enhance ')
    expect(input.snapshot.selectedSkills).toEqual(['tikhubx', 'prompt-enhance'])
    input.actions.toggleSkill('Bad_Name')
    expect(input.snapshot.selectedSkills).toEqual(['tikhubx', 'prompt-enhance'])
  })

  it('derives selection from ordinary text while retaining references and quotes', () => {
    const input = shell()
    input.setDraft('before ')
    expect(input.addAttachments(['attachment-1' as DraftAttachmentId])).toBe(true)
    expect(input.insertReference(reference(), { start: 7, end: 7, draftRev: input.snapshot.draftRev })).toBe(true)
    expect(input.insertQuote('quoted /tikhub')).toBe(true)

    input.actions.toggleSkill('tikhub')

    expect(input.snapshot.selectedSkills).toEqual(['tikhub'])
    expect(input.draftSnapshot.references).toHaveLength(1)
    expect(input.draftSnapshot.quotes).toEqual([{ offset: 12, length: 16, text: 'quoted /tikhub' }])
    input.actions.toggleSkill('tikhub')
    expect(input.snapshot.selectedSkills).toEqual([])
    expect(input.draftSnapshot.references).toHaveLength(1)
    expect(input.draftSnapshot.quotes).toHaveLength(1)
    expect(input.snapshot.attachmentIds).toEqual(['attachment-1'])
  })

  it('uses each session live editor and does not replace intervening typing', () => {
    const first = shell()
    const second = shell()
    first.setDraft('first')
    second.setDraft('second')

    first.paste(' typing')
    first.actions.toggleSkill('first-skill')

    expect(first.snapshot.draft).toBe('first typing /first-skill ')
    expect(second.snapshot.draft).toBe('second')
    expect(second.snapshot.selectedSkills).toEqual([])
  })

  it('does not edit submitting or disposed shells', async () => {
    const pending = Promise.withResolvers<SubmitOutcome>()
    const input = shell(() => pending.promise)
    input.setDraft('message')
    input.submit()
    expect(input.snapshot.phase).toBe('sending')
    input.actions.toggleSkill('tikhub')
    expect(input.snapshot.draft).toBe('message')
    pending.resolve({ kind: 'error', text: 'failed' })
    await vi.waitFor(() => { expect(input.snapshot.phase).toBe('plain') })
    expect(input.snapshot.draft).toBe('message')

    input.dispose()
    input.actions.toggleSkill('tikhub')
    expect(input.snapshot.draft).toBe('message')
  })

  it('does not edit a leading command chip while its input phase is claimed', () => {
    const input = shell()
    input.setDraft('/goal explain')
    expect(input.beginCommand({
      name: 'goal', token: '/goal ', submit: async () => ({ kind: 'success' }),
    }, { start: 0, end: 5, draftRev: input.snapshot.draftRev })).toBe(true)

    const before = input.snapshot.draft
    input.actions.toggleSkill('tikhub')

    expect(input.snapshot.phase).toBe('claimed')
    expect(input.snapshot.draft).toBe(before)
    expect(input.snapshot.selectedSkills).toEqual([])
  })

  it('keeps tokens after failure and clears them only after successful submission', async () => {
    const rejected = shell(async () => ({ kind: 'error', text: 'failed' }))
    expect(rejected.addAttachments(['failed-attachment' as DraftAttachmentId])).toBe(true)
    rejected.actions.toggleSkill('tikhub')
    rejected.submit()
    await vi.waitFor(() => { expect(rejected.snapshot.phase).toBe('plain') })
    expect(rejected.snapshot.selectedSkills).toEqual(['tikhub'])
    expect(rejected.snapshot.attachmentIds).toEqual(['failed-attachment'])

    const accepted = shell()
    expect(accepted.addAttachments(['successful-attachment' as DraftAttachmentId])).toBe(true)
    accepted.actions.toggleSkill('tikhub')
    accepted.submit()
    await vi.waitFor(() => { expect(accepted.snapshot.draft).toBe('') })
    expect(accepted.snapshot.selectedSkills).toEqual([])
    expect(accepted.snapshot.attachmentIds).toEqual([])
  })
})
