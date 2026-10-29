import type React from 'react';

export interface ImageThumbnailData {
  src: string;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}

const imageThumbnailCache = new WeakMap<object, Map<string, ImageThumbnailData>>();

const toPositiveNumber = (value: unknown) => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const getCroppedImageThumbnailData = (image: any): ImageThumbnailData | null => {
  const element = typeof image.getElement === 'function' ? image.getElement() : null;
  const src = typeof image.getSrc === 'function' ? image.getSrc() : element?.src || '';
  if (!src) return null;

  const elementWidth = toPositiveNumber(element?.naturalWidth) || toPositiveNumber(element?.width);
  const elementHeight = toPositiveNumber(element?.naturalHeight) || toPositiveNumber(element?.height);
  const rawCropX = toPositiveNumber(image.cropX);
  const rawCropY = toPositiveNumber(image.cropY);
  const rawCropWidth = toPositiveNumber(image.width);
  const rawCropHeight = toPositiveNumber(image.height);
  const naturalWidth = elementWidth || rawCropX + rawCropWidth;
  const naturalHeight = elementHeight || rawCropY + rawCropHeight;
  if (!naturalWidth || !naturalHeight) return null;

  const cropX = clamp(rawCropX, 0, Math.max(0, naturalWidth - 1));
  const cropY = clamp(rawCropY, 0, Math.max(0, naturalHeight - 1));
  const cropWidth = clamp(rawCropWidth || naturalWidth - cropX, 1, naturalWidth - cropX);
  const cropHeight = clamp(rawCropHeight || naturalHeight - cropY, 1, naturalHeight - cropY);

  return {
    src,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    naturalWidth,
    naturalHeight,
  };
};

export const getLowResolutionImageThumbnailData = (image: any, maxSize = 160): ImageThumbnailData | null => {
  const thumbnail = getCroppedImageThumbnailData(image);
  const element = typeof image.getElement === 'function' ? image.getElement() : null;
  if (!thumbnail || !element || typeof document === 'undefined') return thumbnail;

  const cacheKey = [thumbnail.src, thumbnail.cropX, thumbnail.cropY, thumbnail.cropWidth, thumbnail.cropHeight, maxSize].join(':');
  let elementCache = imageThumbnailCache.get(element);
  const cached = elementCache?.get(cacheKey);
  if (cached) return cached;

  try {
    const scale = maxSize / Math.max(thumbnail.cropWidth, thumbnail.cropHeight);
    const width = Math.max(1, Math.round(thumbnail.cropWidth * scale));
    const height = Math.max(1, Math.round(thumbnail.cropHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return thumbnail;

    context.drawImage(element, thumbnail.cropX, thumbnail.cropY, thumbnail.cropWidth, thumbnail.cropHeight, 0, 0, width, height);
    const lowResolutionThumbnail: ImageThumbnailData = {
      src: canvas.toDataURL('image/webp', 0.72),
      cropX: 0,
      cropY: 0,
      cropWidth: width,
      cropHeight: height,
      naturalWidth: width,
      naturalHeight: height,
    };

    if (!elementCache) {
      elementCache = new Map();
      imageThumbnailCache.set(element, elementCache);
    } else if (elementCache.size >= 8) {
      elementCache.clear();
    }
    elementCache.set(cacheKey, lowResolutionThumbnail);

    return lowResolutionThumbnail;
  } catch {
    // 跨域图片可能无法导出 canvas，保留现有裁切展示，不能让缩略图丢失。
    return thumbnail;
  }
};

export const getCroppedImageFrameStyle = (thumbnail: ImageThumbnailData): React.CSSProperties => {
  const isWideCrop = thumbnail.cropWidth >= thumbnail.cropHeight;

  return {
    position: 'relative',
    overflow: 'hidden',
    width: isWideCrop ? '100%' : `${(thumbnail.cropWidth / thumbnail.cropHeight) * 100}%`,
    height: isWideCrop ? `${(thumbnail.cropHeight / thumbnail.cropWidth) * 100}%` : '100%',
  };
};

export const getCroppedImageContentStyle = (thumbnail: ImageThumbnailData): React.CSSProperties => ({
  position: 'absolute',
  width: `${(thumbnail.naturalWidth / thumbnail.cropWidth) * 100}%`,
  height: `${(thumbnail.naturalHeight / thumbnail.cropHeight) * 100}%`,
  left: `-${(thumbnail.cropX / thumbnail.cropWidth) * 100}%`,
  top: `-${(thumbnail.cropY / thumbnail.cropHeight) * 100}%`,
});
