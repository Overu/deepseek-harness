import { createImageInpaintDeleteMaskTask, createImageInpaintKeepMaskTask, getImageInpaintDeleteMaskTaskResult, getImageInpaintKeepMaskTaskResult } from '@/api/editor';
import { uploadFile } from '@/services/upload/uploadFile';
import type { MattingBrushMode } from './constants';

const POLL_INTERVAL_MS = 2000;

export class ImageInpaintTaskCancelledError extends Error {
  constructor() {
    super('任务已取消');
    this.name = 'ImageInpaintTaskCancelledError';
  }
}

interface RunImageInpaintTaskParams {
  mode: MattingBrushMode;
  canvasId: number;
  nodeId: string;
  imageUrl: string;
  maskBlob: Blob;
  signal: AbortSignal;
}

const waitForNextPoll = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new ImageInpaintTaskCancelledError());
      return;
    }

    const handleAbort = () => {
      window.clearTimeout(timer);
      reject(new ImageInpaintTaskCancelledError());
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, POLL_INTERVAL_MS);
    signal.addEventListener('abort', handleAbort, { once: true });
  });

export const runImageInpaintTask = async ({ mode, canvasId, nodeId, imageUrl, maskBlob, signal }: RunImageInpaintTaskParams) => {
  const maskFile = new File([maskBlob], `matting-mask-${Date.now()}.png`, { type: 'image/png' });
  const maskImageUrl = (await uploadFile(maskFile, { signal })).url;
  if (!maskImageUrl) throw new Error('蒙版上传失败，请重试');

  const createTask = mode === 'keep' ? createImageInpaintKeepMaskTask : createImageInpaintDeleteMaskTask;
  const queryTaskResult = mode === 'keep' ? getImageInpaintKeepMaskTaskResult : getImageInpaintDeleteMaskTaskResult;
  const createResult: any = await createTask({ canvasId, nodeId, imageUrl, maskImageUrl }, signal);
  const taskId = createResult?.data?.taskId;
  if (!taskId) throw new Error('未获取到抠图任务 ID，请重试');

  while (!signal.aborted) {
    const queryResult: any = await queryTaskResult({ taskId }, signal);
    const taskResult = queryResult?.data;
    const status = taskResult?.status?.toLowerCase();

    if (status === 'success') {
      const resultImageUrl = taskResult?.imageList?.[0];
      if (!resultImageUrl) throw new Error('未获取到抠图结果，请重试');
      return resultImageUrl;
    }

    if (status === 'failure') {
      throw new Error(taskResult?.errorMessage || '抠图任务失败，请重试');
    }

    if (status !== 'running') {
      throw new Error('抠图任务状态异常，请重试');
    }

    await waitForNextPoll(signal);
  }

  throw new ImageInpaintTaskCancelledError();
};
