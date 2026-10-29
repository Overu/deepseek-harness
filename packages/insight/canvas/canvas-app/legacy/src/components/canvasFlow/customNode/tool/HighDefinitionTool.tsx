import { isDesktopProcessOwned } from '../../../../../../src/process-ownership';
import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import HighDefinition from '../../components/toolControl/HighDefinition';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import ToolContent from '../../components/nodeControl/ToolContent';
import LimitHandler from '../../customHandler/LimitHandler';
import ToolModal from '../../components/promptControl/ToolModal';
import { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import setting from '../../settings/setting';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import type { Handler } from '../../utils/type';
import styles from './index.module.less';
import { compressImage } from '@/utils';
import { getImageHdPoints, createExternalTask, queryExternalTaskResult } from '@/api/tool';
import { usePointStore } from '@/store/pointStore';
import GifContent from '../../components/nodeControl/GifContent';
import util from '../../utils/util';
import { toast } from 'sonner';

const nodeType = 'highDefinitionTool';
const { handlersMap } = setting;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight } = toolUtil;
const handlers = handlersMap[nodeType];
const { getSourceMap } = util;

const HighDefinitionTool = (props: any) => {
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle, time } = data;
  const { status, errorMsg, taskId } = taskInfo;
  const [apiErrorMsg, setApiErrorMsg] = useState('');
  const [focus, setFocus] = useState(false);
  const [sourceNodeIds, setSourceNodeIds] = useState([] as string[]);
  const [caculatePoint, setCaculatePoint] = useState(0);
  const nodeRef = useRef<any>(null);
  const dataRef = useRef(data);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef(false);
  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const canvasId = useFlowStore(state => state.canvasId);
  const nodes = useFlowStore(state => state.nodes);
  const [tempTaskId, setTempTaskId] = useState('');

  const { updateNodeData, updateNodeStatus } = useFlowStore(state => state.actions);
  const { prepareChildNodes, attachChildNodes, markChildNodesFailure, applyChildNodeInfo, applyChildNodeInfoFromPollData, childNodeIdsRef } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    sourceHandleId: 'image_source',
  });
  const [gifShow, setGifShow] = useState(false);
  const [imageList, setImageList] = useState([] as string[]);
  const [pointLoading, setPointLoading] = useState(false);
  const [execute, setExecute] = useState(false);

  const { setNeedPoint, updateUserPoint } = usePointStore(state => state.actions);

  useEffect(() => {
    const { images } = getSourceMap(nodes, edges, id);
    setImageList(images.map(item => item.value));
  }, [edges, nodes]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const desktopOwned = isDesktopProcessOwned(id);
  const actualTaskId = useMemo(() => {
    return tempTaskId || taskId;
  }, [taskId, tempTaskId]);

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle, handleAddPrevNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  useNodeResizeObserver(nodeRef, id, updateNodeInternals);
  useImageNodeDimensions(id, value, width, height, time);

  const actualWidth = useMemo(() => {
    return width || defaultWidth;
  }, [width]);
  const actualHeight = useMemo(() => {
    return height || defaultHeight;
  }, [height]);

  const previewUrls = useMemo(() => {
    return [value];
  }, [value]);

  useEffect(() => {
    const sourceNodeIds = getAllSourceNodeIds(edges, id);
    setSourceNodeIds(sourceNodeIds);
  }, [edges]);

  const handleSuccess = (url: string) => {
    if (url === value) {
      return;
    }
    const latestData = dataRef.current;
    updateNodeData(
      id,
      {
        ...latestData,
        value: url,
        product: [{ value: url }],
      },
      true,
      false
    );
  };

  const handleStatus = (nextStatus: 'running' | 'success' | 'failure' | 'interrupt', msg?: string) => {
    updateNodeStatus(id, nextStatus);
    setApiErrorMsg(msg || '');
  };

  const handleFailure = useCallback(
    (message?: string) => {
      const errorMessage = message || '高清化失败，请重试';
      setExecute(false);
      handleStatus('failure', errorMessage);
      markChildNodesFailure(errorMessage);
      updateUserPoint();
    },
    [markChildNodesFailure, updateUserPoint]
  );

  // 计算点数 - 通过接口获取
  const calculatePoints = async () => {
    if (!imageList.length) {
      setCaculatePoint(0);
      return;
    }
    setPointLoading(true);

    try {
      const param = {
        urlList: imageList,
        resolution: data.params?.resolution || '2K',
        canvasId: canvasId || '',
        nodeId: id || '',
      };
      const { code, data: result }: any = await getImageHdPoints(param);
      if (code === 'SUCCESS' && result) {
        setCaculatePoint(result);
        setNeedPoint(result);
      } else {
        setCaculatePoint(0);
        setNeedPoint(0);
      }
    } catch (error) {
      console.error('计算点数失败:', error);
      setCaculatePoint(0);
    } finally {
      setPointLoading(false);
    }
  };

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
          intervalRef.current = setTimeout(() => pollResult(pollTaskId), 2000);
          return;
        }

        if (resultData.status === 'SUCCESS') {
          const resultImageList: string[] = resultData.result?.imageList || [];
          applyChildNodeInfoFromPollData(resultData);
          if (resultImageList[0] && childNodeIdsRef.current[0] && !resultData?.childNodeInfo) {
            applyChildNodeInfo({ [childNodeIdsRef.current[0]]: resultImageList[0] });
          }
          if (resultImageList[0] && resultImageList[0] !== value) {
            handleSuccess(resultImageList[0]);
          }
          setExecute(false);
          handleStatus('success');
          updateUserPoint();
          return;
        }

        handleFailure(resultData.message);
      } catch {
        handleFailure('超时错误，请重试');
      } finally {
        pollingRef.current = false;
      }
    },
    [applyChildNodeInfo, applyChildNodeInfoFromPollData, childNodeIdsRef, handleFailure, value, updateUserPoint]
  );

  useEffect(() => {
    if (!desktopOwned && status === 'running' && actualTaskId) {
      pollResult(actualTaskId);
    }
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [status, actualTaskId, pollResult, desktopOwned]);

  useEffect(() => {
    if (status === 'running') {
      setExecute(true);
    }
  }, [status]);

  // 创建高清化任务
  const handleGetHigh = async (imageList: string[] | undefined, params: { resolution?: string; taskId?: string }) => {
    if (!imageList?.length || status === 'running' || execute) {
      return;
    }
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
        type: 'IMAGE_UPSCALE',
        canvasId: canvasId || '',
        nodeId: id,
        data: {
          imageUrlList: [imageList[0]],
          imageParam: { resolution: params.resolution || '2K' },
          childNodeIds,
        },
      });
      syncCanvasVersionNumber(canvasId, res.data?.versionNumber);
      if (res.code === 'SUCCESS' && res.data?.taskId) {
        await attachChildNodes(childNodes);
        setTempTaskId(res.data.taskId);
        handleStatus('running');
        updateUserPoint();
      } else {
        setExecute(false);
        toast.error(res.msg || '高清化任务创建失败');
        handleStatus('failure', res.msg || '高清化任务创建失败');
      }
    } catch {
      setExecute(false);
      handleStatus('failure', '高清化任务创建失败');
    }
  };

  // 使用 useMemo 缓存 imageList，只有当内容真正变化时才更新
  const memoizedImageList = useMemo(() => {
    return imageList;
  }, [JSON.stringify(imageList)]);

  // 当图片URL或分辨率变化时重新计算点数
  useEffect(() => {
    if (!caculatePoint && !selected) {
      return;
    }
    calculatePoints();
  }, [memoizedImageList, data.params?.resolution, canvasId, id]);

  useEffect(() => {
    if (!selected) {
      setGifShow(false);
    }
    if (selected && !caculatePoint) {
      calculatePoints();
    }
  }, [selected]);

  const handleParamsChange = (params: { resolution?: string; taskId?: string }) => {
    const latestData = dataRef.current;
    updateNodeData(id, {
      ...latestData,
      params: {
        ...latestData.params,
        ...(params.resolution && { resolution: params.resolution }),
        ...(params.taskId && { taskId: params.taskId }),
      },
    });
  };

  return (
    <div ref={nodeRef} className='rounded-2xl relative hover:ring-2 ring-white/65 transition-all' style={{ width: actualWidth, height: actualHeight }}>
      {handlers.map((item: Handler) => {
        return <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />;
      })}
      {value ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full'>
          <img src={compressImage(value)} className='rounded-2xl w-full h-full bg-[#262626]'></img>
          <div className={`${styles.toolNoBg} absolute inset-0`}>
            <ToolContent
              onTryConnect={() => handleAddPrevNode(nodeType, position)}
              type={nodeType}
              sourceNodeIds={sourceNodeIds}
              sourceValue={value}
              onTipClick={flag => setGifShow(flag)}
            ></ToolContent>
          </div>
        </div>
      ) : (
        <div className={styles.tool}>
          <ToolContent
            onTryConnect={() => handleAddPrevNode(nodeType, position)}
            type={nodeType}
            sourceNodeIds={sourceNodeIds}
            sourceValue={value}
            onTipClick={flag => setGifShow(flag)}
          ></ToolContent>
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
      {status === 'failure' && <StatusOverlay status={status} errorMsg={errorMsg || apiErrorMsg} type={nodeType} id={id} />}
      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation type={nodeType} url={value} status={status} previewUrls={previewUrls} onCopy={handleCopy} onDelete={handleDelete}></NodeOperation>
      </NodeToolbar>
      <NodeToolbar isVisible={!isSelection && selected && sourceNodeIds.length > 0} position={Position.Bottom} align='center'>
        <ToolModal id={id}>
          <HighDefinition
            status={status}
            onParamsChange={handleParamsChange}
            initialResolution={data.params?.resolution}
            caculatePoint={caculatePoint}
            pointLoading={pointLoading}
            execute={execute}
            onLayerClick={handleGetHigh}
            permissionDisabled={toolPermissionDisabled || desktopOwned}
          ></HighDefinition>
        </ToolModal>
      </NodeToolbar>
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType}></GifContent>
      </NodeToolbar>
    </div>
  );
};

export default memo(HighDefinitionTool);
