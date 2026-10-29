import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useState, useMemo, memo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import setting from '../../../settings/setting';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import hooks from '../../../hooks';
import toolUtil from '../../../utils/toolUtil';
import type { Handler } from '../../../utils/type';
import styles from '../index.module.less';
import { createExternalTask, queryExternalTaskResult } from '@/api/tool';
import { usePointStore } from '@/store/pointStore';
import NodeOperation from '../../../components/nodeControl/NodeOperation';
import NodeTitle from '../../../components/nodeControl/NodeTitle';
import StatusOverlay from '../../../components/nodeControl/StatusOverlay';
import ToolContent from '../../../components/nodeControl/ToolContent';
import LimitHandler from '../../../customHandler/LimitHandler';
import ToolModal from '../../../components/promptControl/ToolModal';
import GifContent from '../../../components/nodeControl/GifContent';
import VideoPlayer from '@/components/common/fileControl/VideoPlayer';
import MediaPreview from '@/components/common/MediaPreview';
import ImageLipSyncPromptModel from './ImageLipSyncPromptModel';
import { getAudioDuration } from '../../../components/toolControl/AudioClip';
import { EMPTY_CHARACTER_INFO, type CharacterInfo, type LipSyncMode } from './types';
import util from '../../../utils/util';
import { useExternalTaskCostPoints } from '../useExternalTaskCostPoints';

const nodeType = 'imageLipSyncTool';
const { handlersMap } = setting;
const { useVideoNodeDimensions, useNodeOperations, useNodeResizeObserver, useGetNodeInput, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight } = toolUtil;
const { getSourceMap } = util;
const handlers = handlersMap[nodeType];

const buildImageLipSyncExternalTaskParams = (args: {
  canvasId: string;
  nodeId: string;
  imageUrl: string;
  audioUrl: string;
  params: Record<string, unknown>;
  characterInfo: CharacterInfo;
  childNodeIds?: string[];
}) => {
  const { canvasId, nodeId, imageUrl, audioUrl, params: p, characterInfo, childNodeIds } = args;
  const mode: LipSyncMode = (p.mode as LipSyncMode) || 'single';
  const taskData: Record<string, unknown> = {
    mode,
    modelId: p.modelId,
    prompt: p.prompt,
    imageUrlList: [imageUrl],
    audioUrlList: [audioUrl],
    videoParams: { resolution: p.resolution || '720p' },
    audioParams: {
      clip: {
        startSecond: p.audioStartSecond ?? 0,
        endSecond: p.audioEndSecond ?? 0,
      },
    },
  };

  if (childNodeIds?.length) {
    taskData.childNodeIds = childNodeIds;
  }

  if (mode === 'multiple' && characterInfo.maskUrls?.length) {
    taskData.maskOrderedCrops = {
      maskUrls: characterInfo.maskUrls,
      index: p.selectedCharacterIndexes || [],
    };
  }

  return {
    type: 'IMAGE_LIP_SYNC',
    canvasId,
    nodeId,
    data: taskData,
  };
};

