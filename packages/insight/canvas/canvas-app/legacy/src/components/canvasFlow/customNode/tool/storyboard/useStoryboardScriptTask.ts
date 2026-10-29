import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import hooks from '../../../hooks';
import type { TableProtocol, StoryboardMode } from './types';
import { adjustFirstRowSizesForImages } from './tableSizeAdjust';
import { toast } from 'sonner';
import { createExternalTask, queryExternalTaskResult } from '@/api/tool';
import { usePointStore } from '@/store/pointStore';
import { useExternalTaskCostPoints } from '../useExternalTaskCostPoints';

const { useGetNodeInput } = hooks;

type UseStoryboardScriptTaskParams = {
  id: string;
  data: any;
  dataRef: RefObject<any>;
  selected: boolean;
  mode: StoryboardMode;
  status: string;
  taskId: string;
  storyboardStatus: string;
  isStoryboardExcuteRef: RefObject<boolean>;
  setTable: (next: TableProtocol, isRecord?: boolean, isSubmit?: boolean) => void;
};

/**
 * 脚本生成任务（taskInfo）：赛点、轮询、底部 prompt/mode、创建外部任务。
 */
export function useStoryboardScriptTask({ id, data, dataRef, selected, mode, status, taskId, storyboardStatus, isStoryboardExcuteRef, setTable }: UseStoryboardScriptTaskParams) {
  const { updateUserPoint, setNeedPoint } = usePointStore(state => state.actions);
  const nodes = useFlowStore(state => state.nodes);
  const edges = useFlowStore(state => state.edges);
  const canvasId = useFlowStore(state => state.canvasId);
  const { updateNodeData, updateNodeStatus } = useFlowStore(state => state.actions);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [tempTaskId, setTempTaskId] = useState('');
  const [isExcute, setIsExcute] = useState(false);

  const actualTaskId = useMemo(() => {
    return tempTaskId || taskId || '';
  }, [taskId, tempTaskId]);

  const { textMap, imageMap, videoMap, mediaInputs } = useGetNodeInput(id, nodes, edges);

  const inputConnections = useMemo(() => {
    let textCount = 0;
    let imageCount = 0;
    let videoCount = 0;
    edges.forEach(edge => {
      if (edge.target !== id) return;
      if (edge.targetHandle === 'text_target') textCount += 1;
      else if (edge.targetHandle === 'image_target') imageCount += 1;
      else if (edge.targetHandle === 'video_target') videoCount += 1;
    });
    return {
      hasText: textCount > 0,
      hasImage: imageCount > 0,
      hasVideo: videoCount > 0,
    };
  }, [edges, id]);

  const modelKey = useMemo(() => String(data?.params?.model ?? ''), [data?.params?.model]);

  const images = useMemo(() => (imageMap || []).map(i => i.value).filter(Boolean), [imageMap]);
  const videos = useMemo(() => (videoMap || []).map(v => v.value).filter(Boolean), [videoMap]);

  const costKey = useMemo(() => {
    return [`m=${mode}`, `model=${modelKey}`, `i=${images.join('|')}`, `v=${videos.join('|')}`].join('#');
  }, [images, mode, modelKey, videos]);

  const buildCostParams = useCallback(() => {
    if (!modelKey || !canvasId || !id) return null;
    if (mode === 'video_understand') {
      if (!videos.length) return null;
      return {
        type: modelKey,
        canvasId: String(canvasId || ''),
        nodeId: String(id || ''),
        data: {
          type: mode,
          videoUrlList: videos,
        },
      };
    }
    // custom / gen_script：只用媒体字段触发 cost 计算（prompt/text 不参与）
    if (!images.length && !videos.length) return null;
    return {
      type: modelKey,
      canvasId: String(canvasId || ''),
      nodeId: String(id || ''),
      data: {
        type: mode,
        imageUrlList: images,
        videoUrlList: videos,
      },
    };
  }, [canvasId, id, images.length, mode, modelKey, videos, videos.length]);

  const { caculatePoint, pointLoading } = useExternalTaskCostPoints({
    selected,
    costKey,
    buildCostParams,
  });

  // 轮询生成结果
  useEffect(() => {
    if (status !== 'running') return;

    const poll = async () => {
      try {
        if (!actualTaskId) {
          updateNodeStatus(id, 'failure', '任务ID缺失，请重试');
          return;
        }

        const { code, data: pollData }: any = await queryExternalTaskResult(actualTaskId);
        syncCanvasVersionNumber(canvasId, pollData?.versionNumber);
        if (code !== 'SUCCESS' || !pollData) {
          updateNodeStatus(id, 'failure', pollData?.message || '查询失败，请重试');
          return;
        }

        if (pollData.status === 'RUNNING') {
          intervalRef.current = setTimeout(poll, 3000);
          return;
        }

        if (pollData.status === 'SUCCESS') {
          let resultInfo = pollData?.result;
          if (typeof resultInfo === 'string') {
            try {
              resultInfo = JSON.parse(resultInfo);
            } catch {
              // ignore
            }
          }
          const nextTable = resultInfo?.table;
          if (nextTable && Array.isArray(nextTable.columns) && Array.isArray(nextTable.data)) {
            const { table: adjustedTable, hasFirstRowImage } = await adjustFirstRowSizesForImages(nextTable as TableProtocol);
            const latest = dataRef.current;
            // AI 回填后列宽不均时切为自定义：与 table 同一次写入，避免二次 updateNodeData 用旧 dataRef 覆盖 table
            const shouldResetAspect = Boolean(hasFirstRowImage && latest?.params?.aspectRatio && latest.params.aspectRatio !== 'custom');
            if (shouldResetAspect) {
              const nextData = {
                ...latest,
                table: adjustedTable,
                params: {
                  ...latest.params,
                  aspectRatio: 'custom',
                },
              };
              dataRef.current = nextData;
              // 首行含图片时需提交列宽/行高变更；不入撤销栈
              updateNodeData(id, nextData, false, true);
            } else {
              // 首行含图片时需提交列宽/行高变更；否则仅更新本地。均不入撤销栈
              setTable(adjustedTable, false, hasFirstRowImage);
            }
          }
          updateNodeStatus(id, 'success');
          return;
        }

        if (pollData.status === 'FAILURE') {
          updateNodeStatus(id, 'failure', pollData?.message || '生成失败，请重试');
          updateUserPoint();
          return;
        }
      } catch (e) {
        console.error('storyboard poll error', e);
        updateNodeStatus(id, 'failure', '超时错误，请重试');
      }
    };

    intervalRef.current = setTimeout(poll, 200);
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
      intervalRef.current = null;
    };
  }, [status, actualTaskId, id, updateNodeStatus, setTable, dataRef, updateNodeData, updateUserPoint]);

  // 底部参数栏 select 变更
  const handlePromptSelect = (key: string, value: string) => {
    const latest = dataRef.current;
    updateNodeData(id, {
      ...latest,
      params: {
        ...latest.params,
        [key]: value as StoryboardMode,
      },
    });
  };

  const handlePromptChange = (next: string) => {
    const latest = dataRef.current;
    updateNodeData(
      id,
      {
        ...latest,
        params: {
          ...latest.params,
          prompt: next,
        },
      },
      false
    );
  };

  const buildPrompt = () => {
    const latest = dataRef.current;
    const basePrompt = String(latest?.params?.prompt ?? '').trim();
    const inputTexts = (textMap || []).map(t => String(t?.value ?? '').trim()).filter(Boolean);
    return [basePrompt, ...inputTexts].filter(Boolean).join('。');
  };

  const buildExternalTaskParamsByMode = useCallback(
    (m: StoryboardMode) => {
      const latest = dataRef.current;
      const model = String(latest?.params?.model ?? '');
      if (!model) return null;
      if (m === 'gen_script') {
        return {
          type: model,
          canvasId: String(canvasId || ''),
          nodeId: String(id || ''),
          data: {
            type: m,
            prompt: buildPrompt(),
          },
        };
      }

      if (m === 'video_understand') {
        // 视频反推：按后端预留参数传入视频列表
        return {
          type: model,
          canvasId: String(canvasId || ''),
          nodeId: String(id || ''),
          data: {
            type: m,
            videoUrlList: (videoMap || []).map(v => v.value).filter(Boolean),
          },
        };
      }

      // custom：自定义模式，传递连入的文本/图片/视频
      return {
        type: model,
        canvasId: String(canvasId || ''),
        nodeId: String(id || ''),
        data: {
          type: m,
          prompt: buildPrompt(),
          imageUrlList: (imageMap || []).map(i => i.value).filter(Boolean),
          videoUrlList: (videoMap || []).map(v => v.value).filter(Boolean),
        },
      };
    },
    // buildPrompt 依赖 textMap / dataRef，随 imageMap/videoMap/textMap 变化重建
    [canvasId, id, imageMap, textMap, videoMap, dataRef]
  );

  // 底部生成按钮
  const handleSend = async () => {
    if (isExcute || status === 'running' || storyboardStatus === 'running' || isStoryboardExcuteRef.current) return;

    const params = buildExternalTaskParamsByMode(mode);
    if (!params?.canvasId || !params?.nodeId) {
      toast.error('画布信息缺失，请刷新后重试');
      return;
    }

    setIsExcute(true);
    setNeedPoint(caculatePoint);
    try {
      const { code, data: resData, msg }: any = await createExternalTask(params as any);
      syncCanvasVersionNumber(canvasId, resData?.versionNumber);
      if (code === 'SUCCESS' && resData?.taskId) {
        setTempTaskId(String(resData.taskId));
        updateNodeStatus(id, 'running');
        updateUserPoint();
      } else {
        updateNodeStatus(id, 'failure', msg || '任务创建失败');
      }
    } catch (e: any) {
      console.error('storyboard create error', e);
      updateNodeStatus(id, 'failure', e.message || '任务创建失败');
    } finally {
      setIsExcute(false);
    }
  };

  return {
    isExcute,
    inputConnections,
    textMap,
    imageMap,
    videoMap,
    mediaInputs,
    caculatePoint,
    pointLoading,
    handlePromptSelect,
    handlePromptChange,
    handleSend,
  };
}

export type UseStoryboardScriptTaskReturn = ReturnType<typeof useStoryboardScriptTask>;
