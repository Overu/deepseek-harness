import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, type FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { uploadCenterServiceBaseUrl } from '@insight-ai/desktop-integration/host'
import { apply } from '../src/index.ts'
import { currentTurnUploadsProjection, selectUploadSource, uploadTurnSeq } from '../src/upload-source.ts'
import { objectFileType, requestUploadSession, type UploadSession } from '../src/upload-center.ts'
import { putOssObject } from '../src/oss-put.ts'

const file: FileAttachmentRef = { attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`), name: 'clip.mp4', bytes: 4 }
const serviceBaseUrl = 'https://gapi-test.insight-aigc.com/game-ai-editor-center'
const ossUrl = 'https://company-files.oss-cn-shanghai.aliyuncs.com/users/stored-clip.mp4'
const session: UploadSession = {
  credentials: { bucket: 'company-files', region: 'oss-cn-shanghai',
    accessKeyId: 'temporary-id', accessKeySecret: 'temporary-secret', securityToken: 'temporary-token' },
  objectKey: 'users/stored-clip.mp4', uploadUrl: ossUrl,
}

describe('direct upload-center protocol', () => {
  it('uses the fixed upload-center gateway path for both product environments', () => {
    expect(uploadCenterServiceBaseUrl('test')).toBe(serviceBaseUrl)
    expect(uploadCenterServiceBaseUrl('production')).toBe('https://gapi.insight-aigc.com/game-ai-editor-center')
  })

  it('requests STS with the account token and uses the returned object name', async () => {
    const transport = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ token: 'account-token' })
      expect(init?.body).toBe(JSON.stringify({ fileName: 'clip.mp4', libraryId: '1001', type: 1, fileType: 'video' }))
      return Response.json({ code: 'SUCCESS', data: { ...session.credentials,
        endPoint: 'oss-cn-shanghai.aliyuncs.com', dir: 'users/', fileName: 'stored-clip.mp4', fileType: 'video',
        expiration: new Date(Date.now() + 300_000).toISOString(), url: null } })
    })
    expect(await requestUploadSession(serviceBaseUrl, 'account-token', file,
      new AbortController().signal, transport)).toEqual(session)
    expect(transport.mock.calls[0]?.[0]).toEqual(new URL(`${serviceBaseUrl}/upload/sts/token`))
  })

  it('classifies committed filenames without model-selected file types', () => {
    expect(['photo.jpg', 'clip.mp4', 'voice.mp3', 'report.pdf'].map(objectFileType))
      .toEqual(['image', 'video', 'audio', 'file'])
  })

  it('rejects a foreign OSS endpoint before transfer', async () => {
    const transport = vi.fn(async () => Response.json({ code: 'SUCCESS', data: { ...session.credentials,
      endPoint: 'other.example', dir: 'users/', fileName: 'clip.mp4', fileType: 'video',
      expiration: new Date(Date.now() + 300_000).toISOString() } }))
    await expect(requestUploadSession(serviceBaseUrl, 'account-token', file,
      new AbortController().signal, transport)).rejects.toMatchObject({ code: 'STS_RESPONSE_INVALID' })
  })

  it('rejects an expired credential or unsafe returned object name', async () => {
    const data = { ...session.credentials, endPoint: 'oss-cn-shanghai.aliyuncs.com', dir: 'users/',
      fileName: 'stored-clip.mp4', fileType: 'video', expiration: new Date(Date.now() + 300_000).toISOString() }
    for (const invalidData of [{ ...data, expiration: new Date(Date.now() - 1000).toISOString() },
      { ...data, fileName: '../other.mp4' }, { ...data, dir: 'users/../other/' }]) {
      const transport = vi.fn(async () => Response.json({ code: 'SUCCESS', data: invalidData }))
      await expect(requestUploadSession(serviceBaseUrl, 'account-token', file,
        new AbortController().signal, transport)).rejects.toMatchObject({ code: 'STS_RESPONSE_INVALID' })
    }
  })

  it('reports a rejected STS status and safe code without exposing the response message', async () => {
    const transport = vi.fn(async () => Response.json({ code: 'UPLOAD_STS_FAILED',
      msg: 'sensitive upstream detail' }, { status: 502 }))
    await expect(requestUploadSession(serviceBaseUrl, 'account-token', file,
      new AbortController().signal, transport)).rejects.toMatchObject({
      code: 'STS_REJECTED',
      message: 'Upload-center authorization failed (HTTP 502, UPLOAD_STS_FAILED); no OSS upload was started.',
    })
  })

  it('rejects a non-success business result even when HTTP succeeded', async () => {
    const transport = vi.fn(async () => Response.json({ code: 'USER_NOT_LOGIN' }))
    await expect(requestUploadSession(serviceBaseUrl, 'account-token', file,
      new AbortController().signal, transport)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })
})

describe('original-byte OSS PUT', () => {
  it('streams the exact file and requires full consumption plus HTTP 200', async () => {
    const attachments = { readFileStream: async function* () { yield Uint8Array.from([1, 2]); yield Uint8Array.from([3, 4]) } }
    const chunks: Buffer[] = []
    await putOssObject(attachments, file, session, 'video/mp4', 60_000, new AbortController().signal,
      async (authority, stream, type, bytes) => {
        expect(authority.objectKey).toBe('users/stored-clip.mp4')
        expect(type).toBe('video/mp4')
        expect(bytes).toBe(4)
        for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array))
        return { res: { status: 200 } }
      })
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  it('reports an unconfirmed transfer when the PUT response arrives before the stream is consumed', async () => {
    const attachments = { readFileStream: async function* () { yield Uint8Array.from([1, 2, 3, 4]) } }
    await expect(putOssObject(attachments, file, session, 'video/mp4', 60_000, new AbortController().signal,
      async () => ({ res: { status: 200 } }))).rejects.toMatchObject({ code: 'OSS_RESULT_UNKNOWN' })
  })

  it('destroys the source and reports an unconfirmed result when cancelled after PUT starts', async () => {
    const controller = new AbortController()
    const attachments = { readFileStream: async function* () { yield Uint8Array.from([1, 2, 3, 4]) } }
    await expect(putOssObject(attachments, file, session, 'video/mp4', 60_000, controller.signal,
      async (_authority, stream) => { controller.abort(); expect(stream.destroyed).toBe(true)
        return { res: { status: 200 } } })).rejects.toMatchObject({ code: 'OSS_RESULT_UNKNOWN' })
  })
})

describe('current-turn attachment authority', () => {
  it('selects original image bytes, video, and text only from the open direct-user turn', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionProjectionRegistry)
      const projection = await ctx.sessionProjections.register(currentTurnUploadsProjection)
      const history = Session.create(SessionId('older-turn'))
      history.append('turn/start', { turn: 1 })
      history.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'file', attachment: file }] }), { surfaceOp: 'append' })
      history.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const agent = { session: history } as Agent
      expect(() => selectUploadSource(agent, 1, projection)).toThrow('No user attachment')
      history.append('turn/start', { turn: 2 })
      const original: FileAttachmentRef = { attachmentId: AttachmentId(`sha256:${'cd'.repeat(32)}`), name: 'photo.png', bytes: 8 }
      const text: FileAttachmentRef = { attachmentId: AttachmentId(`sha256:${'ef'.repeat(32)}`), name: 'note.txt', bytes: 3 }
      history.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
        { type: 'image', attachment: { attachmentId: AttachmentId('normalized'), mediaType: 'image/png',
          bytes: 5, width: 1, height: 1 }, originalFile: original },
        { type: 'file', attachment: file }, { type: 'file', attachment: text },
      ] }), { surfaceOp: 'append' })
      expect(() => selectUploadSource(agent, undefined, projection)).toThrow('Specify attachmentIndex')
      expect(selectUploadSource(agent, 1, projection)).toEqual(original)
      expect(selectUploadSource(agent, 2, projection)).toEqual(file)
      expect(selectUploadSource(agent, 3, projection)).toEqual(text)
      const firstTurnSeq = uploadTurnSeq(agent, projection)
      expect(firstTurnSeq).toBeGreaterThan(0)
      expect(() => selectUploadSource(agent, 0, projection)).toThrow('positive integer')
      expect(() => selectUploadSource(agent, 4, projection)).toThrow('outside')
      history.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      expect(uploadTurnSeq(agent, projection)).toBeUndefined()
      history.append('turn/start', { turn: 3 })
      expect(uploadTurnSeq(agent, projection)).not.toBe(firstTurnSeq)
      expect(() => selectUploadSource(agent, 1, projection)).toThrow('No user attachment')
      await projection.dispose()
    } finally { await ctx.fiber.dispose() }
  })

  it('drops a replaced image and refuses an image with no original bytes', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionProjectionRegistry)
      const projection = await ctx.sessionProjections.register(currentTurnUploadsProjection)
      const session = Session.create(SessionId('replaced-image'))
      const agent = { session } as Agent
      session.append('turn/start', { turn: 1 })
      const first = session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'file', attachment: file }] }), { surfaceOp: 'append' })
      session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'image', attachment: { attachmentId: AttachmentId('normalized'),
          mediaType: 'image/png', bytes: 4, width: 1, height: 1 } }] }),
      { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq }, sourceEventSeqs: [first.seq] })
      expect(() => selectUploadSource(agent, 1, projection)).toThrow('original bytes')
      expect(() => selectUploadSource(agent, 2, projection)).toThrow('outside')
      await projection.dispose()
    } finally { await ctx.fiber.dispose() }
  })
})

describe('tool authorization', () => {
  it('requires a fresh approval before fetching account credentials or contacting OSS', async () => {
    const ctx = new Context()
    const release = vi.fn()
    try {
      await ctx.plugin(SessionProjectionRegistry)
      const session = Session.create(SessionId('approval-turn'))
      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'file', attachment: file }] }), { surfaceOp: 'append' })
      const agent = { session } as Agent
      const register = vi.fn((_definition: ToolDefinition) => release)
      const request = vi.fn(async () => 'rejected' as const)
      const getAccessToken = vi.fn(async () => 'account-token')
      ctx.provide('tools', { register } as never)
      ctx.provide('agents', { roots: () => [agent] } as never)
      ctx.provide('approval', { request } as never)
      ctx.provide('insightAccount', { getAccessToken } as never)
      ctx.provide('attachments', {} as never)
      await apply(ctx, { serviceEnvironment: 'test', requestTimeoutMs: 15_000, ossTimeoutMs: 180_000,
        generationRequestTimeoutMs: 15_000, generationPollIntervalMs: 10_000, generationWatchTimeoutMs: 3_900_000 })
      const definition = register.mock.calls[0]?.[0]
      expect(definition?.name).toBe('upload_attachment')
      expect(definition?.output.schema.properties).not.toHaveProperty('attachmentId')
      expect(definition?.output.render({}, { url: ossUrl,
        urlAccess: 'unverified', filename: 'clip.mp4', sizeBytes: 4 })).toEqual([{
        type: 'text', text: JSON.stringify({ url: ossUrl,
          urlAccess: 'unverified', filename: 'clip.mp4', sizeBytes: 4 }),
      }])
      const exec = { agent, callId: ToolCallId('call-1'), name: 'upload_attachment', arguments: {},
        signal: new AbortController().signal } as ToolRunContext
      await expect(definition?.execute({}, exec)).rejects.toMatchObject({ code: 'APPROVAL_DENIED' })
      expect(request).toHaveBeenCalledOnce()
      expect(getAccessToken).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
    expect(release).toHaveBeenCalledTimes(3)
  })
})
