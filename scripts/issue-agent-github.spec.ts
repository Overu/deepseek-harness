/** Issue Agent transport rejects unauthorized reads and never reports credentials in failures. */
import { expect, it, vi } from 'vitest'
import { createApi } from '../.github/issue-agent/github.mjs'

it('keeps credentials in headers and JSON-encodes request data', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"id":123}', { status: 201 }))
  const api = createApi({ token: 'test-only-credential', fetchImpl })
  await expect(api('/repos/owner/repo/issues/1/comments', { method: 'POST', body: { body: 'Issue reply' } }))
    .resolves.toEqual({ id: 123 })
  expect(fetchImpl).toHaveBeenCalledWith('https://api.github.com/repos/owner/repo/issues/1/comments', expect.objectContaining({
    method: 'POST',
    body: '{"body":"Issue reply"}',
  }))
  const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
  expect(headers.get('Authorization')).toBe('Bearer test-only-credential')
})

it('fails closed on permission errors without echoing the API body or token', async () => {
  const api = createApi({
    token: 'test-only-credential',
    fetchImpl: async () => new Response('untrusted response contents', { status: 403 }),
  })
  await expect(api('/repos/owner/repo/collaborators/user/permission'))
    .rejects.toThrow('HTTP 403; check Actions permissions and the run log')
  await expect(api('/repos/owner/repo/collaborators/user/permission', { allow404: true })).rejects.not.toThrow('credential')
})

it('permits only explicitly allowed absent records and handles empty success responses', async () => {
  const absent = createApi({ token: 'placeholder', fetchImpl: async () => new Response(null, { status: 404 }) })
  await expect(absent('/repos/owner/repo/git/ref/heads/missing', { allow404: true })).resolves.toBeNull()
  await expect(absent('/repos/owner/repo/git/ref/heads/missing')).rejects.toThrow('HTTP 404')
  const empty = createApi({ token: 'placeholder', fetchImpl: async () => new Response(null, { status: 204 }) })
  await expect(empty('/repos/owner/repo/issues/1/labels/name', { method: 'DELETE' })).resolves.toBeNull()
})

it('rejects requests outside the trusted API before sending credentials', async () => {
  const fetchImpl = vi.fn()
  const api = createApi({ token: 'placeholder', fetchImpl })
  await expect(api('https://another.example')).rejects.toThrow('repository-relative')
  await expect(api('//another.example')).rejects.toThrow('repository-relative')
  expect(fetchImpl).not.toHaveBeenCalled()
  expect(() => createApi({ token: '' })).toThrow('missing')
})
