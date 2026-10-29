// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
const fixture = vi.hoisted(() => ({ waves: [] as any[], binding: vi.fn(), details: null as any, nodeType: 'audio' }));
vi.mock('../src/canvas-service-binding', () => ({ getCanvasViewBinding: fixture.binding }));
vi.mock('../legacy/src/store/flowStore', () => ({ useFlowStore: (selector: any) => selector({ nodes: [{ id: 'audio-node', type: fixture.nodeType }] }) }));
vi.mock('../legacy/src/components/canvasFlow/components/CanvasAssetPreview/useCanvasAssetPreviewState', () => ({ useCanvasAssetPreviewState: () => ({ detailData: fixture.details }) }));
vi.mock('../legacy/src/components/Asset/AssetDetail/RightPanelSourceParams', () => ({ RightPanelSourceParams: () => null }));
vi.mock('../legacy/src/components/Asset/AssetDetail/toolSourceParamDisplay', () => ({ isToolSourceParam: () => false, resolveToolNodeName: () => '' }));
vi.mock('../legacy/src/components/Asset/util', () => ({ formatCreateTime: () => '', isGeneratedAsset: () => true, typeNumberLabelMap: {} }));
vi.mock('wavesurfer.js', () => ({ default: { create: () => {
  const events = new Map<string, (...args: any[]) => void>();
  const wave = { on: vi.fn((name: string, fn: (...args: any[]) => void) => { events.set(name, fn); return () => events.delete(name); }),
    load: vi.fn().mockResolvedValue(undefined), loadBlob: vi.fn().mockResolvedValue(undefined), playPause: vi.fn().mockResolvedValue(undefined), play: vi.fn().mockResolvedValue(undefined),
    getDuration: () => 3, isPlaying: () => false, pause: vi.fn(), destroy: vi.fn(), emit: (name: string, ...args: any[]) => events.get(name)?.(...args) };
  fixture.waves.push(wave); return wave;
} } }));
import AudioPlayer from '../legacy/src/components/common/fileControl/AudioPlayer';
import CanvasAssetPreview from '../legacy/src/components/canvasFlow/components/CanvasAssetPreview';
import { readAudioSource } from '../legacy/src/components/common/fileControl/audioSource';
let root: Root, container: HTMLDivElement;
const resource = 'https://assets.example/generated.mp3';
const response = () => ({ ok: true, blob: async () => new Blob(['fixture-audio'], { type: 'audio/wav' }) } as Response);
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fixture.waves.length = 0; fixture.binding.mockReset();
  fixture.binding.mockReturnValue({ store: { getState: () => ({ actions: { awaitMutationsIdle: async () => {} } }) } });
  fixture.details = null; fixture.nodeType = 'audio';
  document.head.innerHTML = '<meta name="desktop-canvas-web-origin" content="https://canvas.example">';
  window.history.replaceState({}, '', '/desktop-canvas/view?id=2873');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = async (url = resource) => { await act(async () => root.render(createElement(AudioPlayer, { url, height: 120 }))); };
const click = async () => { await act(async () => container.querySelector('button')!.click()); };

it.each(['generated.mp3', 'uploaded.wav'])('desktop %s uses the protected existing transport and Blob decoder, with duration and play/pause events', async file => {
  const url = 'https://assets.example/' + file; await render(url); const wave = fixture.waves[0];
  expect(fetch).toHaveBeenCalledWith('/desktop-canvas/api/download', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ canvasId: '2873', url }) }));
  expect(wave.load).not.toHaveBeenCalled(); expect(wave.loadBlob).toHaveBeenCalledWith(expect.any(Blob));
  act(() => wave.emit('ready')); expect(container.textContent).toContain('0:03');
  await click(); expect(wave.playPause).toHaveBeenCalledTimes(1);
  act(() => { wave.emit('play'); wave.emit('timeupdate', 1.3); }); expect(container.textContent).toContain('0:01');
  act(() => wave.emit('finish')); expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('播放音频');
});

