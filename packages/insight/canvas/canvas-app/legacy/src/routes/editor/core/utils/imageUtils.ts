import { DEFAULT_WORKSPACE_WIDTH, DEFAULT_WORKSPACE_HEIGHT } from '../constants';

export interface ImageDimension {
  width: number;
  height: number;
}

/** 从 URL 提取文件名 hash */
export function extractFileHash(url: string): string {
  const filename = url.split('/').pop() || '';
  return filename.split('.')[0];
}

/** 获取单张图片尺寸 */
export function getImageDimension(url: string): Promise<ImageDimension> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

/** 计算多张图片的最大宽高 */
export async function calculateMaxDimensions(urls: string[]): Promise<ImageDimension> {
  const validUrls = urls.filter(Boolean);
  if (validUrls.length === 0) {
    return { width: DEFAULT_WORKSPACE_WIDTH, height: DEFAULT_WORKSPACE_HEIGHT };
  }

  const dimensions = await Promise.all(validUrls.map(url => getImageDimension(url).catch(() => null)));

  const valid = dimensions.filter(Boolean) as ImageDimension[];
  if (valid.length === 0) {
    return { width: DEFAULT_WORKSPACE_WIDTH, height: DEFAULT_WORKSPACE_HEIGHT };
  }

  return {
    width: Math.max(...valid.map(d => d.width)),
    height: Math.max(...valid.map(d => d.height)),
  };
}

/** 过滤掉已在工作区中的图片 */
export function filterExistingImages(imageList: string[], existingHashes: Set<string>): string[] {
  return imageList.filter(url => !existingHashes.has(extractFileHash(url)));
}
