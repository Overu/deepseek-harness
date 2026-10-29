const durationCache = new Map<string, number | null>();
const pendingRequests = new Map<string, Promise<number | null>>();

export interface VideoPricingContext {
  totalInputVideoSec: number;
  hasVideoInput: boolean;
}

/** 将媒体时长（秒）格式化为 MM:SS，超过一小时后格式化为 HH:MM:SS */
export function formatDuration(duration: number): string {
  const totalSeconds = Math.floor(duration);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 通过 URL（含 blob）读取视频时长（秒），失败返回 null */
export function getVideoDurationFromUrl(url: string): Promise<number | null> {
  if (!url) return Promise.resolve(null);

  if (durationCache.has(url)) {
    return Promise.resolve(durationCache.get(url) ?? null);
  }

  const pending = pendingRequests.get(url);
  if (pending) return pending;

  const request = new Promise<number | null>(resolve => {
    const video = document.createElement('video');
    const done = (value: number | null) => {
      video.removeAttribute('src');
      video.load();
      durationCache.set(url, value);
      pendingRequests.delete(url);
      resolve(value);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const d = video.duration;
      done(!Number.isFinite(d) || d <= 0 ? null : d);
    };
    video.onerror = () => done(null);
    video.src = url;
  });

  pendingRequests.set(url, request);
  return request;
}

/** 批量求和视频时长；相同 URL 重复出现会叠加；读取失败的单项按 0 累加 */
export async function getTotalVideoDurationFromUrls(urls: string[]): Promise<number> {
  const validUrls = urls.filter(Boolean);
  if (!validUrls.length) return 0;
  const durations = await Promise.all(validUrls.map(url => getVideoDurationFromUrl(url)));
  return durations.reduce<number>((total, d) => total + (d ?? 0), 0);
}

/** 由连线视频 URL 构建赛点计费用时长上下文 */
export async function resolveVideoPricingContext(urls: string[]): Promise<VideoPricingContext> {
  const videoUrls = urls.filter(Boolean);
  if (!videoUrls.length) {
    return { totalInputVideoSec: 0, hasVideoInput: false };
  }
  return {
    totalInputVideoSec: await getTotalVideoDurationFromUrls(videoUrls),
    hasVideoInput: true,
  };
}
