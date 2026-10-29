import type { CoverCropRect } from './types';

export const COVER_CROP_ASPECT = 16 / 9;
export const COVER_OUTPUT_WIDTH = 1200;
export const COVER_OUTPUT_HEIGHT = 675;

export interface CoverCropSize {
  width: number;
  height: number;
}

export interface CoverCropPoint {
  x: number;
  y: number;
}

export interface CoverCropTransform extends CoverCropPoint {
  scale: number;
  displayWidth: number;
  displayHeight: number;
}

export const isValidSize = (size: CoverCropSize) => size.width > 0 && size.height > 0;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const clampPan = (pan: CoverCropPoint, mediaSize: CoverCropSize, frameSize: CoverCropSize, scale: number): CoverCropPoint => {
  const displayWidth = mediaSize.width * scale;
  const displayHeight = mediaSize.height * scale;
  const minX = frameSize.width - displayWidth;
  const minY = frameSize.height - displayHeight;

  return {
    x: displayWidth <= frameSize.width ? (frameSize.width - displayWidth) / 2 : clamp(pan.x, minX, 0),
    y: displayHeight <= frameSize.height ? (frameSize.height - displayHeight) / 2 : clamp(pan.y, minY, 0),
  };
};

export const getInitialTransform = (mediaSize: CoverCropSize, frameSize: CoverCropSize): CoverCropTransform => {
  if (!isValidSize(mediaSize) || !isValidSize(frameSize)) {
    return {
      x: 0,
      y: 0,
      scale: 1,
      displayWidth: frameSize.width,
      displayHeight: frameSize.height,
    };
  }

  const scale = Math.max(frameSize.width / mediaSize.width, frameSize.height / mediaSize.height);
  const displayWidth = mediaSize.width * scale;
  const displayHeight = mediaSize.height * scale;
  const pan = clampPan(
    {
      x: (frameSize.width - displayWidth) / 2,
      y: (frameSize.height - displayHeight) / 2,
    },
    mediaSize,
    frameSize,
    scale
  );

  return {
    ...pan,
    scale,
    displayWidth,
    displayHeight,
  };
};

export const getExportCropRect = (
  transform: CoverCropTransform,
  mediaSize: CoverCropSize,
  frameSize: CoverCropSize,
  outputSize: CoverCropSize = {
    width: COVER_OUTPUT_WIDTH,
    height: COVER_OUTPUT_HEIGHT,
  }
): CoverCropRect => {
  const sourceWidth = frameSize.width / transform.scale;
  const sourceHeight = frameSize.height / transform.scale;
  const sourceX = clamp(-transform.x / transform.scale, 0, Math.max(mediaSize.width - sourceWidth, 0));
  const sourceY = clamp(-transform.y / transform.scale, 0, Math.max(mediaSize.height - sourceHeight, 0));

  return {
    aspect: COVER_CROP_ASPECT,
    sourceX,
    sourceY,
    sourceWidth: Math.min(sourceWidth, mediaSize.width),
    sourceHeight: Math.min(sourceHeight, mediaSize.height),
    outputWidth: outputSize.width,
    outputHeight: outputSize.height,
  };
};

export const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';

  const safeSeconds = Math.floor(seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
};
