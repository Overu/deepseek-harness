import { submitExternalTask } from '../../../src/external-task-api';
import { request } from './request';
import { runCanvasVersionPolling } from '@/lib/canvasVersionBarrier';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';

export interface PoseRequest {
  img_url: string;
}

/**
 * 火柴人接口
 * @param params 图片url
 */
export const getImgPose = (params: PoseRequest) => {
  return request('game-ai-editor-center/workflow-tool/getImgPose', params);
};

/**
 * 视频高清化点数计算
 * @param params 视频url列表和分辨率
 */
export const getVideoHdPoints = (params: { urlList: string[]; resolution: string; canvasId: string; nodeId: string }) => {
  return request('game-ai-editor-center/upscale/video/points', params);
};

/**
 * 图片高清化点数计算
 * @param params 图片url列表和分辨率
 */
export const getImageHdPoints = (params: { urlList: string[]; resolution: string; canvasId: string; nodeId: string }) => {
  return request('game-ai-editor-center/upscale/image/points', params);
};

/**
 * 通用 external-task 赛点计算（入参与 createExternalTask 对齐）
 */
export type CalculateExternalTaskCostParams = {
  type: string;
  canvasId?: string;
  nodeId?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

export const calculateExternalTaskCost = (params: CalculateExternalTaskCostParams) => {
  return request('order-server/api/cost/externalTask', params);
};

/**
 * 通用 external-task 创建（用于工具类异步任务）
 */
export const createExternalTask = (params: { type: string; canvasId: string; nodeId: string; data: any }) => {
  return submitExternalTask(params);
};

export type QueryExternalTaskResultParams = { taskId: string } | { canvasId: string; nodeId: string; data: { imageUrlList: string[]; [key: string]: any } };

/**
 * 通用 external-task 结果查询（支持 taskId 或 canvasId+nodeId+imageUrlList）
 */
export const queryExternalTaskResult = (params: QueryExternalTaskResultParams | string) => {
  const queryParams = typeof params === 'string' ? { taskId: params } : params;
  const canvasId = useFlowStore.getState().canvasId;
  return runCanvasVersionPolling(
    () => request(`game-ai-editor-center/api/v2/workflow/external-task/result`, queryParams),
    (response: any) => {
      const versionNumber = response?.data?.versionNumber;
      syncCanvasVersionNumber(canvasId, versionNumber);
      return typeof versionNumber === 'number' || typeof versionNumber === 'string';
    }
  );
};
