import { compressImage } from '@/utils';
import type { IntrinsicMediaDimensions, MediaDimensionType } from './mediaDimensions';

const MEDIA_DIMENSION_TIMEOUT_MS = 3000;
const MEDIA_DIMENSION_CACHE_LIMIT = 128;

const resultCache = new Map<string, IntrinsicMediaDimensions>();
const inFlightRequests = new Map<string, Promise<IntrinsicMediaDimensions | null>>();
const pendingTasks: Array<() => void> = [];

let activeTaskCount = 0;

const isSafari = () => {
  if (typeof navigator === 'undefined') return false;
  return /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg/i.test(navigator.userAgent);
};

const getConcurrencyLimit = () => (isSafari() ? 2 : 8);

const getCacheKey = (mediaType: MediaDimensionType, url: string) => `${mediaType}:${url}`;

const getCachedResult = (key: string): IntrinsicMediaDimensions | null => {
  const cached = resultCache.get(key);
  if (!cached) return null;

  resultCache.delete(key);
  resultCache.set(key, cached);
  return { ...cached };
};

const setCachedResult = (key: string, dimensions: IntrinsicMediaDimensions) => {
  resultCache.delete(key);
  resultCache.set(key, { ...dimensions });

  while (resultCache.size > MEDIA_DIMENSION_CACHE_LIMIT) {
    const oldestKey = resultCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    resultCache.delete(oldestKey);
  }
};

const drainTaskQueue = () => {
  const limit = getConcurrencyLimit();
  while (activeTaskCount < limit && pendingTasks.length) {
    const task = pendingTasks.shift();
    if (!task) break;
    activeTaskCount += 1;
    task();
  }
};

const scheduleTask = (load: () => Promise<IntrinsicMediaDimensions | null>): Promise<IntrinsicMediaDimensions | null> => {
  return new Promise(resolve => {
    pendingTasks.push(() => {
      void load()
        .then(resolve)
        .catch(() => resolve(null))
        .finally(() => {
          activeTaskCount -= 1;
          drainTaskQueue();
        });
    });
    drainTaskQueue();
  });
};

const loadImageDimensions = (url: string): Promise<IntrinsicMediaDimensions | null> => {
  if (!url || typeof Image === 'undefined') return Promise.resolve(null);

  return new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const timer = setTimeout(() => finish(null), MEDIA_DIMENSION_TIMEOUT_MS);

    function finish(result: IntrinsicMediaDimensions | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      image.src = '';
      resolve(result);
    }

    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      finish(width > 0 && height > 0 ? { width, height } : null);
    };
    image.onerror = () => finish(null);
    image.src = compressImage(url) || url;
  });
};

const loadVideoDimensions = (url: string): Promise<IntrinsicMediaDimensions | null> => {
  if (!url || typeof document === 'undefined') return Promise.resolve(null);

  return new Promise(resolve => {
    const video = document.createElement('video');
    let settled = false;
    const timer = setTimeout(() => finish(null), MEDIA_DIMENSION_TIMEOUT_MS);

    function finish(result: IntrinsicMediaDimensions | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      resolve(result);
    }

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      finish(width > 0 && height > 0 ? { width, height } : null);
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
};

export const loadIntrinsicMediaDimensions = (mediaType: MediaDimensionType, url: string): Promise<IntrinsicMediaDimensions | null> => {
  if (!url) return Promise.resolve(null);

  const key = getCacheKey(mediaType, url);
  const cached = getCachedResult(key);
  if (cached) return Promise.resolve(cached);

  const inFlight = inFlightRequests.get(key);
  if (inFlight) return inFlight;

  const request = scheduleTask(() => (mediaType === 'image' ? loadImageDimensions(url) : loadVideoDimensions(url)))
    .then(result => {
      if (result) setCachedResult(key, result);
      return result ? { ...result } : null;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, request);
  return request;
};
