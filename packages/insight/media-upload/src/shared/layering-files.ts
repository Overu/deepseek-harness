/** Persisted result descriptors shared by the Host and the client card. */
/** Exact authenticated Host route; the browser uses its document-relative form. */
export const RESULT_DOWNLOAD_PATH = '/api/insight/media-upload/result-download'

export interface LayeringFile {
  /** Service-returned HTTPS result URL; never accepted from a download request. */
  readonly url: string
  /** Display/download extension. */
  readonly kind: 'psd' | 'png' | 'jpg' | 'webp'
  /** Safe local download name, independent of the remote object key. */
  readonly name: string
}

/** Parse one successful result tool message. */
export function parseLayeringDelivery(value: unknown): {
  taskHandle: string
  accountScope: string
  imageLabel: string
  manifestPath: string
  complete: boolean
  files: LayeringFile[]
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.taskHandle !== 'string' || !row.taskHandle || typeof row.accountScope !== 'string'
    || !row.accountScope || typeof row.imageLabel !== 'string'
    || !row.imageLabel || row.imageLabel.length > 200 || typeof row.manifestPath !== 'string'
    || !row.manifestPath || typeof row.complete !== 'boolean' || !Array.isArray(row.files)
    || row.files.length === 0 || row.files.length > 129) return undefined
  const files: LayeringFile[] = []
  for (const entry of row.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
    const file = entry as Record<string, unknown>
    if (typeof file.url !== 'string' || file.url.length > 8192 || typeof file.name !== 'string'
      || !/^(?:layered\.psd|layer-\d+\.(?:png|jpg|webp))$/u.test(file.name)
      || file.kind !== 'psd' && file.kind !== 'png' && file.kind !== 'jpg' && file.kind !== 'webp') return undefined
    files.push({ url: file.url, name: file.name, kind: file.kind })
  }
  return { taskHandle: row.taskHandle, accountScope: row.accountScope, imageLabel: row.imageLabel,
    manifestPath: row.manifestPath, complete: row.complete, files }
}
