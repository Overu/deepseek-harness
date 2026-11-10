/** Save a verified image-layering PSD in the active Session workspace. */
import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const DEFAULT_HOST = 'game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com'
const MAX_BYTES = 256 * 1024 * 1024

function allowedUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('INVALID_PSD_URL')
  const url = new URL(raw)
  const hosts = (process.env.INSIGHT_LAYERING_PSD_HOSTS ?? DEFAULT_HOST).split(',').map(value => value.trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port
    || !hosts.includes(url.hostname) || !url.pathname.toLowerCase().endsWith('.psd')) {
    throw new Error('PSD_URL_NOT_ALLOWED')
  }
  return url
}

async function download(raw) {
  const response = await fetch(allowedUrl(raw), { redirect: 'error', signal: AbortSignal.timeout(120_000) })
  if (!response.ok || !response.body) throw new Error('PSD_DOWNLOAD_FAILED')
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (type !== 'image/vnd.adobe.photoshop' && type !== 'application/octet-stream') {
    throw new Error('PSD_CONTENT_TYPE_INVALID')
  }
  const declared = Number(response.headers.get('content-length'))
  if (response.headers.has('content-length') && (!Number.isSafeInteger(declared) || declared < 4 || declared > MAX_BYTES)) {
    throw new Error('PSD_SIZE_INVALID')
  }
  const dir = resolve(process.cwd(), 'generated', 'image-layering')
  await mkdir(dir, { recursive: true })
  const id = randomUUID()
  const temporary = join(dir, `.layered-${id}.part`)
  const final = join(dir, `layered-${id}.psd`)
  const file = await open(temporary, 'wx')
  let size = 0
  const header = new Uint8Array(26)
  try {
    for await (const chunk of response.body) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
      if (size + bytes.length > MAX_BYTES) throw new Error('PSD_TOO_LARGE')
      if (size < 26) header.set(bytes.subarray(0, 26 - size), size)
      let offset = 0
      while (offset < bytes.length) {
        const result = await file.write(bytes, offset, bytes.length - offset)
        if (result.bytesWritten < 1) throw new Error('PSD_WRITE_FAILED')
        offset += result.bytesWritten
      }
      size += bytes.length
    }
    if (size < 26 || Buffer.from(header.subarray(0, 4)).toString('ascii') !== '8BPS'
      || header[4] !== 0 || header[5] !== 1) throw new Error('PSD_HEADER_INVALID')
    if (response.headers.has('content-length') && size !== declared) throw new Error('PSD_SIZE_MISMATCH')
    await file.sync()
    await file.close()
    await rename(temporary, final)
    return { path: final, sizeBytes: size }
  } catch (error) {
    await file.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

try {
  if (process.argv.length !== 3) throw new Error('PSD_URL_REQUIRED')
  console.log(JSON.stringify(await download(process.argv[2])))
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error && /^[A-Z_]+$/u.test(error.message)
    ? error.message : 'PSD_DOWNLOAD_FAILED' }))
  process.exitCode = 1
}