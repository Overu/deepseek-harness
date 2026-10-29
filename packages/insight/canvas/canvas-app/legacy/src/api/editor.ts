/**
 *  编辑器相关接口
 */
import { request } from './request';

const VITE_OSS_URL = import.meta.env.VITE_OSS_URL;

// 编辑器 Json 信息
export const uploadEditorInfo = (data: any) => {
  return request('game-ai-editor-center/api/editor', { ...data }, { method: 'PUT' });
};

export const queryEditorInfo = (params: { canvasId: string; nodeId: string | undefined }) => {
  return request(`game-ai-editor-center/api/editor/get`, params, {
    method: 'GET',
  });
};

export interface ImageInpaintCreateParams {
  canvasId: number;
  nodeId: string;
  imageUrl: string;
  maskImageUrl: string;
  childNodeIds?: string[];
}

export interface ImageInpaintCreateResult {
  taskId?: string;
}

export interface ImageInpaintResultParams {
  taskId: string;
}

export interface ImageInpaintTaskResult {
  taskId?: string;
  status?: 'running' | 'success' | 'failure';
  imageList?: string[];
  childNodeInfo?: Record<string, string>;
  errorCode?: string;
  errorMessage?: string;
}

export interface ImageInpaintApiResponse<T> {
  code?: string;
  msg?: string;
  data?: T;
}

/** 创建图像涂抹保留任务 */
export const createImageInpaintKeepMaskTask = (params: ImageInpaintCreateParams, signal?: AbortSignal) => {
  return request<ImageInpaintCreateResult>('game-ai-editor-center/api/v2/workflow/image-inpaint/keep-mask', params, { signal });
};

/** 查询图像涂抹保留任务结果 */
export const getImageInpaintKeepMaskTaskResult = (params: ImageInpaintResultParams, signal?: AbortSignal) => {
  return request<ImageInpaintTaskResult>('game-ai-editor-center/api/v2/workflow/image-inpaint/keep-mask/result', params, { signal });
};

/** 创建图像涂抹删除任务 */
export const createImageInpaintDeleteMaskTask = (params: ImageInpaintCreateParams, signal?: AbortSignal) => {
  return request<ImageInpaintCreateResult>('game-ai-editor-center/api/v2/workflow/image-inpaint/delete-mask', params, { signal });
};

/** 查询图像涂抹删除任务结果 */
export const getImageInpaintDeleteMaskTaskResult = (params: ImageInpaintResultParams, signal?: AbortSignal) => {
  return request<ImageInpaintTaskResult>('game-ai-editor-center/api/v2/workflow/image-inpaint/delete-mask/result', params, { signal });
};

/**
 * 自动抠图
 * inputImageUrl: 输入图片url
 * clickCount: 点击次数
 */
export const autoMatting = (inputImageUrl: string) => {
  const url = `${VITE_OSS_URL}/image/matting`;
  return request(
    url,
    {
      inputImageUrl,
      clickCount: 1,
    },
    {
      fullUrl: url,
    }
  );
};
