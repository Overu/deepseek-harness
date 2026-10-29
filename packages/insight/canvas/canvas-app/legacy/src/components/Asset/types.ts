export type AssetType = 'image' | 'video' | 'audio' | 'collection';

/** 加入画布的单条项：节点类型 + 资源地址或文本内容 */
export type AddToCanvasItem = { type: string; value: string; index?: number };

export type ViewMode = 'timeline' | 'grid';

/** 资产来源标识常量 */
export const ASSET_SOURCE = {
  UPLOAD: 'upload',
  AIGC: 'AIGC',
} as const;

export type AssetSourceType = (typeof ASSET_SOURCE)[keyof typeof ASSET_SOURCE];

/** 资产来源 Code 常量 (0: upload, 1: AIGC) */
export const ASSET_SOURCE_CODE = {
  UPLOAD: 0,
  AIGC: 1,
} as const;

export type AssetSourceCode = (typeof ASSET_SOURCE_CODE)[keyof typeof ASSET_SOURCE_CODE];

/** 资产来源筛选类型 */
export type SourceFilter = 'all' | AssetSourceType;

/** 音频内容分类常量 */
export const AUDIO_CONTENT_CATEGORY = {
  TTS: 'tts',
  MUSIC: 'music',
} as const;

export type AudioContentCategoryType = (typeof AUDIO_CONTENT_CATEGORY)[keyof typeof AUDIO_CONTENT_CATEGORY];

/** 音频内容分类筛选类型 */
export type AudioContentCategory = 'all' | AudioContentCategoryType;

/** 资产数字类型常量 */
export const ASSET_TYPE_CODE = {
  IMAGE: 1,
  VIDEO: 2,
  AUDIO: 3,
  TEXT: 4,
  TEXT_SUB: 5,
  COLLECTION: 99,
} as const;

export type AssetTypeCode = (typeof ASSET_TYPE_CODE)[keyof typeof ASSET_TYPE_CODE];

export interface AssetItem {
  id: number;
  type: AssetTypeCode; // 1-图片 2-视频 3-音频 99-资产集
  source?: AssetSourceCode | number; // 0-upload, 1-AIGC
  sourceType?: AssetSourceType | string; // 资产来源，如 upload/AIGC
  promptPreview?: string;
  fileFormat?: AudioContentCategoryType | string; // 如 tts
  dateKey?: string; // 用于按时间分组，如 2026.10.10
  name?: string;
  coverUrl: string;
  fileUrl: string;
  description?: string;
  createTime: string;
  label?: string;
  content?: string;
  duration?: number; // 视频/音频时长（秒）
  isInCollection?: number; // 1-已收藏 0-未收藏，用于展示收藏/取消收藏
}

/** 时序一维打平项：日期分割 Header 或 资产卡片 */
export type TimelineFlatItem = { isHeader: true; dateKey: string; id?: string | number } | (AssetItem & { isHeader?: false });

export interface FilterOption {
  label: string;
  value: string;
}

export interface DynamicFilter {
  id: string;
  label: string;
  options: FilterOption[];
}

/** 级联筛选树节点：第一层对应 tab（图片/视频等），type 为筛选项标签，children 为该选项的可选值 */
export interface FilterTreeNode {
  id: number;
  label: string;
  type?: string;
  children?: FilterTreeNode[];
}

export type SortOrder = 'desc' | 'asc';

export interface AssetLibraryProps {
  readOnly?: boolean;
}

/** 详情接口返回：assetDetail 与 assetSetDetail 不同时存在 */
export interface AssetDetailResponse {
  type: number;
  assetDetail?: {
    id: number;
    type: number;
    coverUrl: string;
    fileUrl: string;
    createTime?: string;
    label?: string;
    sourceParam: string; // JSON: { input: { images, texts, videos, audio }, params: { prompt?, ... } }
    canvasName?: string; // 工作流画布名称，用于展示所属来源
  };
  assetSetDetail?: AssetSetDetailItem[];
}

export interface AssetSetDetailItem {
  id: number;
  type: number; // 1-图片 2-视频 3-音频 4-文本
  coverUrl?: string;
  fileUrl?: string;
  createTime?: string;
  text?: string;
}

/** 解析后的 sourceParam */
export interface SourceParamParsed {
  input?: {
    images?: string[];
    texts?: string[];
    videos?: string[];
    audio?: string[];
  };
  params?: Record<string, unknown> & { prompt?: string };
  /** 工具节点名称，用于资产详情展示 */
  toolNodeName?: string;
  /** 工具节点 key，如 highDefinitionTool / imageLipSyncTool */
  toolNodeKey?: string;
}
