// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LayeringResultCards } from '../src/client/LayeringResultCards.tsx'
import { layeringResultsDefinition } from '../src/client/layering-results.ts'

const host = 'game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com'
const delivery = { taskHandle: 'task-1', accountScope: 'account-1', imageLabel: '图片 1（photo.png）',
  manifestPath: 'C:/workspace/result.json', complete: true,
  files: [{ url: `https://${host}/result.psd`, kind: 'psd', name: 'layered.psd' }] }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('image-layering result cards', () => {
  it('reconstructs a result card from the recorded tool call and result', () => {
    const call = { type: 'tool/call', seq: 3, data: { turn: 1, callId: 'call-1', name: 'cache_image_layering_result' } }
    const result = { type: 'tool/result', seq: 4, data: { turn: 1,
      message: { source: { callId: 'call-1' }, content: [{ type: 'text', text: JSON.stringify(delivery) }] } } }
    const initial = { turn: 1, calls: new Set<string>(), cards: [] }
    const matchedCall = layeringResultsDefinition.match(call as never)!
    const called = layeringResultsDefinition.update!({ state: initial } as never,
      { event: call, ...matchedCall } as never)
    const matchedResult = layeringResultsDefinition.match(result as never)!
    const completed = layeringResultsDefinition.update!({ state: called } as never,
      { event: result, ...matchedResult } as never)
    const location = layeringResultsDefinition.buildLocationData!({ state: completed } as never, 'turn', null)
    expect(location).toMatchObject({ kind: 'turn', key: 'insight-layering-results',
      value: [{ seq: 4, imageLabel: delivery.imageLabel, files: delivery.files }] })
  })

  it('starts the file download on one click without a second confirmation', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([56, 66, 80, 83]), { status: 200 }))
    const confirm = vi.fn(() => { throw new Error('Unexpected confirmation') })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const revoke = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('confirm', confirm)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: revoke }))
    const turn = { data: new Map([['insight-layering-results', [{ ...delivery, seq: 4 }]]]) }
    const props = { turn, seq: 4, openFile: () => {}, mediaSessionId: 'session-1',
      t: (key: string, params?: { image: string }) => key === 'title' ? `${params?.image} 的处理结果`
        : key === 'download' ? '下载' : key }
    render(<LayeringResultCards {...(props as Parameters<typeof LayeringResultCards>[0])} />)
    fireEvent.click(await screen.findByRole('button', { name: '下载' }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(fetcher).toHaveBeenCalledWith('api/insight/media-upload/result-download?sessionId=session-1&seq=4&index=0',
      { credentials: 'same-origin' })
    expect(confirm).not.toHaveBeenCalled()
  })
})
