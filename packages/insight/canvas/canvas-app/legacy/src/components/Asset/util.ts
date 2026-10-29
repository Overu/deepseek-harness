import {
  ASSET_SOURCE,
  ASSET_SOURCE_CODE,
  ASSET_TYPE_CODE,
  type AssetTypeCode,
  type AssetType,
  type AssetSetDetailItem,
  type AddToCanvasItem,
  type AssetItem,
  type TimelineFlatItem,
} from './types';
import { compressImage } from '@/utils';

/** 将接口返回的 createTime（如 "2026-03-05T19:26:26"）转为展示格式 "2026-03-05 19:26:26" */
export function formatCreateTime(createTime: string | undefined): string {
  if (!createTime) return '';
  return createTime.replace('T', ' ');
}

export const typeMap: Record<AssetType, string> = {
  video: '视频',
  image: '图片',
  audio: '音频',
  collection: '资产集',
};

export const typeNumberMap: Record<AssetType, AssetTypeCode> = {
  image: ASSET_TYPE_CODE.IMAGE,
  video: ASSET_TYPE_CODE.VIDEO,
  audio: ASSET_TYPE_CODE.AUDIO,
  collection: ASSET_TYPE_CODE.COLLECTION,
};

export const typeNumberLabelMap: Record<number, string> = {
  [ASSET_TYPE_CODE.IMAGE]: '图片',
  [ASSET_TYPE_CODE.VIDEO]: '视频',
  [ASSET_TYPE_CODE.AUDIO]: '音频',
  [ASSET_TYPE_CODE.TEXT_SUB]: '文本',
  [ASSET_TYPE_CODE.COLLECTION]: '资产集',
};

export const HIGH_DEFINITION_SOURCE_TYPES = ['highDefinitionTool', 'highDefinitionVideoTool'] as const;

export function isHighDefinitionSource(sourceType?: string): boolean {
  if (!sourceType) return false;
  return HIGH_DEFINITION_SOURCE_TYPES.includes(sourceType as (typeof HIGH_DEFINITION_SOURCE_TYPES)[number]);
}

/** 基于 OSS 视频截帧生成 poster URL */
export function buildVideoPosterUrl(fileUrl: string, width = 480): string {
  if (!fileUrl) return '';
  return `${fileUrl}?x-oss-process=video/snapshot,t_0,f_jpg,w_${width},m_fast`;
}

/** 解析视频卡片封面：优先 coverUrl，否则 OSS 截帧 */
export function resolveAssetVideoPoster(asset: Pick<AssetItem, 'coverUrl' | 'fileUrl'>, width = 480): string {
  const compressedCover = asset.coverUrl ? compressImage(asset.coverUrl) : '';
  if (compressedCover) return compressedCover;
  return buildVideoPosterUrl(asset.fileUrl, width);
}

/** 从 URL 解析扩展名，用于无后缀 name 时生成下载文件名 */
export function getExtensionFromUrl(url: string): string {
  const path = url.split('?')[0] || '';
  const match = path.match(/\.([a-zA-Z0-9]+)$/);
  return match ? `.${match[1].toLowerCase()}` : '';
}

/** 基于资产 name/url 生成下载文件名（尽量保留后缀） */
export function buildDownloadFilename(name: string | undefined, url: string): string | undefined {
  if (!url) return undefined;
  if (!name) return undefined;
  if (name.includes('.')) return name;
  return `${name}${getExtensionFromUrl(url)}`;
}

/** 资产 type 到画布节点 type 的映射（用于加入画布） */
export const nodeTypeByAssetTypeForAdd: Record<number, string> = {
  [ASSET_TYPE_CODE.IMAGE]: 'image',
  [ASSET_TYPE_CODE.VIDEO]: 'video',
  [ASSET_TYPE_CODE.AUDIO]: 'audio',
  [ASSET_TYPE_CODE.TEXT]: 'text',
  [ASSET_TYPE_CODE.TEXT_SUB]: 'text',
};

