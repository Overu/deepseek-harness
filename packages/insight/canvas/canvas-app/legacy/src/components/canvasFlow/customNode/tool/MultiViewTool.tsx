import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import MultiView from '../../components/toolControl/MultiView';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import ToolContent from '../../components/nodeControl/ToolContent';
import LimitHandler from '../../customHandler/LimitHandler';
import ToolModal from '../../components/promptControl/ToolModal';
import { useState, useMemo, memo, useEffect, useRef, useCallback } from 'react';
import setting from '../../settings/setting';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import type { Handler } from '../../utils/type';
import styles from './index.module.less';
import { compressImage } from '@/utils';
import { createExternalTask, queryExternalTaskResult } from '@/api/tool';
import GifContent from '../../components/nodeControl/GifContent';
import { usePointStore } from '@/store/pointStore';
import { toast } from 'sonner';

interface MultiViewParams {
  horizontal: number;
  vertical: number;
  zoom: number;
}

const nodeType = 'multiViewTool';
const { handlersMap } = setting;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useSinglePointCaculate, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight } = toolUtil;
const handlers = handlersMap[nodeType];

const MultiViewTool = (props: any) => {
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const updateNodeInternals = useUpdateNodeInternals();
  const { updateUserPoint, setNeedPoint } = usePointStore(state => state.actions);
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle, time, params } = data;
  const { status, errorMsg, taskId } = taskInfo;
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef(false);
  const dataRef = useRef(data);
  const nodeRef = useRef<any>(null);
  const [focus, setFocus] = useState(false);
  const [tempTaskId, setTempTaskId] = useState('');
  const [execute, setExecute] = useState(false);
  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const canvasId = useFlowStore(state => state.canvasId);
  const [gifShow, setGifShow] = useState(false);

  const { updateNodeData, updateNodeStatus } = useFlowStore(state => state.actions);
  const { prepareChildNodes, attachChildNodes, markChildNodesFailure, applyChildNodeInfo, applyChildNodeInfoFromPollData, childNodeIdsRef } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    sourceHandleId: 'image_source',
  });

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle, handleAddPrevNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  useNodeResizeObserver(nodeRef, id, updateNodeInternals);
  useImageNodeDimensions(id, value, width, height, time);
  const caculatePoint = useSinglePointCaculate(params);

  const actualWidth = useMemo(() => {
    return width || defaultWidth;
  }, [width]);
  const actualHeight = useMemo(() => {
    return height || defaultHeight;
  }, [height]);

  const previewUrls = useMemo(() => {
    return [value];
  }, [value]);

  const sourceNodeIds = useMemo(() => {
    return getAllSourceNodeIds(edges, id);
  }, [edges, id]);

  const promptModalVisible = useMemo(() => {
    return !isSelection && selected && sourceNodeIds.length > 0;
  }, [isSelection, selected, sourceNodeIds]);

  const actualTaskId = useMemo(() => {
    return tempTaskId || taskId;
  }, [taskId, tempTaskId]);

  useEffect(() => {
    dataRef.current = data; // 每次 data 更新时同步到 ref
  }, [data]);

  const handleFailure = useCallback(
    (message?: string) => {
      const errorMessage = message || '超时错误，请重试';
      setExecute(false);
      updateNodeStatus(id, 'failure', errorMessage);
      markChildNodesFailure(errorMessage);
      updateUserPoint();
    },
    [id, markChildNodesFailure, updateNodeStatus, updateUserPoint]
  );

  const pollResult = useCallback(
    async (pollTaskId: string) => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const { code, data: resultData }: any = await queryExternalTaskResult({ taskId: pollTaskId });
        syncCanvasVersionNumber(canvasId, resultData?.versionNumber);
        if (code !== 'SUCCESS' || !resultData) {
          handleFailure('任务查询失败');
          return;
        }

        if (resultData.status === 'RUNNING') {
          pollingRef.current = false;
          intervalRef.current = setTimeout(() => pollResult(pollTaskId), 3000);
          return;
        }
        if (resultData.status === 'SUCCESS') {
          const imageList: string[] = resultData.result?.imageList || [];
          applyChildNodeInfoFromPollData(resultData);
          if (imageList[0] && childNodeIdsRef.current[0] && !resultData?.childNodeInfo) {
            applyChildNodeInfo({ [childNodeIdsRef.current[0]]: imageList[0] });
          }
          const latestData = dataRef.current;
          updateNodeData(
            id,
            {
              ...latestData,
              value: imageList[0],
              product: imageList.map(item => ({ value: item })),
            },
            true,
            false
          );
          setExecute(false);
          updateNodeStatus(id, 'success');
          updateUserPoint();
          return;
        }
        handleFailure(resultData.message);
      } catch (error) {
        console.log('error', error);
        handleFailure('超时错误，请重试');
      } finally {
        pollingRef.current = false;
      }
    },
    [applyChildNodeInfo, applyChildNodeInfoFromPollData, childNodeIdsRef, handleFailure, id, updateNodeData, updateNodeStatus, updateUserPoint]
  );

  useEffect(() => {
    if (status === 'running' && actualTaskId) {
      pollResult(actualTaskId);
    }
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [status, actualTaskId, pollResult]);

  useEffect(() => {
    if (status === 'running') {
      setExecute(true);
    }
  }, [status]);

  const handleExcute = async (imageList: string[] | undefined, multiViewParams: MultiViewParams) => {
    if (!imageList || status === 'running' || execute) return;
    const childNodes = prepareChildNodes();
    if (!childNodes.length) {
      toast.error('创建输出节点失败');
      return;
    }
    const childNodeIds = childNodes.map(node => node.id);
    setExecute(true);
    setNeedPoint(caculatePoint);
    try {
      const res: any = await createExternalTask({
        type: 'MULTI_ANGLES',
        canvasId: canvasId || '',
        nodeId: id,
        data: {
          imageUrlList: imageList,
          imageParam: {
            zoom: multiViewParams.zoom,
            horizontalAngle: multiViewParams.horizontal > 0 ? multiViewParams.horizontal : multiViewParams.horizontal + 360,
            verticalAngle: multiViewParams.vertical,
          },
          childNodeIds,
        },
      });
      syncCanvasVersionNumber(canvasId, res.data?.versionNumber);
      if (res.code === 'SUCCESS' && res.data?.taskId) {
        await attachChildNodes(childNodes);
        setTempTaskId(res.data.taskId);
        updateNodeStatus(id, 'running');
        updateUserPoint();
      } else {
        setExecute(false);
        updateNodeStatus(id, 'failure', res.msg || '多视角任务创建失败');
      }
    } catch {
      setExecute(false);
      updateNodeStatus(id, 'failure', '多视角任务创建失败');
    }
  };

  const handleParamsChange = (multiViewParams: MultiViewParams) => {
    const latestData = dataRef.current;
    updateNodeData(id, {
      ...latestData,
      params: {
        ...latestData.params,
        zoom: multiViewParams.zoom,
        horizontalAngle: multiViewParams.horizontal,
        verticalAngle: multiViewParams.vertical,
      },
    });
  };

  return (
    // 修改容器样式，使用动态计算的尺寸
    <div ref={nodeRef} className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'}`} style={{ width: actualWidth, height: actualHeight }}>
      {handlers.map((item: Handler) => {
        return <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />;
      })}
      {value ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full'>
          <img src={compressImage(value)} className='rounded-2xl w-full h-full bg-[#262626]'></img>
        </div>
      ) : (
        <div className={styles.tool}>
          <ToolContent onTryConnect={() => handleAddPrevNode(nodeType, position)} type={nodeType} sourceNodeIds={sourceNodeIds} onTipClick={flag => setGifShow(flag)}></ToolContent>
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
      ></NodeTitle>
      {status === 'failure' && <StatusOverlay status={status} errorMsg={errorMsg} type={nodeType} id={id} />}
      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation type={nodeType} url={value} status={status} previewUrls={previewUrls} onCopy={handleCopy} onDelete={handleDelete}></NodeOperation>
      </NodeToolbar>
      <NodeToolbar isVisible={promptModalVisible} position={Position.Bottom} align='center'>
        <ToolModal id={id}>
          <MultiView
            isExcute={execute}
            status={status}
            caculatePoint={caculatePoint}
            zoom={params.zoom}
            horizontal={params.horizontalAngle}
            vertical={params.verticalAngle}
            onLayerClick={handleExcute}
            onParamsChange={handleParamsChange}
            permissionDisabled={toolPermissionDisabled}
          />
        </ToolModal>
      </NodeToolbar>
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType}></GifContent>
      </NodeToolbar>
    </div>
  );
};

export default memo(MultiViewTool);
