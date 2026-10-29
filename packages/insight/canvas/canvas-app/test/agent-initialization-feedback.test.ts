// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
import { request, CANVAS_LOAD_ERROR_EVENT } from '../src/request';
import { AUTH_EXPIRED_EVENT } from '../src/auth-context';

afterEach(() => { vi.unstubAllGlobals(); });
describe('service initialization request feedback', () => {
  it.each([401, 403])('notifies the context once on HTTP %i even with a non-JSON body, without default UI events', async status => {
    const auth = vi.fn(); const load = vi.fn(); const nativeAuth = vi.fn(); const nativeLoad = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, nativeAuth); window.addEventListener(CANVAS_LOAD_ERROR_EVENT, nativeLoad);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON', { status })));
    try {
      await expect(request('game-ai-editor-center/api/canvas/get', { id: '2873' }, { silentError: true, onAuthExpired: auth, onCanvasLoadError: load })).rejects.toThrow();
      expect(auth).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1); expect(nativeAuth).not.toHaveBeenCalled(); expect(nativeLoad).not.toHaveBeenCalled();
    } finally { window.removeEventListener(AUTH_EXPIRED_EVENT, nativeAuth); window.removeEventListener(CANVAS_LOAD_ERROR_EVENT, nativeLoad); }
  });
  it('keeps native auth/load-error events when no callbacks are supplied', async () => {
    const auth = vi.fn(); const load = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, auth); window.addEventListener(CANVAS_LOAD_ERROR_EVENT, load);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'USER_NOT_LOGIN' }, { status: 401 })));
    try {
      await expect(request('game-ai-editor-center/api/canvas/get', { id: '2873' })).rejects.toThrow();
      expect(auth).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(AUTH_EXPIRED_EVENT, auth); window.removeEventListener(CANVAS_LOAD_ERROR_EVENT, load); }
  });
});
