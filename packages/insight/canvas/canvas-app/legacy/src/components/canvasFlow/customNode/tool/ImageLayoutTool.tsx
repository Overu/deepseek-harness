import { isDesktopProcessOwned } from '../../../../../../src/process-ownership';
import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import ImageLayoutDefinition from '../../components/toolControl/ImageLayoutDefinition';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import ToolContent from '../../components/nodeControl/ToolContent';
import LimitHandler from '../../customHandler/LimitHandler';
import ToolModal from '../../components/promptControl/ToolModal';
import { useState, useMemo, useEffect, useRef, memo } from 'react';
import setting from '../../settings/setting';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import type { Handler } from '../../utils/type';
import styles from './index.module.less';
import { compressImage } from '@/utils';
import { createExternalTask, queryExternalTaskResult } from '@/api/tool';
import { usePointStore } from '@/store/pointStore';
import GifContent from '../../components/nodeControl/GifContent';
import util from '../../utils/util';
import { toast } from 'sonner';
import type { ImageLayoutParams } from '../../components/toolControl/imageLayoutParams';

const { getSourceMap } = util;

const nodeType = 'imageLayoutTool';
const { handlersMap } = setting;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight } = toolUtil;
const handlers = handlersMap[nodeType];

const ImageLayoutTool = (props: any) => {
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle, time, params } = data;
  const { status, errorMsg, taskId } = taskInfo;
  const [focus, setFocus] = useState(false);
  const [sourceNodeIds, setSourceNodeIds] = useState([] as string[]);
  const nodeRef = useRef<any>(null);
  const dataRef = useRef(data);
  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const canvasId = useFlowStore(state => state.canvasId);
  const nodes = useFlowStore(state => state.nodes);
  const [tempTaskId, setTempTaskId] = useState('');

  const { updateNodeData, updateNodeStatus } = useFlowStore(state => state.actions);
  const { prepareChildNodes, attachChildNodes, markChildNodesFailure, applyChildNodeInfoFromPollData } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    sourceHandleId: 'image_source',
  });
  const [gifShow, setGifShow] = useState(false);
  const [imageList, setImageList] = useState([] as string[]);
  const [pollTimer, setPollTime] = useState<any>();
  const [execute, setExecute] = useState(false);
  const getResult = useRef(false);

  // 更新赛点方法
  const { updateUserPoint } = usePointStore(state => state.actions);

  useEffect(() => {
    const { images } = getSourceMap(nodes, edges, id);
    setImageList(images.map(item => item.value));
  }, [edges, nodes]);

  useEffect(() => {
    dataRef.current = data; // 每次 data 更新时同步到 ref
  }, [data]);

  const desktopOwned = isDesktopProcessOwned(id);
  const actualTaskId = useMemo(() => {
    return tempTaskId || taskId;
  }, [taskId, tempTaskId]);

  const currentImage = useMemo(() => {
    return value || imageList[0] || '';
  }, [value, imageList]);

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle, handleAddPrevNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);

  useNodeResizeObserver(nodeRef, id, updateNodeInternals);
  useImageNodeDimensions(id, currentImage, width, height, time);

  const actualWidth = useMemo(() => {
    return width || defaultWidth;
  }, [width]);
  const actualHeight = useMemo(() => {
    return height || defaultHeight;
  }, [height]);

  const previewUrls = useMemo(() => {
    return [currentImage];
  }, [currentImage]);

  useEffect(() => {
    const sourceNodeIds = getAllSourceNodeIds(edges, id);
    setSourceNodeIds(sourceNodeIds);
  }, [edges]);

  const handleStatus = (status: 'running' | 'success' | 'failure' | 'interrupt', errorMsg?: string) => {
    updateNodeStatus(id, status, errorMsg);
  };

  // 创建图像分层任务
  const handleCreateLayoutTask = async (_: any, taskParams: ImageLayoutParams) => {
    // 传递一个可用的图片URL到父组件
    if (!currentImage || status === 'running' || execute) {
      return;
    }

    setTempTaskId('');
    setExecute(true);

    const taskModel = String(taskParams?.model || '');
    const taskNumLayers = taskParams?.num_layers;
    const taskResolution = String(taskParams?.resolution || '');
    const childNodes = prepareChildNodes({ count: Number(taskNumLayers), layout: 'vertical', gapX: 120, useRandomOffset: false });
    if (!childNodes.length) {
      setExecute(false);
      toast.error('创建输出节点失败');
      return;
    }

    try {
      await attachChildNodes(childNodes);
      handleStatus('running');

      const childNodeIds = childNodes.map(node => node.id);

      const { code, data }: any = await createExternalTask({
        type: 'IMAGE_LAYERING',
        canvasId: canvasId || '',
        nodeId: id || '',
        data: {
          imageUrlList: [currentImage],
          modelId: taskModel,
          imageParam: {
            numLayers: taskNumLayers,
            resolution: taskResolution,
          },
          childNodeIds: childNodeIds,
        },
      });
      syncCanvasVersionNumber(canvasId, data?.versionNumber);
      if (code === 'SUCCESS' && data?.taskId) {
        setTempTaskId(data?.taskId);
        setTimeout(() => {
          // 创建任务成功后更新赛点值
          updateUserPoint();
        }, 500);
      } else {
        setExecute(false);
        toast.error('图像分层任务创建失败');
        handleStatus('failure', '图像分层任务创建失败');
        markChildNodesFailure('图像分层任务创建失败');
      }
    } catch {
      setExecute(false);
      toast.error('图像分层任务创建失败');
      handleStatus('failure', '图像分层任务创建失败');
      markChildNodesFailure('图像分层任务创建失败');
    }
  };

  const getImageResult = () => {
    if (!actualTaskId || getResult.current) {
      return;
    }
    getResult.current = true;
    // 先清除已有定时器，防止重复轮询
    if (pollTimer) {
      clearTimeout(pollTimer);
    }
    setExecute(true);
    handleStatus('running');

    // 设置轮询（每3秒查询一次，可根据需求调整时间间隔）
    const timer = setTimeout(async () => {
      try {
        const { code, data }: any = await queryExternalTaskResult(actualTaskId);
        syncCanvasVersionNumber(canvasId, data?.versionNumber);
        // 轮询成功：接口返回成功状态，停止轮询并执行回调
        if (code === 'SUCCESS' && data) {
          if (data.status === 'RUNNING') {
            getResult.current = false;
            getImageResult();
          } else if (data.status === 'SUCCESS') {
            applyChildNodeInfoFromPollData(data);
            handleFinish('success');
          } else if (data.status == 'FAILURE') {
            handleFinish('failure');
            setTimeout(() => {
              // 创建任务成功后更新赛点值
              updateUserPoint();
            }, 500);
          }
        }

        if (code === 'FAILURE') {
          handleFinish('failure');
        }
      } catch {
        handleFinish('failure');
      } finally {
        getResult.current = false;
      }
    }, 3000); // 轮询时间间隔：3000毫秒（3秒），可自定义调整
    setPollTime(timer);
  };

  const handleFinish = (status: 'success' | 'failure', pollData?: any) => {
    setExecute(false);
    const finishErrorMsg = pollData?.errInfo || pollData?.message;
    handleStatus(status, finishErrorMsg);
    clearTimeout(pollTimer);
    setPollTime(null);

    if (status === 'failure') {
      markChildNodesFailure(finishErrorMsg || '图像分层失败，请重试');
    }
  };

  useEffect(() => {
    if (!selected) {
      setGifShow(false);
    }
  }, [selected]);

  useEffect(() => {
    if (status === 'running') {
      setExecute(true);
    }
    return () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        setPollTime(null);
      }
    };
  }, []);

  useEffect(() => {
    if (!desktopOwned && status === 'running' && actualTaskId) {
      getImageResult();
    }
  }, [status, actualTaskId, desktopOwned]);

  const handleParamsChange = (newParams: ImageLayoutParams | Record<string, any>) => {
    const latestData = dataRef.current;
    updateNodeData(id, {
      ...latestData,
      params: {
        ...latestData.params,
        ...newParams,
      },
    });
  };

  return (
    // 修改容器样式，使用动态计算的尺寸
    <div ref={nodeRef} className='rounded-2xl relative hover:ring-2 ring-white/65 transition-all' style={{ width: actualWidth, height: actualHeight }}>
      {handlers.map((item: Handler) => {
        return <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />;
      })}
      {currentImage ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full'>
          <img src={compressImage(currentImage)} className='rounded-2xl w-full h-full bg-[#262626]'></img>
          <div className={`${styles.toolNoBg} absolute inset-0`}>
            <ToolContent
              onTryConnect={() => handleAddPrevNode(nodeType, position)}
              type={nodeType}
              sourceNodeIds={sourceNodeIds}
              sourceValue={currentImage}
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
            sourceValue={currentImage}
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
      {status === 'failure' && <StatusOverlay status={status} errorMsg={errorMsg} type={nodeType} id={id} />}
      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation type={nodeType} url={currentImage} status={status} previewUrls={previewUrls} onCopy={handleCopy} onDelete={handleDelete}></NodeOperation>
      </NodeToolbar>
      <NodeToolbar isVisible={!isSelection && selected && sourceNodeIds.length > 0} position={Position.Bottom} align='center'>
        <ToolModal id={id}>
          <ImageLayoutDefinition
            imageList={[currentImage]}
            status={status}
            params={params}
            onParamsChange={handleParamsChange}
            execute={execute}
            onLayerClick={handleCreateLayoutTask}
            permissionDisabled={toolPermissionDisabled || desktopOwned}
          />
        </ToolModal>
      </NodeToolbar>
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType}></GifContent>
      </NodeToolbar>
    </div>
  );
};

export default memo(ImageLayoutTool);
