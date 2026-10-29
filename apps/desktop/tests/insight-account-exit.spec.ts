import { describe, expect, it, vi } from 'vitest'
import { closeInsightAccount } from '../src/insight-account-exit.ts'

describe('Insight account shutdown', () => {
  it('revokes admission before releasing resources and clears credentials after all releases', async () => {
    const events: string[] = []
    const stopped = Promise.withResolvers<undefined>()
    const clearing = vi.fn(async () => { events.push('clear') })
    const closing = closeInsightAccount({
      revoke: () => { events.push('revoke') },
      stop: [async () => { events.push('stop'); await stopped.promise; events.push('stopped') }],
      clearAuthentication: clearing,
    })
    expect(events).toEqual(['revoke', 'stop'])
    expect(clearing).not.toHaveBeenCalled()
    stopped.resolve(undefined)
    await closing
    expect(events).toEqual(['revoke', 'stop', 'stopped', 'clear'])
  })

  it('still stops the Host and clears credentials when another resource fails synchronously', async () => {
    const stopped = Promise.withResolvers<undefined>()
    const clearing = vi.fn(async () => {})
    const stopHost = vi.fn(() => stopped.promise)
    const error = new Error('platform release failed')
    const closing = closeInsightAccount({
      revoke: () => {}, stop: [() => { throw error }, stopHost], clearAuthentication: clearing,
    })
    const rejected = expect(closing).rejects.toMatchObject({ errors: [error] })
    expect(stopHost).toHaveBeenCalledOnce()
    expect(clearing).not.toHaveBeenCalled()
    stopped.resolve(undefined)
    await rejected
    expect(clearing).toHaveBeenCalledOnce()
  })

  it('still releases resources after a renderer revocation notification fails', async () => {
    const error = new Error('renderer already gone')
    const stop = vi.fn(async () => {})
    const clearAuthentication = vi.fn(async () => {})
    await expect(closeInsightAccount({ revoke: () => { throw error }, stop: [stop], clearAuthentication }))
      .rejects.toMatchObject({ errors: [error] })
    expect(stop).toHaveBeenCalledOnce()
    expect(clearAuthentication).toHaveBeenCalledOnce()
  })

  it('rejects restart when credentials cannot be removed, including simultaneous stop failure', async () => {
    const stopError = new Error('stop not confirmed')
    const authError = new Error('credential cleanup failed')
    await expect(closeInsightAccount({
      revoke: () => {}, stop: [async () => { throw stopError }],
      clearAuthentication: async () => { throw authError },
    })).rejects.toMatchObject({ errors: [stopError, authError] })
  })
})
