import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUserStore } from '../legacy/src/store/userStore';
import { getUploadCredentials } from '../legacy/src/services/upload/credentialProvider';
import { uploadToAliyunOss } from '../legacy/src/services/upload/providers/aliyunOssProvider';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('ali-oss', () => ({ default: class {
  constructor(private options: { refreshSTSToken: () => Promise<unknown> }) {}
  async put() {
    await this.options.refreshSTSToken();
    return { url: 'https://insight-canvas.oss-cn-hangzhou.aliyuncs.com/audio/stored.wav' };
  }
} }));
const credentials = (userId: string | number = '9223372036854775807') => ({
  userId, accessKeyId: 'key', accessKeySecret: 'secret', securityToken: 'sts',
  bucket: 'insight-canvas', region: 'oss-cn-hangzhou', dir: 'audio/',
  expiration: new Date(Date.now() + 60_000).toISOString(),
});
afterEach(() => vi.unstubAllGlobals());

describe('Host-owned manual upload identity', () => {
  it('requests credentials with no loaded user profile and no client userId', async () => {
    useUserStore.setState({ userInfo: null });
    const fetch = vi.fn().mockResolvedValue(Response.json({ code: 'SUCCESS', data: credentials() }));
    vi.stubGlobal('fetch', fetch);
    await expect(getUploadCredentials('voice.wav')).resolves.toMatchObject({ userId: '9223372036854775807' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/desktop-canvas/api/legacy/game-ai-editor-center/upload/sts/token');
    expect(JSON.parse(init.body)).toEqual({ fileName: 'voice.wav', libraryId: '1001', type: 1 });
  });

  it('requests fresh credentials after account changes instead of reusing an iframe cache', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'SUCCESS', data: credentials(103) }))
      .mockResolvedValueOnce(Response.json({ code: 'SUCCESS', data: credentials(104) }));
    vi.stubGlobal('fetch', fetch);
    expect((await getUploadCredentials('voice.wav')).userId).toBe('103');
    expect((await getUploadCredentials('voice.wav')).userId).toBe('104');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([103, 104])('only refreshes an active upload for its original user (refreshed user %i)', async userId => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'SUCCESS', data: credentials(103) }))
      .mockResolvedValueOnce(Response.json({ code: 'SUCCESS', data: credentials(userId) })));
    const initial = await getUploadCredentials('voice.wav');
    const upload = uploadToAliyunOss(new File(['audio'], 'voice.wav', { type: 'audio/wav' }), initial, 'stored.wav', {});
    if (userId === 103) await expect(upload).resolves.toMatchObject({ storedFileName: 'stored.wav' });
    else await expect(upload).rejects.toMatchObject({ code: 'INVALID_STS_RESPONSE' });
  });

  it.each([
    { userId: '0' }, { userId: '9223372036854775808' }, { userId: 9223372036854775807 },
    { securityToken: '' }, { expiration: 'invalid' }, { expiration: new Date(0).toISOString() },
  ])('rejects invalid or expired credentials: %j', async patch => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'SUCCESS', data: { ...credentials(), ...patch } })));
    await expect(getUploadCredentials('voice.wav')).rejects.toMatchObject({
      code: 'expiration' in patch ? 'STS_EXPIRED' : 'INVALID_STS_RESPONSE',
    });
  });
});
