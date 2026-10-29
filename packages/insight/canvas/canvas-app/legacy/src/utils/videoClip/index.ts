import { clipWithFfmpeg, preloadFfmpegSource, resetFfmpegSources } from './ffmpegEngine';
import { OUTPUT_EXT, OUTPUT_MIME } from './shared';
import { canUseWebCodecs, clipWithWebCodecs, preloadWebCodecsSource, resetWebCodecsSources } from './webcodecsEngine';

const clipCache = new Map<string, Blob>();

/** 会话内 WebCodecs 失败后降级到 ffmpeg，避免每次白试 */
let webcodecsSessionDegraded = false;

const buildCacheKey = (sourceUrl: string, startSecond: number, endSecond: number): string => `${sourceUrl}|${startSecond.toFixed(3)}|${endSecond.toFixed(3)}`;

export function getCachedClipBlob(sourceUrl: string, startSecond: number, endSecond: number): Blob | undefined {
  return clipCache.get(buildCacheKey(sourceUrl, startSecond, endSecond));
}

export function getClipFileExtension(): string {
  return OUTPUT_EXT;
}

export function getClipMimeType(): string {
  return OUTPUT_MIME;
}

/** 接入视频后后台预热：优先探测 WebCodecs / Range；不可用时加载 ffmpeg */
export async function preloadClipSource(sourceUrl: string): Promise<void> {
  if (!sourceUrl) return;

  if (!webcodecsSessionDegraded) {
    try {
      if (await canUseWebCodecs()) {
        await preloadWebCodecsSource(sourceUrl);
        return;
      }
    } catch {
      // fall through to ffmpeg preload
    }
  }

  await preloadFfmpegSource(sourceUrl);
}

/** 清空 mediabunny Input / ffmpeg MEMFS·WORKERFS / 源 Blob 缓存 */
export async function resetClipSources(): Promise<void> {
  await Promise.all([resetWebCodecsSources(), resetFfmpegSources()]);
}

export async function clipVideo(sourceUrl: string, startSecond: number, endSecond: number): Promise<Blob> {
  const cacheKey = buildCacheKey(sourceUrl, startSecond, endSecond);
  const cached = clipCache.get(cacheKey);
  if (cached) return cached;

  let blob: Blob | null = null;

  if (!webcodecsSessionDegraded && (await canUseWebCodecs())) {
    try {
      blob = await clipWithWebCodecs(sourceUrl, startSecond, endSecond);
    } catch {
      webcodecsSessionDegraded = true;
    }
  }

  if (!blob) {
    blob = await clipWithFfmpeg(sourceUrl, startSecond, endSecond);
  }

  clipCache.set(cacheKey, blob);
  return blob;
}
