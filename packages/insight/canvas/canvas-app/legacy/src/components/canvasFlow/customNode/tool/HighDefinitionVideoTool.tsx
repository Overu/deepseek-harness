import { isDesktopProcessOwned } from '../../../../../../src/process-ownership';
import { NodeToolbar, Position, useUpdateNodeInternals, type HandleType, type Position as PsoitionType } from '@xyflow/react';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import HighDefinitionVideo from '../../components/toolControl/HighDefinitionVideo';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import ToolContent from '../../components/nodeControl/ToolContent';
import GifContent from '../../components/nodeControl/GifContent';
import LimitHandler from '../../customHandler/LimitHandler';
import ToolModal from '../../components/promptControl/ToolModal';
import { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import setting from '../../settings/setting';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import styles from './index.module.less';
import VideoPlayer from '@/components/common/fileControl/VideoPlayer';
import { getVideoHdPoints, createExternalTask, queryExternalTaskResult } from '@/api/tool';
import { usePointStore } from '@/store/pointStore';
import util from '../../utils/util';
import { toast } from 'sonner';

const nodeType = 'highDefinitionVideoTool';
const { handlersMap } = setting;
const { useVideoNodeDimensions, useNodeOperations, useNodeResizeObserver, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight } = toolUtil;
const handlers = handlersMap[nodeType];
const { getSourceMap } = util;

interface Handler {
  type: HandleType;
  position: PsoitionType;
  id: string;
  style: any;
  limit?: number;
}

const HighDefinitionVideoTool = (props: any) => {
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
  const { edges, isSelection, nodes } = useFlowStore(state => state);
  const canvasId = useFlowStore(state => state.canvasId);
  const { updateNodeData, updateNodeStatus } = useFlowStore(state => state.actions);
  const { prepareChildNodes, attachChildNodes, markChildNodesFailure, applyChildNodeInfo, applyChildNodeInfoFromPollData, childNodeIdsRef } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    childType: 'video',
    sourceHandleId: 'video_source',
  });
  const [gifShow, setGifShow] = useState(false);
  const [videoList, setVideoList] = useState([] as string[]);
  const [pointLoading, setPointLoading] = useState(false);
  const [execute, setExecute] = useState(false);
  const [tempTaskId, setTempTaskId] = useState('');

  const { setNeedPoint, updateUserPoint } = usePointStore(state => state.actions);

  useEffect(() => {
    const { videos } = getSourceMap(nodes, edges, id);
    setVideoList(videos.map(item => item.value));
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
  useVideoNodeDimensions(id, value, width, height, time);

  const actualWidth = useMemo(() => {
    return width || defaultWidth;
  }, [width]);
  const actualHeight = useMemo(() => {
    return height || defaultHeight;
  }, [height]);

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
      const errorMessage = message || '视频高清化失败，请重试';
      setExecute(false);
      handleStatus('failure', errorMessage);
      markChildNodesFailure(errorMessage);
      updateUserPoint();
    },
    [markChildNodesFailure, updateUserPoint]
  );

  const calculatePoints = async () => {
    if (!videoList.length) {
      setCaculatePoint(0);
      return;
    }
    setPointLoading(true);

    try {
      const param = {
        urlList: videoList,
        resolution: data.params?.resolution || '720p',
        canvasId: canvasId || '',
        nodeId: id || '',
      };
      const { code, data: result }: any = await getVideoHdPoints(param);
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

  const memoizedVideoList = useMemo(() => {
    return videoList;
  }, [JSON.stringify(videoList)]);

  useEffect(() => {
    if (!caculatePoint && !selected) {
      return;
    }
    calculatePoints();
  }, [memoizedVideoList, data.params?.resolution, canvasId, id]);

  useEffect(() => {
    if (!selected) {
      setGifShow(false);
    }
    if (selected && !caculatePoint) {
      calculatePoints();
    }
  }, [selected]);

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
          const videoUrls: string[] = resultData.result?.videoUrls || [];
          applyChildNodeInfoFromPollData(resultData);
          if (videoUrls[0] && childNodeIdsRef.current[0] && !resultData?.childNodeInfo) {
            applyChildNodeInfo({ [childNodeIdsRef.current[0]]: videoUrls[0] });
          }
          if (videoUrls[0] && videoUrls[0] !== value) {
            handleSuccess(videoUrls[0]);
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

  const handleGetHigh = async (videoList: string[] | undefined, params: { resolution?: string; taskId?: string }) => {
    if (!videoList?.length || status === 'running' || execute) {
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
        type: 'VIDEO_UPSCALE',
        canvasId: canvasId || '',
        nodeId: id,
        data: {
          videoUrlList: [videoList[0]],
          videoParams: { resolution: params.resolution || '720p' },
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
        toast.error(res.msg || '高清视频任务创建失败');
        handleStatus('failure', res.msg || '高清视频任务创建失败');
      }
    } catch {
      setExecute(false);
      handleStatus('failure', '高清视频任务创建失败');
    }
  };

  return (
    <div ref={nodeRef} className='rounded-2xl relative hover:ring-2 ring-white/65 transition-all' style={{ width: actualWidth, height: actualHeight }}>
      {handlers.map((item: Handler) => {
        return <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />;
      })}
      {value ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full'>
          <VideoPlayer url={value}></VideoPlayer>
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
        <NodeOperation type={nodeType} url={value} status={status} onCopy={handleCopy} onDelete={handleDelete}></NodeOperation>
      </NodeToolbar>
      <NodeToolbar isVisible={!isSelection && selected && sourceNodeIds.length > 0} position={Position.Bottom} align='center'>
        <ToolModal id={id}>
          <HighDefinitionVideo
            status={status}
            onParamsChange={handleParamsChange}
            initialResolution={data.params?.resolution}
            caculatePoint={caculatePoint}
            pointLoading={pointLoading}
            execute={execute}
            onLayerClick={handleGetHigh}
            permissionDisabled={toolPermissionDisabled || desktopOwned}
          ></HighDefinitionVideo>
        </ToolModal>
      </NodeToolbar>
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType}></GifContent>
      </NodeToolbar>
    </div>
  );
};

export default memo(HighDefinitionVideoTool);