it('waits for the native save queue so a newly uploaded URL is authorized before reading it', async () => {
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  fixture.binding.mockReturnValue({ store: { getState: () => ({ actions: { awaitMutationsIdle: () => pending } }) } });
  await render(); expect(fetch).not.toHaveBeenCalled();
  await act(async () => { release(); await pending; }); expect(fetch).toHaveBeenCalledTimes(1);
});

it('source change cancels an old read, resets time, and never delivers late bytes into a retired player', async () => {
  let finish!: (value: Response) => void; vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(); const first = fixture.waves[0]; act(() => { first.emit('ready'); first.emit('timeupdate', 2); });
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  await render('https://assets.example/next.wav'); expect(signal?.aborted).toBe(true); expect(first.destroy).toHaveBeenCalledTimes(1);
  await act(async () => { finish(response()); }); expect(first.loadBlob).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('0:02'); expect(fixture.waves[1].loadBlob).toHaveBeenCalledTimes(1);
});

it('read failure is visible, can be retried explicitly, and never opens an external browser', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: '画布无权限' }) } as Response); const open = vi.spyOn(window, 'open');
  await render(); expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/加载失败/); expect(fetch).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('HTTP 403');
  await click(); expect(fetch).toHaveBeenCalledTimes(2); expect(fixture.waves[1].loadBlob).toHaveBeenCalledTimes(1);
  await act(async () => fixture.waves[1].emit('ready')); expect(fixture.waves[1].play).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled(); open.mockRestore();
});

it('decode and playback errors are handled instead of leaving an unhandled rejection', async () => {
  await render(); const wave = fixture.waves[0]; act(() => wave.emit('error', new Error('decode')));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  await click(); expect(fetch).toHaveBeenCalledTimes(2); const next = fixture.waves[1]; act(() => next.emit('ready')); next.playPause.mockRejectedValueOnce(new Error('play denied'));
  await click(); expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/播放失败/);
});

it('a late play rejection cannot mark the replacement audio as failed', async () => {
  await render(); const first = fixture.waves[0]; act(() => first.emit('ready'));
  let reject!: (error: Error) => void; first.playPause.mockReturnValueOnce(new Promise((_resolve, no) => { reject = no; }));
  await click(); await render('https://assets.example/replacement.wav');
  await act(async () => { reject(new Error('retired play')); }); expect(container.querySelector('[role="alert"]')).toBeNull();
});

it.each(['blob:http://localhost/local', 'data:audio/wav;base64,Zml4dHVyZQ=='])('desktop local %s stays local', async url => {
  await render(url); expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'GET' })); expect(fixture.waves[0].loadBlob).toHaveBeenCalledTimes(1);
});

it('standalone Web retains native URL loading and registers ready before a fast load', async () => {
  document.head.innerHTML = ''; await render(); const wave = fixture.waves[0];
  expect(wave.load).toHaveBeenCalledWith(resource); expect(wave.loadBlob).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  const readyIndex = wave.on.mock.calls.findIndex(([name]: [string]) => name === 'ready');
  expect(wave.on.mock.invocationCallOrder[readyIndex]).toBeLessThan(wave.load.mock.invocationCallOrder[0]);
});

it('opening the real node preview reuses the loaded audio instead of downloading it again', async () => {
  await render(); act(() => fixture.waves[0].emit('ready'));
  await act(async () => root.render(createElement(CanvasAssetPreview, { visible: true, nodeId: 'audio-node', urls: [resource], onClose: () => {} })));
  expect(fixture.waves.at(-1).loadBlob).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('audio preview keeps the saved node URL when delayed asset details return a different file URL', async () => {
  const preview = () => createElement(CanvasAssetPreview, { visible: true, nodeId: 'audio-node', urls: [resource], onClose: () => {} });
  await act(async () => root.render(preview()));
  fixture.details = { fileUrl: 'https://assets.example/alternate-signed.mp3', assetType: 3 };
  await act(async () => root.render(preview()));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe(JSON.stringify({ canvasId: '2873', url: resource }));
});

it('audio preview recognizes extensionless audio from its canvas node before details arrive', async () => {
  await act(async () => root.render(createElement(CanvasAssetPreview, { visible: true, nodeId: 'audio-node', urls: ['https://assets.example/object/123'], onClose: () => {} })));
  expect(fixture.waves).toHaveLength(1);
  expect(fixture.waves[0].loadBlob).toHaveBeenCalledTimes(1);
});

it.each([502, 503, 504, 'network'])('retries only one transient read (%s), without reporting a false terminal failure', async status => {
  vi.useFakeTimers();
  if (status === 'network') vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network'));
  else vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status, json: async () => ({ error: '暂时失败' }) } as Response);
  await render(); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('加载中');
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(fetch).toHaveBeenCalledTimes(2); expect(fixture.waves[0].loadBlob).toHaveBeenCalledTimes(1);
});

