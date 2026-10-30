export type UploadErrorCode =
  | 'INVALID_FILE'
  | 'USER_NOT_READY'
  | 'STS_REQUEST_FAILED'
  | 'INVALID_STS_RESPONSE'
  | 'STS_EXPIRED'
  | 'OSS_AUTH_FAILED'
  | 'OSS_CORS_FAILED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UPLOAD_FAILED'
  | 'PUBLIC_URL_MISSING'

export class UploadError extends Error {
  code: UploadErrorCode
  retryable: boolean
  override cause?: unknown

  constructor(code: UploadErrorCode, message: string, options?: { retryable?: boolean
    cause?: unknown }) {
    super(message)
    this.name = 'UploadError'
    this.code = code
    this.retryable = options?.retryable ?? false
    this.cause = options?.cause
  }
}

const getErrorField = (error: unknown, field: string) => {
  if (!error || typeof error !== 'object') return undefined
  return (error as Record<string, unknown>)[field]
}

export function toUploadError(error: unknown): UploadError {
  if (error instanceof UploadError) return error

  const rawName = getErrorField(error, 'name')
  const name = typeof rawName === 'string' ? rawName : ''
  const rawCode = getErrorField(error, 'code')
  const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : ''
  const status = Number(getErrorField(error, 'status') || 0)
  const rawMessage = getErrorField(error, 'message')
  const message = typeof rawMessage === 'string' && rawMessage ? rawMessage : '文件上传失败'

  if (name === 'AbortError' || name === 'cancel' || code === 'CANCELLED') {
    return new UploadError('CANCELLED', '已取消上传', { cause: error })
  }

  if (status === 403 || ['AccessDenied', 'InvalidAccessKeyId', 'SecurityTokenExpired', 'InvalidSecurityToken'].includes(code)) {
    return new UploadError('OSS_AUTH_FAILED', '上传凭证无效或没有文件上传权限', { retryable: true, cause: error })
  }

  if (/cors/i.test(message)) {
    return new UploadError('OSS_CORS_FAILED', '对象存储跨域配置错误', { cause: error })
  }

  if (name === 'TimeoutError' || /timeout/i.test(message)) {
    return new UploadError('TIMEOUT', '文件上传超时，请重试', { retryable: true, cause: error })
  }

  if (name === 'TypeError' || /failed to fetch|network/i.test(message)) {
    return new UploadError('NETWORK_ERROR', '网络异常，请检查网络后重试', { retryable: true, cause: error })
  }

  return new UploadError('UPLOAD_FAILED', message || '文件上传失败', { retryable: true, cause: error })
}
