/** Short-lived GitHub OIDC backed OSS transport for Insight release objects. */

import OSS from 'ali-oss'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { finished } from 'node:stream/promises'

const REPOSITORY = 'Overu/deepseek-harness'
const REPOSITORY_ID = '1429559776'
const REF = 'refs/heads/insight'
const WORKFLOW = 'Overu/deepseek-harness/.github/workflows/insight-publish.yml@refs/heads/insight'
const GATEWAY = 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/upload/sts/token'
const MAX_METADATA_BYTES = 4 * 1024 * 1024
const IMMUTABLE_CACHE_CONTROL = 'public,max-age=31536000,immutable'
const POINTER_CACHE_CONTROL = 'public,max-age=60,must-revalidate'
/** Gateway and runner clocks may differ slightly; a longer grant is never accepted. */
const EXPIRATION_CLOCK_SKEW_MS = 60_000

/** Validated temporary credentials scoped to the Insight desktop update bucket. */
export interface OssCredentials {
  readonly accessKeyId: string
  readonly accessKeySecret: string
  readonly securityToken: string
  readonly expirationMs: number
}

/** Raised when an OSS write might have reached the service and must be reconciled by its caller. */
export class OssWriteOutcomeUnknownError extends Error {}

/** Minimal operations required by the candidate publisher. */
export interface InsightOssTransport {
  getMetadata(key: string): Promise<{ readonly bytes: Uint8Array; readonly etag: string } | undefined>
  download(key: string, destination: string): Promise<{
    readonly size: number
    readonly sha512: string
    readonly etag: string
  } | undefined>
  putImmutable(key: string, source: { readonly bytes: Uint8Array } | { readonly path: string }): Promise<void>
  putPointer(key: string, bytes: Uint8Array, options: { readonly expectedEtag?: string; readonly ifAbsent?: boolean }): Promise<void>
}

interface OssClient {
  getStream(key: string): Promise<{
    stream?: AsyncIterable<Uint8Array>
    res: { status: number; headers: Record<string, string | undefined> }
  }>
  get(key: string, destination: string): Promise<{ res: { status: number; headers: Record<string, string | undefined> } }>
  put(key: string, source: Uint8Array | string, options: { headers: Record<string, string> }): Promise<unknown>
  multipartUpload(key: string, source: string, options: { headers: Record<string, string> }): Promise<unknown>
}

/** Create a strict GitHub workflow OIDC to STS credential supplier. */
export function createGithubStsProvider(
  input: { readonly environment?: NodeJS.ProcessEnv; readonly fetch?: typeof globalThis.fetch; readonly now?: () => number } = {},
): () => Promise<OssCredentials> {
  const environment = input.environment ?? process.env
  const fetchImplementation = input.fetch ?? globalThis.fetch
  if (
    environment.GITHUB_ACTIONS !== 'true' || environment.GITHUB_REPOSITORY !== REPOSITORY
    || environment.GITHUB_REPOSITORY_ID !== REPOSITORY_ID || environment.GITHUB_REF !== REF
    || environment.GITHUB_EVENT_NAME !== 'workflow_dispatch' || environment.GITHUB_WORKFLOW_REF !== WORKFLOW
    || !/^\d+$/u.test(environment.GITHUB_RUN_ID ?? '')
  ) throw new Error('OSS publishing is restricted to the approved GitHub workflow.')
  const requestUrl = https(environment.ACTIONS_ID_TOKEN_REQUEST_URL, 'GitHub OIDC URL')
  if (!requestUrl.hostname.endsWith('.actions.githubusercontent.com')) throw new Error('GitHub OIDC host is invalid.')
  const requestToken = required(environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'GitHub OIDC token')
  return async () => {
    const oidc = new URL(requestUrl); oidc.searchParams.set('audience', 'insight-harness-oss-upload')
    const oidcValue = await json(fetchImplementation, oidc, { headers: { authorization: `Bearer ${requestToken}` } }, 'GitHub OIDC')
    const token = required(object(oidcValue, 'GitHub OIDC').value, 'GitHub OIDC value')
    const response = object(await json(fetchImplementation, new URL(GATEWAY), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }, 'OSS STS'), 'OSS STS')
    if (response.code !== 'SUCCESS') throw new Error('OSS STS request was rejected.')
    const data = object(response.data, 'OSS STS data')
    const durationSeconds = data.durationSeconds
    if (
      data.bucket !== 'insight-desktop-updates' || data.region !== 'oss-cn-guangzhou'
      || data.endPoint !== 'oss-cn-guangzhou.aliyuncs.com' || data.dir !== '' || data.fileType !== 'file'
      || data.url !== null || Object.hasOwn(data, 'userId') || Object.hasOwn(data, 'fileName')
      || data.repositoryId !== REPOSITORY_ID || data.runId !== environment.GITHUB_RUN_ID
      || typeof durationSeconds !== 'number' || !Number.isSafeInteger(durationSeconds)
      || durationSeconds <= 0 || durationSeconds > 3600
    ) throw new Error('OSS STS response is outside the approved scope.')
    const now = (input.now ?? Date.now)()
    const expirationMs = Date.parse(required(data.expiration, 'OSS STS expiration'))
    if (!Number.isFinite(expirationMs) || expirationMs <= now) throw new Error('OSS STS credentials are expired.')
    if (expirationMs > now + durationSeconds * 1000 + EXPIRATION_CLOCK_SKEW_MS) throw new Error('OSS STS credential duration exceeds the approved grant.')
    return { accessKeyId: required(data.accessKeyId, 'OSS access key'), accessKeySecret: required(data.accessKeySecret, 'OSS secret'), securityToken: required(data.securityToken, 'OSS token'), expirationMs }
  }
}

