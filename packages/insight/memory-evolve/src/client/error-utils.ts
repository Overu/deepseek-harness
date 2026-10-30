/** Convert an unknown rejection reason to displayable text. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read an error message from an untrusted JSON response body. */
export function responseError(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined
  return typeof body.error === 'string' ? body.error : undefined
}
