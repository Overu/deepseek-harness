import { request } from './request';
import type { RequestConfig } from './request';
import type { Node, Edge } from '@xyflow/react';

export type CanvasVersionNumber = number | string;

export interface SaveFlowResult {
  id: string | number;
  versionNumber?: CanvasVersionNumber;
}

export const getSavedCanvasId = (data?: SaveFlowResult | string | number | null) => {
  const id = typeof data === 'object' && data !== null ? data.id : data;
  return id === undefined || id === null ? undefined : String(id);
};

export type CanvasRequestOptions = Pick<RequestConfig, 'silentError' | 'receiptMode' | 'signal' | 'onAuthExpired' | 'onCanvasLoadError'>;

const requireLoginRedirect = {
  authRedirect: 'always' as const,
};

interface ToneParams {
  name: string;
  originUrl: string;
}

export interface ConfigOption {
  id: number;
  type: string;
  nameZh: string;
  nameEn: string;
}

export interface RandomConfigOptionParams {
  type: 'music-style';
  selectedIds: number[];
  count: number;
}

export interface WorkFlowExcute {
  canvasId: string;
  versionNumber?: CanvasVersionNumber;
  workflowData: {
    nodes: Node[];
    edges: Edge[];
  };
  executeStrategy: string;
  runningNodeIds?: string[];
}

interface WorkFlowInterrupt {
  taskId: string;
  nodeIds: string[];
}

export type CanvasSortType = 'time_asc' | 'time_desc';

interface FlowListParams {
  page: number;
  size: number;
  favorite?: boolean;
  temp?: boolean;
  name?: string;
  version: string;
  canvasType?: Array<0 | 1> | null;
  /** folderId=0 查根级项目（不含文件夹内）；folderId=null 查全部项目；传入具体 id 查对应文件夹内项目 */
  folderId?: number | null;
  sort_type?: CanvasSortType;
}

interface FlowParams {
  id?: string;
  /** 批量删除项目时使用 */
  ids?: (string | number)[];
}

export interface CanvasData {
  id?: string;
  temp?: boolean;
  favorite?: boolean;
  name?: string;
  data?: string;
  thumbnailUrl?: string;
  templateId?: number;
  version: string;
  versionNumber?: CanvasVersionNumber;
  canvasType?: 0 | 1;
}

interface CheckCanvasNameDuplicateParams {
  name: string;
  canvasType: 0 | 1;
}

interface CheckCanvasNameDuplicateResult {
  duplicated: boolean;
  /** 存在且传入对应文件夹 id 时，直接在该文件夹内新建项目 */
  folderId?: number;
}

export interface CreateCanvasFolderParams {
  name: string;
  canvas_ids?: number[];
}

export interface UpdateCanvasFolderParams {
  id: number;
  name: string;
}

export interface MoveCanvasToFolderParams {
  canvas_ids: number[];
  /** target_folder_id 为 0 时表示移出文件夹 */
  target_folder_id: number;
}

export interface DeleteCanvasFolderParams {
  id: number;
}

export interface CanvasFolderListParams {
  page: number;
  size: number;
  name?: string;
  favorite?: boolean;
  sort_type?: CanvasSortType;
}

export interface FavoriteIdsParams {
  favorite_ids?: number[];
  unfavorite_ids?: number[];
}

interface UpdateParams {
  id: string; // canvasId
  updateNodes?: string[]; // 节点json字符串数组
  addNodes?: string[];
  deleteNodeIds?: string[];
  edges?: Edge[];
  versionNumber?: CanvasVersionNumber;
}

interface SearchTemplateParams {
  categoryIds?: string[];
  name?: string;
  page: number;
  size: number;
  homePage?: boolean;
  homePageCategory?: string;
}

interface GetTemplateDataPrams {
  id: number;
}

interface TemplateReportParams {
  id: number | string;
}

interface TemplateFavoriteParams {
  resourceId: number;
  type: string;
}