/** 将资产集详情子项转为加入画布项：type=5 取 text 作为 value，其余取 fileUrl */
export function assetSetDetailToItems(list: AssetSetDetailItem[]): AddToCanvasItem[] {
  return list
    .map(item => {
      const type = nodeTypeByAssetTypeForAdd[item.type] ?? 'image';
      const value = item.type === ASSET_TYPE_CODE.TEXT_SUB ? (item.text ?? '') : (item.fileUrl ?? '');
      if (!value && type !== 'text') return null;
      return { type, value };
    })
    .filter((x): x is AddToCanvasItem => x !== null);
}

/** 判断是否为用户上传资产 */
export function isUploadAsset(asset: Pick<AssetItem, 'source' | 'sourceType'>): boolean {
  return asset.source === ASSET_SOURCE_CODE.UPLOAD || asset.sourceType === ASSET_SOURCE.UPLOAD;
}

/** 判断是否为 AI 生成资产 */
export function isGeneratedAsset(asset: Pick<AssetItem, 'source' | 'sourceType'>): boolean {
  return asset.source === ASSET_SOURCE_CODE.AIGC || asset.sourceType === ASSET_SOURCE.AIGC;
}

/** 格式化日期为 xxxx.xx.xx (支持 20260818、2026-08-18、2026/8/18 等格式，年月日补零) */
function formatToDateDot(dateStr: string): string {
  if (!dateStr) return '未知日期';
  const str = String(dateStr).trim();

  // 纯 8 位数字格式，如 "20260818"
  const eightDigitMatch = str.match(/^(\d{4})(\d{2})(\d{2})/);
  if (eightDigitMatch) {
    const [, y, m, d] = eightDigitMatch;
    return `${y}.${m}.${d}`;
  }

  // 带分隔符格式，如 "2026-08-18"、"2026/8/18"、"2026.8.5"、"2026-08-18 10:20:45"
  const separatedMatch = str.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (separatedMatch) {
    const [, y, m, d] = separatedMatch;
    return `${y}.${m.padStart(2, '0')}.${d.padStart(2, '0')}`;
  }

  return str.replace(/-/g, '.');
}

/** 提取资产日期分序 key，格式为 xxxx.xx.xx */
export function getAssetDateKey(asset: Pick<AssetItem, 'dateKey' | 'createTime'>): string {
  if (asset.dateKey) {
    return formatToDateDot(asset.dateKey);
  }
  if (asset.createTime) {
    return formatToDateDot(asset.createTime);
  }
  return '未知日期';
}

/** 将资产按连续日期打平为一维时序数据（包含日期 Header） */
export function flattenAssetsByDate(assets: AssetItem[]): TimelineFlatItem[] {
  const result: TimelineFlatItem[] = [];
  let lastDateKey = '';

  for (const asset of assets) {
    const key = getAssetDateKey(asset);
    if (key !== lastDateKey) {
      result.push({ isHeader: true, dateKey: key, id: `header-${key}` });
      lastDateKey = key;
    }
    result.push(asset);
  }

  return result;
}

/** 全局单例音频播放器控制器，保证同一时刻仅一个音频播放，移出时停止 */
type AudioListener = (currentUrl: string | null) => void;

class GlobalAudioManager {
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private listeners: Set<AudioListener> = new Set();

  subscribe(listener: AudioListener): () => void {
    this.listeners.add(listener);
    listener(this.currentUrl);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(l => l(this.currentUrl));
  }

  play(url: string): void {
    if (!url) return;
    if (this.currentUrl === url && this.currentAudio && !this.currentAudio.paused) {
      return;
    }
    this.stop();
    this.currentUrl = url;
    const audio = new Audio(url);
    this.currentAudio = audio;
    audio.onended = () => {
      this.stop(url);
    };
    audio.onerror = () => {
      this.stop(url);
    };
    audio.play().catch(() => {
      this.stop(url);
    });
    this.notify();
  }

  stop(url?: string): void {
    if (url && this.currentUrl !== url) return;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this.currentUrl = null;
    this.notify();
  }

  getCurrentUrl(): string | null {
    return this.currentUrl;
  }
}

export const globalAudioManager = new GlobalAudioManager();