/** Create an HTTPS, V4-authorized short-term OSS transport. */
export function createAliOssTransport(
  input: {
    readonly getStsToken: () => Promise<OssCredentials>
    readonly ossClientFactory?: (options: object) => OssClient
    readonly now?: () => number
  },
): InsightOssTransport {
  let active: { client: OssClient; expirationMs: number } | undefined
  const now = input.now ?? Date.now
  const client = async () => {
    if (active !== undefined && active.expirationMs - now() > 180_000) return active.client
    const credentials = await input.getStsToken()
    const configuration: OSS.Options = { accessKeyId: credentials.accessKeyId, accessKeySecret: credentials.accessKeySecret, stsToken: credentials.securityToken, bucket: 'insight-desktop-updates', region: 'oss-cn-guangzhou', endpoint: 'https://oss-accelerate.aliyuncs.com', secure: true, authorizationV4: true }
    const factory = input.ossClientFactory ?? ((options: object): OssClient => new OSS(options as OSS.Options) as OssClient)
    active = { expirationMs: credentials.expirationMs, client: factory(configuration) }
    return active.client
  }
  return {
    async getMetadata(key) { assertKey(key); try { const result = await (await client()).getStream(key); if (result.stream === undefined) throw new Error('OSS metadata response has no stream.'); const bytes = await bounded(result.stream); return { bytes, etag: etag(result.res.headers) } } catch (error) { if (status(error) === 404) return undefined; throw error } },
    async download(key, destination) { assertKey(key); try { const result = await (await client()).get(key, destination); const measurement = await hashFile(destination); return { ...measurement, etag: etag(result.res.headers) } } catch (error) { if (status(error) === 404) { await rm(destination, { force: true }); return undefined } throw new OssWriteOutcomeUnknownError(`OSS download failed for ${key}: ${String(error)}`) } },
    async putImmutable(key, source) { assertKey(key); try { const c = await client(); const headers = { 'x-oss-forbid-overwrite': 'true', 'cache-control': IMMUTABLE_CACHE_CONTROL }; if ('path' in source) await c.multipartUpload(key, source.path, { headers }); else await c.put(key, source.bytes, { headers }) } catch (error) { throw new OssWriteOutcomeUnknownError(`OSS immutable write outcome is unknown for ${key}: ${String(error)}`) } },
    async putPointer(key, bytes, options) { assertKey(key); const headers: Record<string, string> = { 'cache-control': POINTER_CACHE_CONTROL }; if (options.expectedEtag !== undefined) headers['If-Match'] = options.expectedEtag; if (options.ifAbsent === true) headers['If-None-Match'] = '*'; try { await (await client()).put(key, bytes, { headers }) } catch (error) { throw new OssWriteOutcomeUnknownError(`OSS pointer write outcome is unknown for ${key}: ${String(error)}`) } },
  }
}

function assertKey(key: string): void { if (!/^desktop\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u.test(key)) throw new Error('OSS key is unsafe.') }
function required(value: unknown, label: string): string { if (typeof value !== 'string' || value === '') throw new Error(`${label} is required.`); return value }
function object(value: unknown, label: string): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`); return Object.fromEntries(Object.entries(value)) }
function https(value: string | undefined, label: string): URL { try { const url = new URL(required(value, label)); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); return url } catch { throw new Error(`${label} is invalid.`) } }
async function json(fetchImplementation: typeof fetch, url: URL, init: RequestInit, label: string): Promise<unknown> { const response = await fetchImplementation(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(45_000) }); if (!response.ok) throw new Error(`${label} request failed.`); return response.json() }
async function bounded(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> { const chunks: Uint8Array[] = []; let size = 0; for await (const chunk of stream) { size += chunk.byteLength; if (size > MAX_METADATA_BYTES) throw new Error('OSS metadata exceeds the size limit.'); chunks.push(chunk) } const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength } return bytes }
async function hashFile(path: string): Promise<{ size: number; sha512: string }> { const metadata = await stat(path); const hash = createHash('sha512'); const input = createReadStream(path); input.on('data', chunk => hash.update(chunk)); await finished(input); return { size: metadata.size, sha512: hash.digest('base64') } }
function etag(headers: Record<string, string | undefined>): string { const value = headers.etag ?? headers.ETag; if (typeof value !== 'string' || value === '') throw new Error('OSS response did not provide an ETag.'); return value }
function status(error: unknown): number | undefined { return error !== null && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined }
