// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { downloadFile, downloadFilesAsZip, downloadPptFile } from '../legacy/src/utils';

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const resource = 'https://assets.example/image.png?Signature=fixture';
let saved: Blob[];
beforeEach(() => {
  document.head.innerHTML = '<meta name="desktop-canvas-web-origin" content="https://canvas.example">';
  window.history.replaceState({}, '', '/desktop-canvas/view?id=2873');
  saved = [];
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => { saved.push(blob); return 'blob:http://localhost/fixture'; }),
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const bytes = (text: string) => new Blob([text]);
const succeed = (text: string) => ({ ok: true, blob: async () => bytes(text) });

it('desktop node download uses an authenticated same-origin transport and a local download link', async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).startsWith('https:')) throw new TypeError('Blocked by connect-src self');
    return succeed('original-image') as Response;
  });
  await downloadFile(resource, '耳机.png');
  expect(fetch).toHaveBeenCalledWith('/desktop-canvas/api/download', expect.objectContaining({
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ canvasId: '2873', url: resource }),
  }));
  expect(saved).toHaveLength(1);
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  expect(window.open).not.toHaveBeenCalled();
});

it.each(['http', 'network'])('desktop %s failure reports an error without opening the browser or claiming success', async mode => {
  vi.mocked(fetch).mockImplementation(async () => {
    if (mode === 'network') throw new TypeError('network unavailable');
    return { ok: false, status: 404, json: async () => ({ error: '资源已失效' }) } as Response;
  });
  await downloadFile(resource);
  expect(window.open).not.toHaveBeenCalled();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

it('desktop PPT/PDF download reuses the same transport rather than creating an external tab', async () => {
  vi.mocked(fetch).mockResolvedValue(succeed('pdf-bytes') as Response);
  await downloadPptFile('https://assets.example/file.pdf', '资料.pdf');
  expect(fetch).toHaveBeenCalledWith('/desktop-canvas/api/download', expect.any(Object));
  expect(window.open).not.toHaveBeenCalled();
  expect(saved).toHaveLength(1);
});

it('desktop ZIP uses the same transport, retains duplicate-name handling and skips only failed resources', async () => {
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const value = JSON.parse(String(init?.body)).url;
    return value.endsWith('missing') ? { ok: false, status: 404, json: async () => ({ error: 'missing' }) } as Response : succeed(value) as Response;
  });
  await downloadFilesAsZip([{ url: resource, filename: '耳机.png' }, { url: resource, filename: '耳机.png' }, { url: resource + 'missing', filename: '失效.png' }], '海报.zip');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(vi.mocked(fetch).mock.calls.every(([url]) => url === '/desktop-canvas/api/download')).toBe(true);
  expect(saved).toHaveLength(1);
  const archive = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(saved[0]);
  });
  const zip = await JSZip.loadAsync(archive);
  expect(Object.keys(zip.files)).toEqual(['耳机.png', '耳机_1.png']);
  expect(toast.warning).toHaveBeenCalledWith('已跳过 1 个下载失败的文件');
  expect(window.open).not.toHaveBeenCalled();
});

it('desktop download without a canvas identity fails locally instead of requesting arbitrary resources', async () => {
  window.history.replaceState({}, '', '/desktop-canvas/view');
  await downloadFile(resource);
  expect(fetch).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith('请从当前画布下载资源');
});

it('desktop local Blob/Data resources stay in the browser and never reach the Host resource proxy', async () => {
  vi.mocked(fetch).mockResolvedValue(succeed('local-file') as Response);
  for (const url of ['blob:http://localhost/local', 'data:text/plain,local']) await downloadFile(url, 'local.txt');
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['blob:http://localhost/local', 'data:text/plain,local']);
  expect(saved).toHaveLength(2);
  expect(window.open).not.toHaveBeenCalled();
});

it('standalone Web downloads retain the existing direct fetch and fallback', async () => {
  document.head.innerHTML = '';
  vi.mocked(fetch).mockRejectedValue(new TypeError('CORS'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await downloadFile(resource);
  expect(fetch).toHaveBeenCalledWith(resource, expect.objectContaining({ mode: 'cors' }));
  expect(window.open).toHaveBeenCalledWith(resource, '_blank');
});
