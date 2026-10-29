/** 起点距最近关键帧 ≤ 该阈值时走纯流拷贝快路径 */
export const KEYFRAME_SNAP_THRESHOLD_SEC = 0.1;

export const OUTPUT_MIME = 'video/mp4';
export const OUTPUT_EXT = 'mp4';

/** 关键帧距离过远，应改走转码路径（非致命） */
export class KeyframeTooFarError extends Error {
  constructor(distanceSec: number) {
    super(`keyframe snap distance ${distanceSec.toFixed(3)}s exceeds threshold`);
    this.name = 'KeyframeTooFarError';
  }
}

export const guessInputExtension = (sourceUrl: string): string => {
  const cleanUrl = sourceUrl.split('?')[0].split('#')[0].toLowerCase();
  if (cleanUrl.endsWith('.webm')) return 'webm';
  if (cleanUrl.endsWith('.mov')) return 'mov';
  if (cleanUrl.endsWith('.mkv')) return 'mkv';
  return 'mp4';
};

/** 源视频 Blob 缓存，供 WebCodecs / ffmpeg 引擎共用 */
const sourceBlobCache = new Map<string, Blob>();

export function getCachedSourceBlob(sourceUrl: string): Blob | undefined {
  return sourceBlobCache.get(sourceUrl);
}

export function setCachedSourceBlob(sourceUrl: string, blob: Blob): void {
  sourceBlobCache.set(sourceUrl, blob);
}

export function clearSourceBlobCache(): void {
  sourceBlobCache.clear();
}

export async function fetchSourceBlob(sourceUrl: string): Promise<Blob> {
  const cached = sourceBlobCache.get(sourceUrl);
  if (cached) return cached;

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`fetch source failed: ${response.status}`);
  }
  const blob = await response.blob();
  sourceBlobCache.set(sourceUrl, blob);
  return blob;
}