const ImageLipSyncTool = (props: any) => {
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const updateNodeInternals = useUpdateNodeInternals();
  const { updateUserPoint, setNeedPoint } = usePointStore(state => state.actions);
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle, time, characterInfo: characterInfoProp } = data;
  const { status, errorMsg, taskId } = taskInfo || {};
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  const nodeRef = useRef<HTMLDivElement>(null);
  const prevAudioUrlRef = useRef('');
  const [focus, setFocus] = useState(false);
  const [tempTaskId, setTempTaskId] = useState('');
  const [execute, setExecute] = useState(false);
  const [gifShow, setGifShow] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const canvasId = useFlowStore(state => state.canvasId);
  const { updateNodeData, updateNodeStatus } = useFlowStore(state => state.actions);
  const { prepareChildNodes, attachChildNodes, markChildNodesFailure, applyChildNodeInfo, applyChildNodeInfoFromPollData, childNodeIdsRef } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    childType: 'video',
    sourceHandleId: 'video_source',
  });

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle, handleAddPrevNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  useNodeResizeObserver(nodeRef as React.RefObject<HTMLElement>, id, updateNodeInternals);
  useVideoNodeDimensions(id, value, width, height, time);
  useGetNodeInput(id, nodes, edges);

  const actualWidth = useMemo(() => width || defaultWidth, [width]);
  const actualHeight = useMemo(() => height || defaultHeight, [height]);

  const sourceNodeIds = useMemo(() => getAllSourceNodeIds(edges, id), [edges, id]);

  const { imageUrl, audioUrl } = useMemo(() => {
    const { images, audios } = getSourceMap(nodes, edges, id);
    return {
      imageUrl: images[0]?.value || '',
      audioUrl: audios[0]?.value || '',
    };
  }, [nodes, edges, id]);

  const promptModalVisible = useMemo(() => !isSelection && selected, [isSelection, selected]);

  const actualTaskId = useMemo(() => tempTaskId || taskId, [taskId, tempTaskId]);

  const characterInfo: CharacterInfo = characterInfoProp || EMPTY_CHARACTER_INFO;

  const params = data.params || {};
  const modelId = params.modelId || 'omni_v15';
  const resolution = params.resolution || '720p';
  const audioStartSecond = params.audioStartSecond ?? 0;
  const audioEndSecond = params.audioEndSecond ?? 0;

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const costKey = useMemo(() => {
    // 影响价格：模型 + 分辨率 + 音频截取；同时纳入输入 URL，保证连线就绪/变更时能触发重算
    return [
      `modelId=${String(modelId)}`,
      `resolution=${String(resolution)}`,
      `as=${String(audioStartSecond)}`,
      `ae=${String(audioEndSecond)}`,
      `image=${imageUrl}`,
      `audio=${audioUrl}`,
    ].join('#');
  }, [audioEndSecond, audioStartSecond, audioUrl, imageUrl, modelId, resolution]);

  const buildCostParams = useCallback(() => {
    if (!imageUrl || !audioUrl) return null;
    const latest = dataRef.current;
    return buildImageLipSyncExternalTaskParams({
      canvasId: canvasId || '',
      nodeId: id,
      imageUrl,
      audioUrl,
      params: latest.params || {},
      characterInfo: latest.characterInfo || EMPTY_CHARACTER_INFO,
    });
  }, [audioUrl, canvasId, id, imageUrl]);

  const { caculatePoint, pointLoading } = useExternalTaskCostPoints({
    selected,
    costKey,
    buildCostParams,
  });

  useEffect(() => {
    if (!audioUrl) {
      prevAudioUrlRef.current = '';
      const latest = dataRef.current;
      if ((latest.params?.audioEndSecond ?? 0) > 0) {
        updateNodeData(
          id,
          {
            ...latest,
            params: { ...latest.params, audioStartSecond: 0, audioEndSecond: 0 },
          },
          true,
          true
        );
      }
      return;
    }

    const previousUrl = prevAudioUrlRef.current;
    if (previousUrl === audioUrl) return;

    const isSourceChange = previousUrl !== '';
    const hasSavedClip = (dataRef.current.params?.audioEndSecond ?? 0) > 0;
    prevAudioUrlRef.current = audioUrl;

    // 画布重载且已有持久化截取：保留 params，时长由 PromptModel 拉取
    if (!isSourceChange && hasSavedClip) return;

    let cancelled = false;
    getAudioDuration(audioUrl)
      .then(duration => {
        if (cancelled) return;
        const latest = dataRef.current;
        updateNodeData(
          id,
          {
            ...latest,
            params: {
              ...latest.params,
              audioStartSecond: 0,
              audioEndSecond: duration,
            },
          },
          true,
          true
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [audioUrl, id, updateNodeData]);

  useEffect(() => {
    if (!selected) setGifShow(false);
  }, [selected]);

  useEffect(() => {
    if (status !== 'running' || !actualTaskId) return;

    const poll = async () => {
      try {
        const { code, data: resData }: any = await queryExternalTaskResult({ taskId: actualTaskId });
        syncCanvasVersionNumber(canvasId, resData?.versionNumber);
        if (code !== 'SUCCESS' || !resData) {
          const errorMessage = '任务查询失败';
          setExecute(false);
          updateNodeStatus(id, 'failure', errorMessage);
          markChildNodesFailure(errorMessage);
          return;
        }
        if (resData.status === 'RUNNING') {
          intervalRef.current = setTimeout(poll, 3000);
        } else if (resData.status === 'SUCCESS') {
          applyChildNodeInfoFromPollData(resData);
          const videoUrls = resData.result?.videoUrls;
          const videoUrl = Array.isArray(videoUrls) ? videoUrls[0] : '';
          if (videoUrl && childNodeIdsRef.current[0] && !resData?.childNodeInfo) {
            applyChildNodeInfo({ [childNodeIdsRef.current[0]]: videoUrl });
          }
          if (videoUrl) {
            const latestData = dataRef.current;
            updateNodeData(
              id,
              {
                ...latestData,
                value: videoUrl,
                product: [{ value: videoUrl }],
              },
              true,
              false
            );
          }
          setExecute(false);
          updateNodeStatus(id, 'success');
          updateUserPoint();
        } else {
          const errorMessage = resData.message || '生成失败，请重试';
          setExecute(false);
          updateNodeStatus(id, 'failure', errorMessage);
          markChildNodesFailure(errorMessage);
          updateUserPoint();
        }
      } catch {
        const errorMessage = '超时错误，请重试';
        setExecute(false);
        updateNodeStatus(id, 'failure', errorMessage);
        markChildNodesFailure(errorMessage);
      }
    };

    intervalRef.current = setTimeout(poll, 200);
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [status, actualTaskId, id, updateNodeData, updateNodeStatus, updateUserPoint, applyChildNodeInfo, applyChildNodeInfoFromPollData, childNodeIdsRef, markChildNodesFailure]);

  useEffect(() => {
    if (status === 'running') {
      setExecute(true);
    }
  }, [status]);

  const patchNodeData = useCallback(
    (patch: Record<string, unknown>, isRecord = true) => {
      const storeNode = useFlowStore.getState().nodes.find(n => n.id === id);
      const latest = storeNode?.data ?? dataRef.current;
      const newData = {
        ...latest,
        ...patch,
        params: patch.params ? { ...(latest.params || {}), ...(patch.params as object) } : latest.params,
      };
      dataRef.current = newData;
      updateNodeData(id, newData, isRecord, isRecord);
    },
    [id, updateNodeData]
  );

  const handleParamsChange = useCallback(
    (patch: Record<string, unknown>, options?: { characterInfo?: CharacterInfo }) => {
      const update: Record<string, unknown> = { params: patch };
      if (options?.characterInfo !== undefined) {
        update.characterInfo = options.characterInfo;
      }
      patchNodeData(update);
    },
    [patchNodeData]
  );

  const handleChangePrompt = useCallback(
    (prompt: string) => {
      handleParamsChange({ prompt });
    },
    [handleParamsChange]
  );

  const handleCharacterInfoChange = useCallback(
    (info: CharacterInfo, selectedIndexes?: number[]) => {
      if (selectedIndexes !== undefined) {
        patchNodeData(
          {
            characterInfo: info,
            params: { selectedCharacterIndexes: selectedIndexes },
          },
          false
        );
      } else {
        patchNodeData({ characterInfo: info }, false);
      }
    },
    [patchNodeData]
  );

  const handleExecute = async () => {
    if (!imageUrl || !audioUrl || execute || toolPermissionDisabled || status === 'running') return;

    const childNodes = prepareChildNodes();
    if (!childNodes.length) return;
    const childNodeIds = childNodes.map(node => node.id);

    setExecute(true);
    setNeedPoint(caculatePoint);

    const latest = dataRef.current;
    const costParams = buildImageLipSyncExternalTaskParams({
      canvasId: canvasId || '',
      nodeId: id,
      imageUrl,
      audioUrl,
      params: latest.params || {},
      characterInfo: latest.characterInfo || EMPTY_CHARACTER_INFO,
      childNodeIds,
    });

    try {
      const res: any = await createExternalTask(costParams);
      syncCanvasVersionNumber(canvasId, res.data?.versionNumber);
      if (res.code === 'SUCCESS' && res.data?.taskId) {
        await attachChildNodes(childNodes);
        setTempTaskId(res.data.taskId);
        updateNodeStatus(id, 'running');
        updateUserPoint();
      } else {
        setExecute(false);
        updateNodeStatus(id, 'failure', res.msg || '任务创建失败');
      }
    } catch (e: any) {
      setExecute(false);
      updateNodeStatus(id, 'failure', e.message || '任务创建失败');
    }
  };

  const previewUrls = useMemo(() => (value ? [value] : []), [value]);

  return (
    <div ref={nodeRef} className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'}`} style={{ width: actualWidth, height: actualHeight }}>
      {handlers.map((item: Handler) => (
        <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />
      ))}
      {value ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full'>
          <div className='w-full h-full' onDoubleClick={() => setPreviewVisible(true)}>
            <VideoPlayer url={value} />
          </div>
        </div>
      ) : (
        <div className={styles.tool}>
          <ToolContent onTryConnect={() => handleAddPrevNode(nodeType, position)} type={nodeType} sourceNodeIds={sourceNodeIds} onTipClick={flag => setGifShow(flag)} />
        </div>
      )}
      <NodeTitle
        name={title}
        nodeType={nodeType}
        selected={selected}
        titleStyle={titleStyle}
        setTitleStyle={handleChangeTitleStyle}
        onEdit={handleEdit}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      />
      {status === 'failure' && <StatusOverlay status={status} errorMsg={errorMsg} type={nodeType} id={id} />}
      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation type={nodeType} url={value} status={status} previewUrls={previewUrls} onCopy={handleCopy} onDelete={handleDelete} />
      </NodeToolbar>
      {promptModalVisible && (
        <NodeToolbar isVisible={promptModalVisible} position={Position.Bottom} align='center'>
          <ToolModal id={id} radius='large'>
            <ImageLipSyncPromptModel
              nodeId={id}
              canvasId={canvasId || ''}
              data={data}
              status={status}
              isExcute={execute}
              imageUrl={imageUrl}
              audioUrl={audioUrl}
              characterInfo={characterInfo}
              onChangePrompt={handleChangePrompt}
              onParamsChange={handleParamsChange}
              onCharacterInfoChange={handleCharacterInfoChange}
              onSend={handleExecute}
              caculatePoint={caculatePoint}
              pointLoading={pointLoading}
            />
          </ToolModal>
        </NodeToolbar>
      )}
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType} />
      </NodeToolbar>
      {previewVisible && createPortal(<MediaPreview visible={previewVisible} url={previewUrls} type={['video']} onClose={() => setPreviewVisible(false)} />, document.body)}
    </div>
  );
};

export default memo(ImageLipSyncTool);
