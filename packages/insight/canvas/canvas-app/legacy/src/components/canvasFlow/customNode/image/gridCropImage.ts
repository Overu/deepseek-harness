import { createConcurrencyLimiter, PUBLIC_UPLOAD_CONCURRENCY } from '@/components/common/uploadFile/concurrency';
import { uploadFile } from '@/services/upload/uploadFile';
import { GRID_CROP_MAX_SIZE } from './gridCropConfig';

export interface GridCropRect {
  index: number;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UploadedGridCrop extends GridCropRect {
  url: string;
}

interface CropAndUploadGridImageOptions {
  url: string;
  sourceNodeId: string;
  columns: number;
  rows: number;
  signal: AbortSignal;
}

class GridCropImageLoadError extends Error {
  name = 'GridCropImageLoadError';
}

export class GridCropAbortError extends Error {
  constructor() {
    super('已取消宫格裁切');
  }
}

export const isGridCropAbortError = (error: unknown): error is GridCropAbortError => error instanceof GridCropAbortError;

const assertPositiveInteger = (value: number, field: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field}必须为正整数`);
  }
};

export const getGridCropRects = (imageWidth: number, imageHeight: number, columns: number, rows: number): GridCropRect[] => {
  assertPositiveInteger(imageWidth, '图片宽度');
  assertPositiveInteger(imageHeight, '图片高度');
  assertPositiveInteger(columns, '宫格列数');
  assertPositiveInteger(rows, '宫格行数');

  if (columns > GRID_CROP_MAX_SIZE || rows > GRID_CROP_MAX_SIZE) {
    throw new Error(`宫格行列数不能超过 ${GRID_CROP_MAX_SIZE}`);
  }
  if (imageWidth < columns || imageHeight < rows) {
    throw new Error('图片尺寸不足以进行当前宫格裁切');
  }

  return Array.from({ length: rows * columns }, (_, index) => {
    const rowIndex = Math.floor(index / columns);
    const columnIndex = index % columns;
    const x = Math.floor((columnIndex * imageWidth) / columns);
    const y = Math.floor((rowIndex * imageHeight) / rows);
    const right = Math.floor(((columnIndex + 1) * imageWidth) / columns);
    const bottom = Math.floor(((rowIndex + 1) * imageHeight) / rows);

    return {
      index,
      row: rowIndex + 1,
      column: columnIndex + 1,
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  });
};

const loadBlobImage = (url: string, signal: AbortSignal) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
      image.onload = null;
      image.onerror = null;
    };
    const handleAbort = () => {
      cleanup();
      image.src = '';
      reject(new GridCropAbortError());
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener('abort', handleAbort, { once: true });
    image.decoding = 'async';
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new GridCropImageLoadError('图片加载失败，请检查图片地址或跨域配置'));
    };
    image.src = url;
  });

const loadImage = async (url: string, signal: AbortSignal) => {
  let objectUrl = '';
  try {
    const response = await fetch(url, { mode: 'cors', signal });
    if (!response.ok) throw new GridCropImageLoadError(`图片加载失败（${response.status}）`);
    objectUrl = URL.createObjectURL(await response.blob());
    return await loadBlobImage(objectUrl, signal);
  } catch (error) {
    if (signal.aborted || isGridCropAbortError(error)) throw new GridCropAbortError();
    if (error instanceof GridCropImageLoadError) throw error;
    throw new GridCropImageLoadError('图片加载失败，请重试');
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
};

const cropImageToBlob = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, image: HTMLImageElement, rect: GridCropRect) =>
  new Promise<Blob>((resolve, reject) => {
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    } else {
      context.clearRect(0, 0, rect.width, rect.height);
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('图片裁切失败'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });

export const cropAndUploadGridImage = async ({ url, sourceNodeId, columns, rows, signal }: CropAndUploadGridImageOptions): Promise<UploadedGridCrop[]> => {
  try {
    const image = await loadImage(url, signal);
    const rects = getGridCropRects(image.naturalWidth, image.naturalHeight, columns, rows);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const files = [];

    for (const rect of rects) {
      if (signal.aborted) throw new GridCropAbortError();
      const blob = await cropImageToBlob(canvas, context, image, rect);
      files.push({
        rect,
        file: new File([blob], `grid-crop-${sourceNodeId}-${rect.row}-${rect.column}.png`, { type: 'image/png' }),
      });
    }

    const limit = createConcurrencyLimiter(PUBLIC_UPLOAD_CONCURRENCY);
    return await Promise.all(
      files.map(({ rect, file }) =>
        limit(async () => {
          if (signal.aborted) throw new GridCropAbortError();
          const result = await uploadFile(file, { signal });
          return { ...rect, url: result.url };
        })
      )
    );
  } catch (error) {
    if (signal.aborted || isGridCropAbortError(error)) throw new GridCropAbortError();
    throw error;
  }
};