it.each([400, 401, 403, 413])('does not automatically retry HTTP %s', async status => {
  vi.useFakeTimers(); vi.mocked(fetch).mockResolvedValue({ ok: false, status, json: async () => ({ error: 'rejected' }) } as Response);
  await render(); await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(fetch).toHaveBeenCalledTimes(1); expect(container.textContent).toContain(`HTTP ${status}`);
});

it('stops after two failed reads and cancels a pending retry when the source changes', async () => {
  vi.useFakeTimers(); vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
  await render(); await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(fetch).toHaveBeenCalledTimes(2); expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await render('https://assets.example/retry.wav');
  vi.mocked(fetch).mockResolvedValue(response()); await render('https://assets.example/new.wav');
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(fetch).toHaveBeenCalledTimes(4); expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('cache expires, remains bounded, and never crosses a canvas runtime', async () => {
  vi.useFakeTimers(); const signal = new AbortController().signal;
  await readAudioSource(resource, signal); await readAudioSource(resource, signal); expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120_001); await readAudioSource(resource, signal); expect(fetch).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 4; i++) await readAudioSource(resource + i, signal);
  await readAudioSource(resource, signal); expect(fetch).toHaveBeenCalledTimes(7);
  fixture.binding.mockReturnValue({ store: { getState: () => ({ actions: { awaitMutationsIdle: async () => {} } }) } });
  await readAudioSource(resource, signal); expect(fetch).toHaveBeenCalledTimes(8);
});

it('does not retain oversized audio, and separates canvas IDs even without a runtime binding', async () => {
  const signal = new AbortController().signal;
  const large = new Blob([new Uint8Array(32 * 1024 * 1024 + 1)]);
  vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => large } as Response);
  await readAudioSource(resource, signal); await readAudioSource(resource, signal); expect(fetch).toHaveBeenCalledTimes(2);
  fixture.binding.mockReturnValue(undefined); vi.mocked(fetch).mockResolvedValue(response());
  await readAudioSource(resource, signal); window.history.replaceState({}, '', '/desktop-canvas/view?id=2874');
  await readAudioSource(resource, signal); expect(fetch).toHaveBeenCalledTimes(4);
});

it('closing a player cancels its scheduled retry without a late read', async () => {
  vi.useFakeTimers(); vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
  await render(); await act(async () => root.render(null));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(fetch).toHaveBeenCalledTimes(1);
});

it('blocks playback before ready and treats a cancelled play as non-terminal', async () => {
  await render(); const wave = fixture.waves[0];
  expect(container.querySelector('button')?.disabled).toBe(true);
  await click(); expect(wave.playPause).not.toHaveBeenCalled();
  act(() => wave.emit('ready'));
  wave.playPause.mockRejectedValueOnce(new DOMException('Playback interrupted', 'AbortError'));
  await click(); expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('button')?.disabled).toBe(false);
});

it('standalone Web handles media errors while keeping explicit retry available', async () => {
  document.head.innerHTML = ''; await render();
  act(() => fixture.waves[0].emit('error', new Error('decode')));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('音频加载失败');
  expect(container.querySelector('button')?.disabled).toBe(false);
  await click(); expect(fixture.waves[1].load).toHaveBeenCalledWith(resource);
});
