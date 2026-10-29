const TIMELINE_FRAME_COUNT = 10;
const CROP_CORS_CACHE_VERSION = '20260804';
const ALIYUN_OSS_SIGNED_QUERY_KEYS = new Set(['signature', 'ossaccesskeyid', 'x-oss-signature', 'x-oss-credential']);

export const waitForEvent = (element: HTMLElement, eventName: string) =>
  new Promise<void>((resolve, reject) => {
    const handleEvent = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('媒体加载失败'));
    };
    const cleanup = () => {
      element.removeEventListener(eventName, handleEvent);
      element.removeEventListener('error', handleError);
    };

    element.addEventListener(eventName, handleEvent, { once: true });
    element.addEventListener('error', handleError, { once: true });
  });

export const canvasToBlob = (canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92) =>
  new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error('封面截图生成失败'));
            return;
          }

          resolve(blob);
        },
        type,
        quality
      );
    } catch (error) {
      reject(error);
    }
  });

export const loadCrossOriginImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = url;
  });

export const isAliyunOssUrl = (url: string) => /aliyuncs\.com/i.test(url);

export const getCropMediaUrl = (url: string) => {
  if (!url) return '';

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'aliyuncs.com' && !parsedUrl.hostname.endsWith('.aliyuncs.com')) return url;

    const hasSignedQuery = Array.from(parsedUrl.searchParams.keys()).some(key => ALIYUN_OSS_SIGNED_QUERY_KEYS.has(key.toLowerCase()));
    if (hasSignedQuery) return url;

    const [withoutHash, hash] = url.split('#');
    if (/[?&]crop-cors-v=/.test(withoutHash)) return url;

    const separator = withoutHash.includes('?') ? '&' : '?';
    return `${withoutHash}${separator}crop-cors-v=${CROP_CORS_CACHE_VERSION}${hash ? `#${hash}` : ''}`;
  } catch {
    return url;
  }
};

const appendOssProcess = (url: string, process: string) => {
  const [withoutHash, hash] = url.split('#');
  const [base, query = ''] = withoutHash.split('?');
  const keptQuery = query
    .split('&')
    .filter(item => item && !item.startsWith('x-oss-process='))
    .join('&');
  const separator = keptQuery ? `?${keptQuery}&` : '?';

  return `${base}${separator}x-oss-process=${process}${hash ? `#${hash}` : ''}`;
};

const getSnapshotTime = (time: number, duration: number) => {
  if (!Number.isFinite(time) || time <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return time;

  return Math.min(time, Math.max(duration - 0.05, 0));
};

export const getVideoSnapshotUrl = (url: string, time: number, duration: number, width: number) =>
  appendOssProcess(url, `video/snapshot,t_${Math.round(getSnapshotTime(time, duration) * 1000)},f_jpg,w_${width},h_0`);

export const getTimelineFrames = (url: string, duration: number) => {
  if (!url || !Number.isFinite(duration) || duration <= 0) return [];

  return Array.from({ length: TIMELINE_FRAME_COUNT }, (_, index) => {
    const time = TIMELINE_FRAME_COUNT === 1 ? 0 : (duration * index) / (TIMELINE_FRAME_COUNT - 1);

    return {
      time,
      url: getVideoSnapshotUrl(url, time, duration, 180),
    };
  });
};

export const seekVideo = (video: HTMLVideoElement, time: number, fast = false) => {
  if (fast && typeof video.fastSeek === 'function') {
    video.fastSeek(time);
    return;
  }

  video.currentTime = time;
};

export const waitForVideoSeek = async (video: HTMLVideoElement, time: number, fast = false) => {
  const nextTime = Math.min(Math.max(time, 0), Number.isFinite(video.duration) ? video.duration : time);

  if (Math.abs(video.currentTime - nextTime) < 0.04 && !video.seeking) {
    return;
  }

  const seeked = waitForEvent(video, 'seeked');
  seekVideo(video, nextTime, fast);
  await seeked;
};
