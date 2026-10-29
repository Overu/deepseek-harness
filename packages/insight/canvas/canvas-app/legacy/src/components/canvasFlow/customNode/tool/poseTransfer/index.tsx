import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useState, useMemo, memo, useEffect, useRef, useCallback } from 'react';
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
import PoseTransferPromptModel from './PoseTransferPromptModel';
import util from '../../../utils/util';
import { useExternalTaskCostPoints } from '../useExternalTaskCostPoints';
import { getDefaultModelId, getModelConfig, modelHasResolution } from './poseTransferModels';

const nodeType = 'poseTransVideoTool';
const { handlersMap } = setting;
const { useNodeOperations, useNodeResizeObserver, useGetNodeInput, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight } = toolUtil;
const { getSourceMap } = util;
const handlers = handlersMap[nodeType];

const buildPoseTransferExternalTaskParams = (args: {
  canvasId: string;
  nodeId: string;
  imageUrl: string;
  videoUrl: string;
  params: Record<string, unknown>;
  childNodeIds?: string[];
}) => {
  const { canvasId, nodeId, imageUrl, videoUrl, params: p, childNodeIds } = args;
  const modelId = String(p.modelId || getDefaultModelId());
  const modelConfig = getModelConfig(modelId);
  const videoParams: Record<string, unknown> = {
    aspectRatio: p.aspect_ratio || modelConfig?.defaultAspectRatio || '16:9',
    personReplacement: Boolean(p.personReplacement),
  };
  if (modelConfig && modelHasResolution(modelConfig.modelId) && p.resolution) {
    videoParams.resolution = p.resolution;
  }

  const taskData: Record<string, unknown> = {
    modelId,
    prompt: String(p.prompt ?? '').trim(),
    imageUrlList: [imageUrl],
    videoUrlList: [videoUrl],
    videoParams,
  };

  if (childNodeIds?.length) {
    taskData.childNodeIds = childNodeIds;
  }

  return {
    type: 'POSE_TRANS_VIDEO',
    canvasId,
    nodeId,
    data: taskData,
  };
};

const PoseTransferTool = (props: any) => {
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const updateNodeInternals = useUpdateNodeInternals();
  const { updateUserPoint, setNeedPoint } = usePointStore(state => state.actions);
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle } = data;
  const { status, errorMsg, taskId } = taskInfo || {};
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  const nodeRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(false);
  const [tempTaskId, setTempTaskId] = useState('');
  const [execute, setExecute] = useState(false);
  const [gifShow, setGifShow] = useState(false);

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
  const { mediaInputs } = useGetNodeInput(id, nodes, edges);

  const actualWidth = useMemo(() => width || defaultWidth, [width]);
  const actualHeight = useMemo(() => height || defaultHeight, [height]);

  const sourceNodeIds = useMemo(() => getAllSourceNodeIds(edges, id), [edges, id]);

  const { imageUrl, videoUrl } = useMemo(() => {
    const { images, videos } = getSourceMap(nodes, edges, id);
    return {
      imageUrl: images[0]?.value || '',
      videoUrl: videos[0]?.value || '',
    };
  }, [nodes, edges, id]);

  const promptModalVisible = useMemo(() => !isSelection && selected, [isSelection, selected]);

  const actualTaskId = useMemo(() => tempTaskId || taskId, [taskId, tempTaskId]);

  const params = data.params || {};
  const modelId = String(params.modelId || getDefaultModelId());
  const resolution = params.resolution || '720p';
  const aspectRatio = params.aspect_ratio || getModelConfig(modelId)?.defaultAspectRatio || '16:9';

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const costKey = useMemo(() => {
    const parts = [`modelId=${String(modelId)}`, `ar=${String(aspectRatio)}`, `image=${imageUrl}`, `video=${videoUrl}`];
    if (modelHasResolution(modelId)) {
      parts.splice(1, 0, `res=${String(resolution)}`);
    }
    return parts.join('#');
  }, [modelId, resolution, aspectRatio, imageUrl, videoUrl]);

  const buildCostParams = useCallback(() => {
    if (!imageUrl || !videoUrl) return null;
    const latest = dataRef.current;
    return buildPoseTransferExternalTaskParams({
      canvasId: canvasId || '',
      nodeId: id,
      imageUrl,
      videoUrl,
      params: latest.params || {},
    });
  }, [canvasId, id, imageUrl, videoUrl]);

  const { caculatePoint, pointLoading } = useExternalTaskCostPoints({
    selected,
    costKey,
    buildCostParams,
  });

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
          const videoResultUrl = Array.isArray(videoUrls) ? videoUrls[0] : '';
          if (videoResultUrl && childNodeIdsRef.current[0] && !resData?.childNodeInfo) {
            applyChildNodeInfo({ [childNodeIdsRef.current[0]]: videoResultUrl });
          }
          if (videoResultUrl) {
            const latestData = dataRef.current;
            updateNodeData(
              id,
              {
                ...latestData,
                value: videoResultUrl,
                product: [{ value: videoResultUrl }],
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
    (patch: Record<string, unknown>) => {
      patchNodeData({ params: patch });
    },
    [patchNodeData]
  );

  const handlePromptChange = useCallback(
    (next: string) => {
      patchNodeData({ params: { prompt: next } }, false);
    },
    [patchNodeData]
  );

  const handleExecute = async () => {
    if (!imageUrl || !videoUrl || execute || toolPermissionDisabled || status === 'running') return;

    const childNodes = prepareChildNodes();
    if (!childNodes.length) return;
    const childNodeIds = childNodes.map(node => node.id);

    setExecute(true);
    setNeedPoint(caculatePoint);

    const latest = dataRef.current;
    const costParams = buildPoseTransferExternalTaskParams({
      canvasId: canvasId || '',
      nodeId: id,
      imageUrl,
      videoUrl,
      params: latest.params || {},
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
      <div className={styles.tool}>
        <ToolContent onTryConnect={() => handleAddPrevNode(nodeType, position)} type={nodeType} sourceNodeIds={sourceNodeIds} onTipClick={flag => setGifShow(flag)} />
      </div>
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
            <PoseTransferPromptModel
              status={status}
              isExcute={execute}
              imageUrl={imageUrl}
              videoUrl={videoUrl}
              mediaInputs={mediaInputs}
              data={data}
              onParamsChange={handleParamsChange}
              onChangePrompt={handlePromptChange}
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
    </div>
  );
};

export default memo(PoseTransferTool);
