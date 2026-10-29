import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

const SAFE_FILE_EXTENSION_PATTERN = /\.([a-zA-Z0-9]{1,10})$/

/**
 * Create an opaque upload name while retaining a short normalized extension.
 * @param originalFileName - Caller-provided file name.
 * @returns A random UUID with the accepted extension, when present.
 */
export function createStoredFileName(originalFileName: string): string {
  const extension = originalFileName.trim().match(SAFE_FILE_EXTENSION_PATTERN)?.[1]?.toLowerCase()
  return extension ? `${randomUUID()}.${extension}` : randomUUID()
}

/**
 * Join an OSS directory and file name with one separating slash.
 * @param dir - Object directory, optionally surrounded by slashes.
 * @param fileName - Object file name, optionally prefixed with slashes.
 * @returns The relative object key.
 */
export function joinObjectKey(dir: string, fileName: string): string {
  const normalizedDir = dir.trim().replace(/^\/+|\/+$/g, '')
  const normalizedFileName = fileName.trim().replace(/^\/+/g, '')
  return normalizedDir ? `${normalizedDir}/${normalizedFileName}` : normalizedFileName
}

/**
 * Encode an OSS object key into its public bucket URL.
 * @param bucket - Bucket name supplied by the upload service.
 * @param region - OSS region supplied by the upload service.
 * @param objectKey - Unencoded object key.
 * @returns The public HTTPS object URL.
 */
export function buildPublicObjectUrl(bucket: string, region: string, objectKey: string): string {
  const encodedKey = objectKey
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return `https://${bucket}.${region}.aliyuncs.com/${encodedKey}`
}