interface GetFavoriteTemplatePrams {
  page: number;
  size: number;
  name: string;
  categoryIds: string[];
}

interface ShareCanvasParams {
  canvasId: string;
  canvasData: string;
  canvasName: string;
  thumbnailUrl: string;
}

interface GetShareCanvasParams {
  code: string;
}

/* 
  画布页面相关接口
*/

// 执行工作流
export const excuteWorkFlow = (params: WorkFlowExcute, options?: CanvasRequestOptions) => {
  return request('game-ai-editor-center/api/v2/workflow/invoke', params, { ...requireLoginRedirect, ...options });
};

// 中断工作流
export const interruptWorkFlow = (params: WorkFlowInterrupt) => {
  return request('game-ai-editor-center/api/v2/workflow/interrupt', params, requireLoginRedirect);
};

// 获取工作流数据
export const getFlowData = (params: FlowParams, options?: CanvasRequestOptions) => {
  return request('game-ai-editor-center/api/canvas/get', params, options);
};

// 保存工作流
export const saveFlow = (params: CanvasData, options?: CanvasRequestOptions) => {
  return request<SaveFlowResult>('game-ai-editor-center/api/canvas/saveOrUpdate', params, { ...requireLoginRedirect, ...options });
};

// 校验画布名称是否重复
export const checkCanvasNameDuplicate = (params: CheckCanvasNameDuplicateParams) => {
  return request<CheckCanvasNameDuplicateResult>('game-ai-editor-center/api/canvas/checkNameDuplicate', params, requireLoginRedirect);
};

// 获取模型参数
export const getModelParams = (options?: CanvasRequestOptions) => {
  const url = import.meta.env.VITE_MODEL_PARAMS_URL;
  if (url) {
    return fetch(url, options?.signal ? { signal: options.signal } : undefined).then(async response => {
      if (!response.ok) throw new Error(`Failed to fetch model params: ${response.status}`);
      return {
        code: 'SUCCESS',
        data: [{ config: JSON.stringify(await response.json()) }],
      };
    });
  }

  return request('game-ai-editor-center/api/v2/workflow/listNodeSetting', {}, options);
};

// 随机获取通用配置项；当前用于音乐风格推荐。
export const getRandomConfigOptions = (params: RandomConfigOptionParams) => {
  return request<ConfigOption[]>('game-ai-editor-center/api/config-option/random', params, requireLoginRedirect);
};

/** 画布节点模型权限（visible/enabled、custom_parameters 等） */
export const listModelNodeSetting = (options?: CanvasRequestOptions) => {
  return request('game-ai-editor-center/api/v2/workflow/listModelNodeSetting', {}, { method: 'GET', ...requireLoginRedirect, ...options });
};

/** 工具节点权限 */
export const listToolNodeSetting = (options?: CanvasRequestOptions) => {
  return request('game-ai-editor-center/api/v2/workflow/listToolNodeSetting', {}, { method: 'GET', ...requireLoginRedirect, ...options });
};

// 局部更新节点信息
export const updateCanvas = (params: UpdateParams, options?: CanvasRequestOptions) => {
  return request('game-ai-editor-center/api/canvas/partialUpdate', params, { ...requireLoginRedirect, ...options });
};

// 新增音色
export const addTone = (params: ToneParams) => {
  return request('game-ai-editor-center/api/tone/create', params, requireLoginRedirect);
};

// 获取用户音色
export const fetchTone = (options?: CanvasRequestOptions) => {
  return request('game-ai-editor-center/api/tone/list', {}, options);
};

// 分享工作流
export const shareCanvas = (params: ShareCanvasParams) => {
  return request('game-ai-editor-center/api/canvas/share', params, requireLoginRedirect);
};

// 获取分享的工作流
export const getShareCanvas = (params: GetShareCanvasParams) => {
  return request('game-ai-editor-center/api/canvas/getShareCanvas', params);
};

