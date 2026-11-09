/** Exact-byte OSS transfer using the upload center's temporary authority. */

import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import type { AttachmentStore, FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { UploadFailure, type UploadSession } from './upload-center.ts'

/** One SDK PUT attempt; tests replace only the remote transport. */
export type OssPut = (session: UploadSession, data: Readable, mimeType: string,
  bytes: number, timeoutMs: number) => Promise<unknown>

const defaultPut: OssPut = async (session, data, mimeType, bytes, timeoutMs) => {
  const require = createRequire(import.meta.url)
  const OSS = require('ali-oss') as new (options: object) => {
    putStream(key: string, data: Readable, options: object): Promise<unknown>
  }
  const client = new OSS({ bucket: session.credentials.bucket, region: session.credentials.region,
    accessKeyId: session.credentials.accessKeyId, accessKeySecret: session.credentials.accessKeySecret,
    stsToken: session.credentials.securityToken, secure: true, retryMax: 0, timeout: timeoutMs })
  return client.putStream(session.objectKey, data, { mime: mimeType, contentLength: bytes })
}

/** Upload one immutable attachment without buffering it in the tool process.
 * @param attachments - Verifying local attachment stream provider.
 * @param file - Durable exact-byte file reference.
 * @param session - Temporary OSS credentials and service-owned object key.
 * @param mimeType - Filename-derived Content-Type declaration.
 * @param timeoutMs - Deployment-owned OSS request deadline.
 * @param signal - Tool cancellation before or during transfer.
 * @param put - One remote PUT attempt; replaceable for protocol tests.
 * @returns After a fully consumed stream and explicit OSS HTTP 200 only.
 */
export async function putOssObject(attachments: Pick<AttachmentStore, 'readFileStream'>, file: FileAttachmentRef,
  session: UploadSession, mimeType: string, timeoutMs: number, signal: AbortSignal,
  put: OssPut = defaultPut): Promise<void> {
  signal.throwIfAborted()
  let readBytes = 0
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for await (const chunk of attachments.readFileStream(file, signal)) {
      readBytes += chunk.byteLength
      yield chunk
    }
  }
  const stream = Readable.from(chunks())
  const abort = () => stream.destroy()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    const result = await put(session, stream, mimeType, file.bytes, timeoutMs)
    if (signal.aborted || (result as { res?: { status?: number } } | null)?.res?.status !== 200 || readBytes !== file.bytes) {
      throw new UploadFailure('OSS_RESULT_UNKNOWN', 'OSS upload result is unconfirmed. Do not upload again automatically.')
    }
  } catch (error) {
    if (error instanceof UploadFailure) throw error
    const status = error !== null && typeof error === 'object' && 'status' in error ? error.status : undefined
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408) {
      throw new UploadFailure('OSS_REJECTED', 'OSS rejected this upload; no object address was returned.')
    }
    throw new UploadFailure('OSS_RESULT_UNKNOWN', 'OSS upload result is unconfirmed. Do not upload again automatically.')
  } finally { signal.removeEventListener('abort', abort); stream.destroy() }
}
