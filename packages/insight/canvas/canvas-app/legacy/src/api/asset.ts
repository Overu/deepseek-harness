import { request } from './request';
import type { AssetSourceType, AssetSourceCode, AudioContentCategoryType } from '@/components/Asset/types';

interface AssetParams {
  page: number;
  size: number;
  type: number;
  canvasId?: string;
}

export interface FetchAssetListParams {
  type: number; // 类型：1-图片 2-视频 3-音频 99-资产集
  labelId?: number; // 标签ID
  fromTime?: string; // 起始时间，如 "2026-01-01 00:00:00"
  toTime?: string; // 结束时间，如 "2026-01-01 23:59:59"
  isPublic?: number; // 1-公共的，0-用户自己的
  isInCollection?: number; // 1-属于收藏的 0-不属于收藏的
  keyword?: string; // 关键字
  pageSize?: number;
  pageIndex?: number;
  isDesc?: number; // 1-按照时间倒序，0-按照时间正序
  canvasId?: string | number;
  source?: AssetSourceType | AssetSourceCode;
  contentCategory?: AudioContentCategoryType;
}

export interface FetchAssetListItem {
  id: number;
  type: number;
  source?: AssetSourceCode | number;
  sourceType?: AssetSourceType | string; // 资产来源，如 upload/AIGC
  promptPreview?: string;
  fileFormat?: AudioContentCategoryType | string;
  dateKey?: string;
  name?: string;
  coverUrl?: string;
  fileUrl?: string;
  description?: string;
  text?: string; // 运镜描述文本
  createTime?: string;
  label?: string;
  duration?: number; // 视频/音频时长（秒）
  isInCollection?: number;
}

export interface AssetListLabelItem {
  id: number;
  value: string;
  parentId: number;
  depth: number;
  isLeaf: number;
  scene: string;
}

export interface FetchAssetDetailParams {
  id: number;
  type: number; // 类型：1-图片 2-视频 3-音频 99-资产集
}

export interface FetchAssetDetailsParams {
  idList: number[];
  type: number; // 类型：1-图片 2-视频 3-音频 99-资产集
}

export interface CollectionParams {
  type: number; // 类型：1-图片 2-视频 3-音频 99-资产集
  idList: number[];
}

export interface AssetSetItemParams {
  assetSetId: number;
  assetIdList: number[];
}

export interface AssetItem {
  type: number; // 类型：1-图片 2-视频 3-音频 4-文本
  url?: string;
  text?: string;
}

export interface AssetCollectionParams {
  setName?: string;
  canvasId: string;
  coverUrl?: string;
  assetSetId?: number;
  assetSetItemList: Array<AssetItem>;
}

export interface AssetReportParams {
  ids: number[];
}

export interface AddAssetListItem {
  userId?: number;
  assetType: 1 | 2 | 3 | 5;
  fileUrl: string;
  canvasId?: number;
  nodeId?: string;
  sourceParam?: string;
  sourceType?: string;
  source?: 0 | 1 | 2 | 4;
  fileFormat?: string;
}

export interface GetAssetByFileUrlParams {
  canvasId?: number | string;
  nodeId?: string;
  fileUrl: string;
}

/** 画布内按 fileUrl 查询资产详情（getByFileUrl 接口） */
export interface AssetByFileUrlDetail {
  id: number;
  libraryId?: number;
  userId?: number;
  source?: number;
  canvasName?: string;
  assetName?: string;
  assetType: number;
  fileType?: string;
  fileSize?: number;
  fileUrl: string;
  thumbnailUrl?: string | null;
  canvasId?: number;
  sourceParam?: string;
  sourceType?: string;
  text?: string | null;
  nodeId?: string;
  createTime?: string;
  updateTime?: string;
  duration?: number;
  type?: number;
}

export const getAssetByFileUrl = (params: GetAssetByFileUrlParams) => {
  return request('material-server/asset/getByFileUrl', params);
};

export const addAssetList = (params: AddAssetListItem[]) => {
  return request('material-server/asset/addList', params);
};

export const fetchAssets = (params: AssetParams) => {
  return request('material-server/asset/query', params, {
    method: 'GET',
  });
};

export const getAvailableCapacity = (options: import('./workflow').CanvasRequestOptions = {}) => {
  return request(
    'material-server/asset/getAvailableCapacity',
    {},
    {
      ...options, method: 'GET',
    }
  );
};

// 获取标签筛选项
export const getLabelTree = () => {
  return request(
    'material-server/asset/getLabelTree',
    {},
    {
      method: 'GET',
    }
  );
};

// 按场景获取标签列表（如专业运镜 video_camera_movement）
export const getAssetListLabel = (scene: string) => {
  return request('material-server/asset/listLabel', { scene }, { method: 'GET' });
};

// 获取资产列表
export const fetchAssetList = (params: FetchAssetListParams) => {
  return request('material-server/asset/aggregateQuery', params);
};

// 获取资产详情
export const fetchAssetDetail = (params: FetchAssetDetailParams) => {
  return request('material-server/asset/aggregateDetail', params);
};

// 批量查询资产详情
export const fetchAssetDetails = (params: FetchAssetDetailsParams) => {
  return request('material-server/asset/batchAggregateDetail', params);
};

// 添加收藏
export const addToCollection = (params: CollectionParams) => {
  return request('material-server/asset/addToCollection', params);
};

// 移除收藏
export const removeFromCollection = (params: CollectionParams) => {
  return request('material-server/asset/removeFromCollection', params);
};

// 删除资产
export const deleteAsset = (params: CollectionParams) => {
  return request('material-server/asset/deleteAsset', params);
};

// 删除资产集中子资产
export const deleteAssetSetItem = (params: AssetSetItemParams) => {
  return request('material-server/asset/deleteAssetSetItem', params);
};

// 创建资产集
export const createAssetCollection = (params: AssetCollectionParams) => {
  return request('material-server/asset/createAssetSet', params);
};

// 添加资产集
export const addToAssetCollection = (params: AssetCollectionParams) => {
  return request('material-server/asset/addAssetSet', params);
};

// 数据上报（加入画布等行为）
export const reportAssetIds = (params: AssetReportParams) => {
  return request('material-server/asset/report', params);
};
