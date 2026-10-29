import { downloadBlob, ResourceDownloadError } from '@/utils';
import { getCanvasViewBinding } from '../../../../../src/canvas-service-binding';

const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const CACHE_MS = 2 * 60_000;
type Entry = { blob: Blob; expires: number };
// Each canvas runtime owns its short-lived, bounded cache; no disk or shared account cache.
const caches = new WeakMap<object, Map<string, Entry>>();
function currentCache() {
  const owner = getCanvasViewBinding()?.store ?? document;
  let cache = caches.get(owner);
  if (!cache) { cache = new Map(); caches.set(owner, cache); }
  return cache;
}
const keyFor = (url: string) => JSON.stringify([new URLSearchParams(location.search).get('id'), url]);
const remote = (url: string) => !url.startsWith('blob:') && !url.startsWith('data:');

export function forgetAudioSource(url: string) { currentCache().delete(keyFor(url)); }

export async function readAudioSource(url: string, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (!remote(url)) return downloadBlob(url, signal);
  await getCanvasViewBinding()?.store.getState().actions.awaitMutationsIdle();
  signal.throwIfAborted();
  const cache = currentCache(), key = keyFor(url);
  for (const [id, entry] of cache) if (entry.expires <= Date.now()) cache.delete(id);
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached.blob; }

  let blob: Blob;
  try { blob = await downloadBlob(url, signal); }
  catch (error) {
    // Only repeat a read after a transient transport failure, never permissions or decoding.
    if (signal.aborted || !(error instanceof TypeError || error instanceof ResourceDownloadError && [502, 503, 504].includes(error.status))) throw error;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 300);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    blob = await downloadBlob(url, signal);
  }
  signal.throwIfAborted();
  if (blob.size <= MAX_CACHE_BYTES) {
    let bytes = blob.size;
    for (const entry of cache.values()) bytes += entry.blob.size;
    while (cache.size && (cache.size >= 4 || bytes > MAX_CACHE_BYTES)) {
      const oldest = cache.keys().next().value!;
      bytes -= cache.get(oldest)!.blob.size; cache.delete(oldest);
    }
    cache.set(key, { blob, expires: Date.now() + CACHE_MS });
  }
  return blob;
}
