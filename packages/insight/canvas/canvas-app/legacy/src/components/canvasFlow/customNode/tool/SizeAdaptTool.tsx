import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import { compressImage } from '@/utils';
import setting from '../../settings/setting';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import ToolContent from '../../components/nodeControl/ToolContent';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import GifContent from '../../components/nodeControl/GifContent';
import ImageExtension, { type OutpaintingSubmitPayload } from '@/routes/editor/extension';
import { createExternalTask, queryExternalTaskResult } from '@/api/tool';
import styles from './index.module.less';
import type { Handler } from '../../utils/type';
import LimitHandler from '../../customHandler/LimitHandler';
import util from '../../utils/util';
import { usePointStore } from '@/store/pointStore';
import ToolCornerActionButton from '../../components/nodeControl/ToolCornerActionButton';
import { toast } from 'sonner';

const nodeType = 'sizeAdaptTool';
const { handlersMap } = setting;
const handlers = handlersMap[nodeType];
const { defaultWidth, defaultHeight, getAllSourceNodeIds, measureMediaNodeSize } = toolUtil;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getSourceMap } = util;

const SizeAdaptTool = (props: any) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const { updateUserPoint } = usePointStore(state => state.actions);
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle, time } = data;
  const { status, errorMsg, taskId } = taskInfo || {};

  const nodeRef = useRef<any>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const dataRef = useRef(data);

  const [focus, setFocus] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [tempTaskId, setTempTaskId] = useState('');
  const [imageList, setImageList] = useState<string[]>([]);
  const [gifShow, setGifShow] = useState(false);

  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const canvasId = useFlowStore(state => state.canvasId);

  const { updateNodeData, updateNodeStatus, setShortCutLock, updateNodeSelected, updateNodeMeasured } = useFlowStore(state => state.actions);
  const { prepareChildNodes, attachChildNodes, markChildNodesFailure, applyChildNodeInfo, applyChildNodeInfoFromPollData, childNodeIdsRef } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    sourceHandleId: 'image_source',
  });
  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle, handleAddPrevNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);

  useNodeResizeObserver(nodeRef, id, updateNodeInternals);
  useImageNodeDimensions(id, value, width, height, time);

  const actualWidth = useMemo(() => width || defaultWidth, [width]);
  const actualHeight = useMemo(() => height || defaultHeight, [height]);
  const previewUrls = useMemo(() => [value], [value]);

  const sourceNodeIds = useMemo(() => {
    return getAllSourceNodeIds(edges, id);
  }, [edges, id]);

  const actualTaskId = useMemo(() => tempTaskId || taskId, [tempTaskId, taskId]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const { images } = getSourceMap(nodes, edges, id);
    setImageList(images.map(item => item.value));
  }, [edges, nodes, id]);

  useEffect(() => {
    setShortCutLock(editorVisible);
  }, [editorVisible, setShortCutLock]);

  const handleFailure = useCallback(
    (message?: string) => {
      const errorMessage = message || '扩图失败，请重试';
      updateNodeStatus(id, 'failure', errorMessage);
      markChildNodesFailure(errorMessage);
      updateUserPoint();
    },
    [id, markChildNodesFailure, updateNodeStatus, updateUserPoint]
  );

  useEffect(() => {
    if (status !== 'running' || !actualTaskId) return;

    const poll = async () => {
      try {
        const result: any = await queryExternalTaskResult(actualTaskId);
        const resultData = result?.data;
        syncCanvasVersionNumber(canvasId, resultData?.versionNumber);

        if (resultData?.status === 'RUNNING') {
          intervalRef.current = setTimeout(poll, 3000);
        } else if (resultData?.status === 'SUCCESS') {
          const imageList: string[] = resultData.result?.imageList || [];
          const primaryImage = imageList[0];
          const measured = primaryImage ? await measureMediaNodeSize('image', primaryImage) : null;
          const measuredMap = measured && childNodeIdsRef.current[0] ? { [childNodeIdsRef.current[0]]: measured } : undefined;
          applyChildNodeInfoFromPollData(resultData, measuredMap);
          if (imageList[0] && childNodeIdsRef.current[0] && !resultData?.childNodeInfo) {
            applyChildNodeInfo({ [childNodeIdsRef.current[0]]: imageList[0] }, measuredMap);
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
          if (measured) {
            updateNodeMeasured(id, measured.measured, true);
          }
          updateNodeStatus(id, 'success');
        } else if (resultData?.status === 'FAILURE') {
          handleFailure(resultData.message);
        } else {
          handleFailure('超时错误，请重试');
        }
      } catch {
        handleFailure('超时错误，请重试');
      }
    };

    intervalRef.current = setTimeout(poll, 200);
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [status, actualTaskId, id, updateNodeData, updateNodeStatus, updateNodeMeasured, applyChildNodeInfo, applyChildNodeInfoFromPollData, childNodeIdsRef, handleFailure]);

  const handleShow = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!sourceNodeIds.length) return;
    window.dispatchEvent(new CustomEvent('canvas:hide-context-menu'));
    setEditorVisible(true);
    updateNodeSelected(id, false);
  };

  const handleSubmitTask = useCallback(
    async (payload: OutpaintingSubmitPayload) => {
      const childNodes = prepareChildNodes();
      if (!childNodes.length) {
        toast.error('创建输出节点失败');
        return false;
      }
      const childNodeIds = childNodes.map(node => node.id);
      try {
        const {
          code,
          data: resData,
          message,
        }: any = await createExternalTask({
          type: 'IMAGE_SIZE_ADAPTATION',
          canvasId: canvasId || '',
          nodeId: id,
          data: {
            ...payload,
            childNodeIds,
          },
        });
        syncCanvasVersionNumber(canvasId, resData?.versionNumber);
        if (code === 'SUCCESS' && resData?.taskId) {
          await attachChildNodes(childNodes);
          setTempTaskId(resData.taskId);
          updateNodeStatus(id, 'running');
          setEditorVisible(false);
          updateUserPoint();
          return true;
        }
        toast.error(message || '任务提交失败，请重试');
        return false;
      } catch (error: any) {
        toast.error(error?.message || '网络请求失败，请检查网络连接');
        return false;
      }
    },
    [attachChildNodes, canvasId, id, prepareChildNodes, updateNodeStatus, updateUserPoint]
  );

  return (
    <div
      ref={nodeRef}
      className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'} min-w-[270px]`}
      style={{ width: actualWidth, height: actualHeight }}
    >
      {handlers.map((item: Handler) => {
        return <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />;
      })}

      {value ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full'>
          <img src={compressImage(value)} className='rounded-2xl w-full h-full bg-[#262626] object-cover' />
          <div className='absolute bottom-3 right-3'>
            <ToolCornerActionButton
              toolType={nodeType}
              active={sourceNodeIds.length > 0}
              label={sourceNodeIds.length ? '点击进入编辑器' : '请在左侧接入来源'}
              icon={<div className='iconfont text-3xl icon-import' />}
              onClick={e => handleShow(e)}
            />
          </div>
        </div>
      ) : (
        <div className={styles.tool}>
          <ToolContent
            onTryConnect={() => handleAddPrevNode(nodeType, position)}
            type={nodeType}
            sourceNodeIds={sourceNodeIds}
            onClick={() => handleShow()}
            onTipClick={flag => setGifShow(flag)}
            hasValue={!!value}
          />
        </div>
      )}

      {editorVisible && (
        <div onClick={e => e.stopPropagation()}>
          <ImageExtension canvasId={canvasId} nodeId={id} imageList={imageList} value={value} onClose={() => setEditorVisible(false)} onSubmitTask={handleSubmitTask} />
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

      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType} />
      </NodeToolbar>
    </div>
  );
};

export default memo(SizeAdaptTool);
