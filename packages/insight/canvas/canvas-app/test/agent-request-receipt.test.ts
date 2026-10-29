import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
import { request } from '../src/request';
const strict = { receiptMode: 'agent' as const, silentError: true };
afterEach(() => vi.unstubAllGlobals());
describe('optional agent request receipts', () => {
  it('labels validation/serialization/pre-abort as not_sent and never fetches', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(request('https://forbidden.example', {}, strict)).rejects.toMatchObject({ requestPhase: 'not_sent' });
    const data: Record<string, unknown> = {}; data.self = data;
    await expect(request('/save', data, strict)).rejects.toMatchObject({ requestPhase: 'not_sent' });
    const controller = new AbortController(); controller.abort();
    await expect(request('/save', {}, { ...strict, signal: controller.signal })).rejects.toMatchObject({ requestPhase: 'not_sent' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403])('keeps definitive auth HTTP %i refusal even with non-JSON body', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status })));
    await expect(request('/save', {}, strict)).rejects.toMatchObject({ requestPhase: 'rejected', status });
  });
  it('preserves a legitimate business refusal including version conflict raw code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 5011, msg: '版本冲突' })));
    await expect(request('/save', {}, strict)).rejects.toMatchObject({ requestPhase: 'rejected', code: 5011, raw: { code: 5011 } });
  });
  it.each([500, 502, 504])('HTTP %i remains sent_unknown even with an error envelope', async status => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ code: 5011, msg: '代理异常' }, { status })); vi.stubGlobal('fetch', fetch);
    await expect(request('/save', {}, strict)).rejects.toMatchObject({ requestPhase: 'sent_unknown', status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('labels network and invalid success bodies unknown; never retries', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(new Response('<html>')).mockResolvedValueOnce(Response.json({ wrong: true })); vi.stubGlobal('fetch', fetch);
    for (let i = 0; i < 3; i++) await expect(request('/save', {}, strict)).rejects.toMatchObject({ requestPhase: 'sent_unknown' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('preserves default UI thrown payload and success shape; strips credentials', async () => {
    const refusal = { code: 4001, msg: '原生提示' };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(refusal)).mockResolvedValueOnce(Response.json({ code: 'SUCCESS', data: { versionNumber: '19' } })); vi.stubGlobal('fetch', fetch);
    await expect(request('/save', {})).rejects.toEqual(refusal);
    await expect(request('/save', {}, { ...strict, headers: { token: 'private', authorization: 'private' } })).resolves.toEqual({ code: 'SUCCESS', data: { versionNumber: '19' } });
    const headers = fetch.mock.calls[1][1].headers as Headers;
    expect(headers.has('token')).toBe(false); expect(headers.has('authorization')).toBe(false);
  });
});