// 获取赛点价格表
export const getAllRule = (options?: CanvasRequestOptions) => {
  return request(
    'order-server/api/cost/getAllRule',
    {},
    {
      method: 'GET',
      ...options,
    }
  );
};

/* 
  工作流页面相关接口
*/

// 删除工作流
export const deleteFlow = (params: FlowParams) => {
  return request('game-ai-editor-center/api/canvas/delete', params, requireLoginRedirect);
};

// 获取工作流列表
export const getFlowsList = (params: FlowListParams) => {
  return request('game-ai-editor-center/api/canvas/list', {
    ...params,
    canvasType: params.canvasType ?? null,
  });
};

/* 
  画布文件夹相关接口
*/

// 创建文件夹；附带项目时传入 canvas_ids
export const createCanvasFolder = (params: CreateCanvasFolderParams) => {
  return request('game-ai-editor-center/api/canvas-folder/create', params, requireLoginRedirect);
};

// 更新文件夹名称
export const updateCanvasFolder = (params: UpdateCanvasFolderParams) => {
  return request('game-ai-editor-center/api/canvas-folder/update', params, requireLoginRedirect);
};

// 移动画布项目到文件夹；target_folder_id 为 0 时移出文件夹
export const moveCanvasToFolder = (params: MoveCanvasToFolderParams) => {
  return request('game-ai-editor-center/api/canvas-folder/move-canvas', params, requireLoginRedirect);
};

// 删除 / 解散文件夹
export const deleteCanvasFolder = (params: DeleteCanvasFolderParams) => {
  return request('game-ai-editor-center/api/canvas-folder/delete', params, requireLoginRedirect);
};

// 查询文件夹列表；收藏筛选时传入 favorite=true
export const getCanvasFolderList = (params: CanvasFolderListParams) => {
  return request('game-ai-editor-center/api/canvas-folder/list', params);
};

// 收藏 / 取消收藏文件夹
export const favoriteCanvasFolder = (params: FavoriteIdsParams) => {
  return request('game-ai-editor-center/api/canvas-folder/favorite', params, requireLoginRedirect);
};

// 批量收藏 / 取消收藏项目
export const favoriteCanvas = (params: FavoriteIdsParams) => {
  return request('game-ai-editor-center/api/canvas/favorite', params, requireLoginRedirect);
};

// 获取模板工作流类型列表
export const getTemplateCategory = () => {
  return request('game-ai-editor-center/api/canvas-template-category/tree', {});
};

// 获取模板工作流列表
export const getTemplateFlows = (params: SearchTemplateParams) => {
  return request('game-ai-editor-center/api/canvas-template/search', params);
};

// 获取首页模板库分类
export const getHomeTemplateCategories = () => {
  return request<string[]>('game-ai-editor-center/api/canvas-template/home-page/categories', {});
};

// 获取模板工作流列表
export const getHomeTemplate = (params: SearchTemplateParams) => {
  return request('game-ai-editor-center/api/canvas-template/home-page', params);
};

// 获取收藏模板工作流列表
export const getFavoriteTemplate = (params: GetFavoriteTemplatePrams) => {
  return request('game-ai-editor-center/api/favorite/canvas-template/search', params);
};

// 根据id获取模板
export const getTemplate = (params: GetTemplateDataPrams) => {
  return request('game-ai-editor-center/api/canvas-template/get', params);
};

// 上报模板工作流使用
export const reportTemplateFlowUsage = (params: TemplateReportParams) => {
  return request('game-ai-editor-center/api/canvas-template/report', params);
};

// 收藏模板
export const addTemplateFavorite = (params: TemplateFavoriteParams) => {
  return request('game-ai-editor-center/api/favorite/add', params);
};

// 取消收藏
export const deleteTemplateFavorite = (params: TemplateFavoriteParams) => {
  return request('game-ai-editor-center/api/favorite/remove', params);
};
