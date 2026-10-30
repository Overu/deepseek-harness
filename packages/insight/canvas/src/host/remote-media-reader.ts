import { request as httpRequest, type IncomingMessage, type ClientRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts'
import { MEDIA_LIMITS } from '../shared/canvas-media.ts'
import { snapshotAsset } from './asset-snapshot.ts'
import { resolveRemoteMediaTarget, type RemoteImageDependencies } from './remote-image-reader.ts'

/** Streams an authorized remote result to a bounded private snapshot. No credentials or redirects. */
export async function downloadRemoteMedia(value: string, name: string, mediaType: 'video' | 'audio',
  caller: AbortSignal, overrides: Partial<RemoteImageDependencies> = {}) {
  const signal = AbortSignal.any([caller, AbortSignal.timeout(120_000)])
  let request: ClientRequest | undefined, response: IncomingMessage | undefined
  const failed = () => new CanvasAgentError('ASSET_READ_REJECTED', '远端媒体读取失败或超时，尚未上传；不会自动重生成')
  let rejectResponse: (error: Error) => void = () => {}
  const abort = () => { request?.destroy(); response?.destroy(); rejectResponse(failed()) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    const { url, address } = await resolveRemoteMediaTarget(value, signal, overrides)
    response = await new Promise<IncomingMessage>((resolve, reject) => {
      rejectResponse = reject
      const send = overrides.request ?? ((url, options,
        callback) => (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, callback))
      request = send(url, { agent: false, family: address.family, signal,
        lookup: (_hostname, _options, callback) =>{  callback(null, address.address, address.family) },
        headers: { accept: `${mediaType}/*,application/octet-stream` } }, (res) => {
        const mime = (res.headers['content-type'] ?? '').split(';', 1)[0].toLowerCase().trim()
        if (signal.aborted || res.statusCode !== 200 ||
 Number(res.headers['content-length']) >= MEDIA_LIMITS[mediaType] || mime && mime !== 'application/octet-stream' &&
 !mime.startsWith(`${mediaType}/`)) {
          res.destroy(); reject(failed()); return
        }
        // Snapshot creation awaits disk I/O before iterating; handle early socket errors too.
        res.once('error', () => {})
        resolve(res)
      })
      request.once('error', () =>{  reject(failed()) }); request.end()
    })
    const snapshot = await snapshotAsset(response, name, mediaType, signal)
    const declared = response.headers['content-length']
    if (declared !== undefined && Number(declared) !== snapshot.bytes) { await snapshot.cleanup(); throw failed() }
    return snapshot
  } catch (error) {
    if (caller.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '远端媒体读取已取消')
    if (error instanceof CanvasAgentError && error.code === 'ASSET_VALIDATION_REJECTED') throw error
    throw failed()
  } finally { signal.removeEventListener('abort', abort); response?.destroy(); request?.destroy() }
}
