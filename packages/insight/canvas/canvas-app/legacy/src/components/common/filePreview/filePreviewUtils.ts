import type { FilePreviewItem, FilePreviewType } from './types';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'avif'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'wmv', 'm4v'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma'];
const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'csv'];

export const getUrlExtension = (url: string) => {
  const cleanUrl = url.split('?')[0]?.split('#')[0] || '';
  return cleanUrl.split('.').pop()?.toLowerCase() || '';
};

export const isSafariUserAgent = (userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent) =>
  /^((?!chrome|crios|fxios|edgios|edg|opr|android).)*safari/i.test(userAgent);

export const getImagePreviewStyle = ({
  baseWidth,
  baseHeight,
  zoom,
  offset,
  useNativeImageSizing,
}: {
  baseWidth: number;
  baseHeight: number;
  zoom: number;
  offset: { x: number; y: number };
  useNativeImageSizing: boolean;
}) => ({
  width: baseWidth ? (useNativeImageSizing ? baseWidth * zoom : baseWidth) : undefined,
  height: baseHeight ? (useNativeImageSizing ? baseHeight * zoom : baseHeight) : undefined,
  transform: `translate3d(${offset.x}px, ${offset.y}px, 0)${useNativeImageSizing ? '' : ` scale(${zoom})`}`,
  transformOrigin: 'center center',
});

export const resolveFilePreviewType = (url: string, explicitType?: string | number | null): FilePreviewType => {
  if (typeof explicitType === 'number') {
    if (explicitType === 1) return 'image';
    if (explicitType === 2) return 'video';
    if (explicitType === 3) return 'audio';
    if (explicitType === 4 || explicitType === 5) return 'text';
  }

  const rawType = `${explicitType ?? ''}`.toLowerCase();
  if (rawType.includes('image') || rawType === 'img') return 'image';
  if (rawType.includes('video')) return 'video';
  if (rawType.includes('audio')) return 'audio';
  if (rawType.includes('text')) return 'text';

  const extension = getUrlExtension(url);
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio';
  if (TEXT_EXTENSIONS.includes(extension)) return 'text';

  return 'unknown';
};

export const createFilePreviewItemsFromUrls = (urls: string | string[], explicitTypes?: Array<FilePreviewType | number | undefined>): FilePreviewItem[] => {
  const urlList = Array.isArray(urls) ? urls : [urls];

  return urlList.filter(Boolean).map((url, index) => ({
    id: `${index}-${url}`,
    type: resolveFilePreviewType(url, explicitTypes?.[index]),
    url,
  }));
};

export const formatMediaTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(restMinutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
  }

  return `${String(restMinutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
};

export const getImageFit = (containerWidth: number, containerHeight: number, naturalWidth: number, naturalHeight: number) => {
  if (!containerWidth || !containerHeight || !naturalWidth || !naturalHeight) {
    return {
      fitScale: 1,
      naturalSizeZoom: 1,
      width: 0,
      height: 0,
    };
  }

  const fitScale = Math.min(1, containerWidth / naturalWidth, containerHeight / naturalHeight);

  return {
    fitScale,
    naturalSizeZoom: Math.max(1, 1 / fitScale),
    width: naturalWidth * fitScale,
    height: naturalHeight * fitScale,
  };
};

export const clampImageOffset = ({
  offset,
  containerWidth,
  containerHeight,
  baseWidth,
  baseHeight,
  zoom,
}: {
  offset: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  baseWidth: number;
  baseHeight: number;
  zoom: number;
}) => {
  const renderedWidth = baseWidth * zoom;
  const renderedHeight = baseHeight * zoom;
  const maxX = Math.max(0, (renderedWidth - containerWidth) / 2);
  const maxY = Math.max(0, (renderedHeight - containerHeight) / 2);

  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
};
