import { request } from './request';
import type { CanvasRequestOptions } from './workflow';

// 获取公共音色列表请求参数
export interface FetchPublicToneListParams {
  language?: string; // 语言筛选
  gender?: string; // 性别筛选
  age?: string; // 年龄筛选
  category?: string; // 分类筛选
  name?: string; // 音色名称（模糊搜索）
  page?: number;
  size?: number;
  onSale?: number; // 1-上架，0-下架
  isFavorite?: boolean; // true-仅收藏
}

// 分页获取用户音色请求参数
export interface FetchUserTonePageParams {
  page?: number;
  size?: number;
  name?: string; // 音色名称（模糊搜索）
  isFavorite?: boolean; // true-仅收藏
}

// 收藏/取消收藏音色请求参数（公共/个人）
export interface ToggleToneFavoriteParams {
  pkId: number; // 记录ID
  type: 'PUBLIC_VOICE' | 'USER_TONE'; // PUBLIC_VOICE-公共音色，USER_TONE-个人音色
  isFavorite: boolean; // true-收藏，false-取消收藏
}

// 音色分类树节点
export interface ToneCategoryTreeItem {
  id?: number;
  name?: string;
  parentId?: number;
  children?: ToneCategoryTreeItem[];
}

// 根据 voiceId 查询音色详情请求参数
export interface FetchToneDetailByVoiceIdParams {
  voiceId: string;
}

// 音色详情
export interface ToneDetail {
  voiceType?: 'PUBLIC_VOICE' | 'USER_TONE';
  publicVoice?: {
    id?: number;
    voiceId?: string;
    name?: string;
    language?: string;
    accent?: string;
    gender?: string;
    age?: string;
    category?: string;
    scriptId?: string;
    demoUrl?: string;
    platform?: string;
    onSale?: number;
    modelId?: string;
    isFavorite?: boolean;
  };
  personalVoice?: {
    id?: number;
    userId?: number;
    name?: string;
    voiceId?: string;
    fileId?: string;
    platform?: string;
    originUrl?: string;
    demoUrl?: string;
    isFavorite?: boolean;
  };
}

export interface RemoveToneParams {
  ids: number[];
}

// 获取公共音色列表
export const fetchPublicToneList = (params: FetchPublicToneListParams, options?: CanvasRequestOptions) => {
  return request('game-ai-editor-center/api/voice/public/page', params, options);
};

// 获取公共音色收藏列表
export const fetchFavoritePublicToneList = (params: FetchPublicToneListParams) => {
  return request('game-ai-editor-center/api/voice/public/favorites', params);
};

// 分页获取用户音色数据
export const fetchUserTonePage = (params: FetchUserTonePageParams, options?: CanvasRequestOptions) => {
  return request('game-ai-editor-center/api/tone/page', params, options);
};

// 获取用户音色收藏列表
export const fetchFavoriteUserToneList = (params: FetchUserTonePageParams) => {
  return request('game-ai-editor-center/api/tone/favorites', params);
};

// 收藏/取消收藏音色（公共/个人）
export const toggleToneFavorite = (params: ToggleToneFavoriteParams) => {
  return request('game-ai-editor-center/api/voice/favorite', params);
};

// 获取音色分类树
export const fetchToneCategoryTree = () => {
  return request(
    'game-ai-editor-center/api/voice/public/category/tree',
    {},
    {
      method: 'GET',
    }
  );
};

// 根据 voiceId 查询音色详情
export const fetchToneDetailByVoiceId = (params: FetchToneDetailByVoiceIdParams, options?: CanvasRequestOptions) => {
  return request('game-ai-editor-center/api/voice/detail/by-voice-id', params, {
    method: 'GET',
    ...options,
  });
};

// 删除定制音色
export const deleteMyVoice = (params: Array<number>) => {
  return request('game-ai-editor-center/api/tone/delete', params);
};

// 删除音色（新接口）
export const removeTone = (params: RemoveToneParams) => {
  return request('game-ai-editor-center/api/tone/remove', params);
};
