// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
import { downloadFile, downloadFilesAsZip } from '../legacy/src/utils';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('lazy native download feedback compatibility', () => {
  it('still shows the original notice before fetching and performs the original anchor download', async () => {
    const NativeURL = URL;
    vi.stubGlobal('URL', class extends NativeURL { static createObjectURL() { return 'blob:fixture'; } static revokeObjectURL() {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockImplementation(async () => { expect(toast.success).toHaveBeenCalledWith('文件下载中'); return new Response('fixture'); });
    vi.stubGlobal('fetch', fetchMock);
    await downloadFile('https://example.com/file.png', 'file.png');
    expect(click).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1); expect(document.querySelector('a')).toBeNull();
  });
  it('an empty ZIP request still performs no fetch or UI feedback', async () => {
    vi.clearAllMocks(); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await downloadFilesAsZip([]); expect(fetchMock).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
  });
});
