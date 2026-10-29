import { getFileType } from '@/utils/index';

const MEDIA_METADATA_TIMEOUT_MS = 10_000;
const durationPromiseCache = new WeakMap<File, Promise<number | undefined>>();

type MediaElementType = 'audio' | 'video';

function resolveMediaElementType(file: File): MediaElementType | undefined {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';

  const fileType = getFileType(file.name);
  return fileType === 'audio' || fileType === 'video' ? fileType : undefined;
}

export function normalizeMediaDurationSeconds(duration: number): number | undefined {
  return Number.isFinite(duration) && duration > 0 ? Math.ceil(duration) : undefined;
}

function readMediaDuration(file: File): Promise<number | undefined> {
  const mediaType = resolveMediaElementType(file);
  if (!mediaType || typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(undefined);
  }

  let objectUrl: string;
  try {
    objectUrl = URL.createObjectURL(file);
  } catch {
    return Promise.resolve(undefined);
  }

  return new Promise(resolve => {
    const media = document.createElement(mediaType);
    let settled = false;

    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      media.onloadedmetadata = null;
      media.onerror = null;
      URL.revokeObjectURL(objectUrl);
      resolve(duration);
    };

    const timeoutId = setTimeout(() => finish(), MEDIA_METADATA_TIMEOUT_MS);
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      const duration = media.duration;
      finish(Number.isFinite(duration) && duration > 0 ? duration : undefined);
    };
    media.onerror = () => finish();
    media.src = objectUrl;
  });
}

/** 读取并复用同一 File 的原始时长；失败时返回 undefined，不阻断文件上传。 */
export function getMediaDuration(file: File): Promise<number | undefined> {
  const cachedDuration = durationPromiseCache.get(file);
  if (cachedDuration) return cachedDuration;

  const durationPromise = readMediaDuration(file);
  durationPromiseCache.set(file, durationPromise);
  return durationPromise;
}

export async function getMediaDurationSeconds(file: File): Promise<number | undefined> {
  const duration = await getMediaDuration(file);
  return duration === undefined ? undefined : normalizeMediaDurationSeconds(duration);
}
