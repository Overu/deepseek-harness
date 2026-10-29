import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage, type RequestOptions, type ClientRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts'
import { isFakeAddress, resolvePublicImageHost } from './remote-image-dns.ts'

const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(address,prefix,'ipv4')
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked.addSubnet(address,prefix,'ipv6')
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6')
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address,'ipv4') : family === 6 && globalV6.check(address,'ipv6') && !blocked.check(address,'ipv6')
}
export interface RemoteImageDependencies {
  lookup(hostname: string): Promise<{ address: string; family: number }[]>
  resolvePublic: typeof resolvePublicImageHost
  request(url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest
  maxBytes: number
}
const failure = (phase: string, message: string) => new CanvasAgentError('ASSET_NOT_FOUND', `远端图片读取失败[${phase}]：${message}；未上传、未重新生成`)
function imageType(data: Buffer): ImageMediaType | undefined {
  if (data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return 'image/png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg'
  if (['GIF87a','GIF89a'].includes(data.subarray(0,6).toString('ascii'))) return 'image/gif'
  if (data.subarray(0,4).toString('ascii') === 'RIFF' && data.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp'
}
function safeUrl(value: string): URL {
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/gu,'')
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash || url.port || !host || isIP(host) && !isPublicAddress(host)) throw failure('url', '图片地址不符合读取要求')
  return url
}
export async function resolveRemoteMediaTarget(value: string, signal: AbortSignal, overrides: Partial<RemoteImageDependencies> = {}) {
  const deps = { lookup: (hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }), resolvePublic: resolvePublicImageHost, ...overrides }
  const url = safeUrl(value), host = url.hostname.replace(/^\[|\]$/gu, '')
  let addresses: { address: string; family: number }[]
  try {
    addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
      const abort = () => reject(failure('dns', '域名解析已中止'))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); return }
      void deps.lookup(host).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
    if (!isIP(host) && addresses.length && addresses.every(address => isFakeAddress(address.address))) addresses = await deps.resolvePublic(host, signal)
  } catch { throw failure('dns', '无法确认素材域名的真实公网地址') }
  if (signal.aborted || !addresses.length || addresses.some(address => !isPublicAddress(address.address))) throw failure('dns', '素材域名没有可确认的公网地址')
  return { url, address: addresses[0] }
}
/** DNS is verified and pinned; Fake-IP-only DNS uses independent resolution. No credentials or redirects. */
export async function downloadRemoteImage(value: string, caller: AbortSignal, overrides: Partial<RemoteImageDependencies> = {}): Promise<{ data: Uint8Array; mediaType: ImageMediaType }> {
  if (caller.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '素材读取已取消')
  const signal = AbortSignal.any([caller, AbortSignal.timeout(30_000)])
  const deps: RemoteImageDependencies = {
    lookup: hostname => dnsLookup(hostname,{ all:true,verbatim:true }),
    resolvePublic: resolvePublicImageHost,
    request: (url,options,callback) => (url.protocol === 'https:' ? httpsRequest : httpRequest)(url,options,callback),
    maxBytes:20*1024*1024, ...overrides,
  }
  try {
    const { url, address } = await resolveRemoteMediaTarget(value, signal, deps)
    return await new Promise((resolve,reject) => {
      let response: IncomingMessage | undefined, request: ClientRequest | undefined, settled = false
      const finish = (error?: CanvasAgentError, image?: {data:Uint8Array;mediaType:ImageMediaType}) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort',abort)
        if (error) { response?.destroy(); request?.destroy(); reject(error) } else resolve(image!)
      }
      const abort = () => finish(failure('timeout', '图片读取已中止或超时'))
      signal.addEventListener('abort',abort,{once:true})
      try {
        request = deps.request(url, { agent:false, family:address.family,
          lookup: (_hostname,_options,callback) => callback(null,address.address,address.family),
          headers:{accept:'image/png,image/jpeg,image/webp,image/gif'} }, res => {
          response = res
          if (settled) { res.destroy(); return }
          const type = String(res.headers['content-type'] ?? '').split(';',1)[0].trim().toLowerCase()
          const size = Number(res.headers['content-length'])
          if (res.statusCode !== 200) { finish(failure('http', `图片服务返回HTTP ${res.statusCode ?? 'unknown'}，未跟随重定向`)); return }
          if (Number.isFinite(size) && size >= deps.maxBytes || type && !['image/png','image/jpeg','image/webp','image/gif','application/octet-stream'].includes(type)) { finish(failure('content', '图片类型或大小不符合要求')); return }
          const chunks: Buffer[] = []; let bytes = 0
          res.on('data',chunk => {
            bytes += chunk.length
            if (bytes >= deps.maxBytes) finish(failure('content', '图片超过读取大小限制'))
            else chunks.push(Buffer.from(chunk))
          })
          res.once('error',() => finish(failure('network', '图片响应连接中断')))
          res.once('aborted',() => finish(failure('network', '图片响应连接中断')))
          res.once('end',() => {
            const data = Buffer.concat(chunks), mediaType = imageType(data)
            if (!mediaType || bytes === 0 || type.startsWith('image/') && type !== mediaType) finish(failure('content', '图片内容或格式校验失败'))
            else finish(undefined,{data,mediaType})
          })
        })
        request.once('error',() => finish(failure('network', '无法连接图片服务')))
        request.end()
        if (signal.aborted) abort()
      } catch { finish(failure('network', '无法连接图片服务')) }
    })
  } catch (cause) {
    if (caller.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH','素材读取已取消')
    if (signal.aborted) throw failure('timeout', '图片读取超时')
    throw cause instanceof CanvasAgentError ? cause : failure('url', '图片地址无法读取')
  }
}
