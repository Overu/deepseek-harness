import { type HandleType, type Position as PositionType } from '@xyflow/react';

export interface TaskInfo {
  status: 'success' | 'interrupt' | 'failure' | 'running' | 'fakeInterrupt'; // 任务进行状态   中断=interrupt，失败=failure, 运行中=running,成功=success,假中断=fakeInterrupt
  taskId: string; // 任务id
  errorMsg: string; // 错误信息
}

export interface OcrResult {
  recTexts: string[];
  editTexts: string[];
  recPolys: number[][][];
}

export interface OcrInfo extends TaskInfo {
  result?: OcrResult;
}

export interface Handler {
  type: HandleType;
  position: PositionType;
  id: string;
  style: any;
  limit?: number;
}

/** 媒体节点内容来源：upload=用户上传；tool=工具输出子节点；未设置=可 AI 生成 */
export type MediaNodeContentType = 'upload' | 'tool';

/** 不可 AI 生成的纯输入物（用户上传或工具子节点） */
export const isNonGenerativeMedia = (type?: MediaNodeContentType | string | null) => type === 'upload' || type === 'tool';

/** 用户手动上传（含本地/资产库） */
export const isUserUploadMedia = (type?: MediaNodeContentType | string | null) => type === 'upload';
