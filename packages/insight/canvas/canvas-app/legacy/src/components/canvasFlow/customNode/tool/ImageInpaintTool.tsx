import { NodeToolbar, Position, useUpdateNodeInternals, type Edge, type Node } from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import { usePointStore } from '@/store/pointStore';
import { compressImage } from '@/utils';
import setting from '../../settings/setting';
import hooks from '../../hooks';
import { assignNodeTitles } from '../../utils/nodeNaming';
import toolUtil from '../../utils/toolUtil';
import util from '../../utils/util';
import ToolContent from '../../components/nodeControl/ToolContent';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import GifContent from '../../components/nodeControl/GifContent';
import LimitHandler from '../../customHandler/LimitHandler';
import ImageInpaintExtension from '@/routes/editor/inpaint';
import { queryExternalTaskResult } from '@/api/tool';
import styles from './index.module.less';
import type { Handler } from '../../utils/type';
import ToolCornerActionButton from '../../components/nodeControl/ToolCornerActionButton';

const nodeType = 'imageInpaintTool';
const { handlersMap } = setting;
const handlers = handlersMap[nodeType];
const { defaultWidth, defaultHeight, getAllSourceNodeIds } = toolUtil;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useTopNodeToolbarVisible } = hooks;
const { createDragEdge, createNode, dealEdge, getSourceMap, buildInitialToolOutputNodeData, buildMediaToolOutputNodeData } = util;

type InpaintPendingTask = {
  outputNodeId: string;
  taskId: string;
};

type ImageInpaintNodeData = Record<string, unknown> & {
  params?: Record<string, unknown>;
};

const getResultImageList = (resultData: any): string[] => {
  const result = typeof resultData?.result === 'string' ? safeJsonParse(resultData.result) : resultData?.result;
  const imageList = resultData?.imageList || result?.imageList;
  if (Array.isArray(imageList)) return imageList;
  const single = resultData?.imageUrl || resultData?.ossUrl || result?.imageUrl || result?.ossUrl;
  return single ? [single] : [];
};

const safeJsonParse = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getInpaintPendingTask = (nodeData: ImageInpaintNodeData | null | undefined): InpaintPendingTask | null => {
  const pendingTask = nodeData?.params?.inpaintPendingTask;
  if (!pendingTask || typeof pendingTask !== 'object') return null;
  const task = pendingTask as Partial<InpaintPendingTask>;
  if (!task.outputNodeId || !task.taskId) return null;
  return {
    outputNodeId: task.outputNodeId,
    taskId: task.taskId,
  };
};

const withInpaintPendingTask = (nodeData: ImageInpaintNodeData, pendingTask: InpaintPendingTask) => ({
  ...nodeData,
  params: {
    ...(nodeData?.params || {}),
    inpaintPendingTask: pendingTask,
  },
});

const withoutInpaintPendingTask = (nodeData: ImageInpaintNodeData) => {
  const restParams = { ...(nodeData?.params || {}) };
  delete restParams.inpaintPendingTask;
  return {
    ...nodeData,
    params: restParams,
  };
};

const withResolvedInpaintTask = (nodeData: ImageInpaintNodeData, status: 'success' | 'failure', errorMsg = '') => ({
  ...withoutInpaintPendingTask(nodeData),
  taskInfo: {
    ...((nodeData as any)?.taskInfo || {}),
    status,
    errorMsg,
  },
});

const ImageInpaintTool = (props: any) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const { updateUserPoint } = usePointStore(state => state.actions);
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle, time } = data;
  const { status, errorMsg } = taskInfo || {};

  const nodeRef = useRef<any>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const dataRef = useRef(data);

  const [focus, setFocus] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [imageList, setImageList] = useState<string[]>([]);
  const [gifShow, setGifShow] = useState(false);

  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const canvasId = useFlowStore(state => state.canvasId);
  const modelsMap = useFlowStore(state => state.modelsMap);
  const { updateNodeData, updateNodeStatus, setShortCutLock, updateNodeSelected, setNodes, setEdges, recordSnapshot, partialUpdate } = useFlowStore(state => state.actions);
  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle, handleAddPrevNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);

  useNodeResizeObserver(nodeRef, id, updateNodeInternals);

  const actualWidth = useMemo(() => width || defaultWidth, [width]);
  const actualHeight = useMemo(() => height || defaultHeight, [height]);
  const sourceNodeIds = useMemo(() => getAllSourceNodeIds(edges, id), [edges, id]);
  const sourceImage = useMemo(() => (imageList.length === 1 ? imageList[0] : ''), [imageList]);
  const currentImage = useMemo(() => sourceImage || value || '', [sourceImage, value]);
  const previewUrls = useMemo(() => [currentImage], [currentImage]);
  const outputImageNodes = useMemo(() => {
    const outputNodeIds = edges.filter(edge => edge.source === id && edge.sourceHandle === 'image_source').map(edge => edge.target);
    return nodes.filter(node => outputNodeIds.includes(node.id) && node.type === 'image');
  }, [edges, id, nodes]);
  const inpaintPendingTask = useMemo(() => getInpaintPendingTask(data), [data]);
  const runningOutputNode = useMemo(() => {
    if (!inpaintPendingTask) return null;
    return outputImageNodes.find(node => node.id === inpaintPendingTask.outputNodeId) || null;
  }, [inpaintPendingTask, outputImageNodes]);
  const actualTaskId = inpaintPendingTask?.taskId || '';
  const outputNodeIsRunning = (runningOutputNode?.data as any)?.taskInfo?.status === 'running' && Boolean(actualTaskId);

  useImageNodeDimensions(id, currentImage, width, height, time);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const { images } = getSourceMap(nodes, edges, id);
    setImageList(images.map(item => item.value).filter(Boolean));
  }, [edges, nodes, id]);

  useEffect(() => {
    setShortCutLock(editorVisible);
  }, [editorVisible, setShortCutLock]);

  const resolveInpaintToolTask = useCallback(
    (nextStatus: 'success' | 'failure', nextErrorMsg = '') => {
      const resolvedData = withResolvedInpaintTask(dataRef.current, nextStatus, nextErrorMsg);
      updateNodeData(id, resolvedData, false, false);
      return resolvedData;
    },
    [id, updateNodeData]
  );

  const clearInpaintPendingTask = useCallback(() => {
    updateNodeData(id, withoutInpaintPendingTask(dataRef.current), false);
  }, [id, updateNodeData]);

  useEffect(() => {
    const outputNodeId = runningOutputNode?.id;
    if (!outputNodeId || !actualTaskId) return;

    const failPendingTask = (message: string) => {
      const outputNode = useFlowStore.getState().nodes.find(node => node.id === outputNodeId);
      const toolNodeData = resolveInpaintToolTask('failure', message);
      const updateNodes = [
        {
          id,
          data: toolNodeData,
        },
      ];

      if (outputNode) {
        const outputNodeData = {
          ...(outputNode.data as any),
          taskInfo: {
            ...((outputNode.data as any)?.taskInfo || {}),
            status: 'failure',
            errorMsg: message,
          },
        };
        updateNodeData(outputNodeId, outputNodeData, false, false);
        updateNodes.unshift({
          id: outputNodeId,
          data: outputNodeData,
        });
      } else {
        updateNodeStatus(outputNodeId, 'failure', message);
      }

      partialUpdate(canvasId, { updateNodes }).catch(() => undefined);
      return toolNodeData;
    };

    const poll = async () => {
      try {
        const result: any = await queryExternalTaskResult(actualTaskId);
        const resultData = result?.data;
        syncCanvasVersionNumber(canvasId, resultData?.versionNumber);

        if (resultData?.status === 'RUNNING') {
          intervalRef.current = setTimeout(poll, 3000);
          return;
        }

        if (resultData?.status === 'SUCCESS') {
          const images = getResultImageList(resultData);
          const firstImage = images[0];
          if (!firstImage) {
            const message = '未获取到局部重绘结果';
            failPendingTask(message);
            updateUserPoint();
            return;
          }

          const outputNode = useFlowStore.getState().nodes.find(node => node.id === outputNodeId);
          if (!outputNode) {
            const toolNodeData = resolveInpaintToolTask('success');
            partialUpdate(canvasId, {
              updateNodes: [
                {
                  id,
                  data: toolNodeData,
                },
              ],
            }).catch(() => undefined);
            return;
          }
          const outputNodeData = {
            ...buildMediaToolOutputNodeData(outputNode.data as Record<string, unknown>, firstImage),
            taskInfo: {
              ...((outputNode.data as any)?.taskInfo || {}),
              status: 'success',
              errorMsg: '',
            },
          };
          const toolNodeData = resolveInpaintToolTask('success');
          updateNodeData(outputNodeId, outputNodeData, true, false);
          updateNodeStatus(outputNodeId, 'success');
          partialUpdate(canvasId, {
            updateNodes: [
              {
                id: outputNodeId,
                data: outputNodeData,
              },
              {
                id,
                data: toolNodeData,
              },
            ],
          }).catch(() => undefined);
          return;
        }

        const message = resultData?.message || '局部重绘失败，请重试';
        failPendingTask(message);
        updateUserPoint();
      } catch {
        const message = '局部重绘结果查询失败，请重试';
        failPendingTask(message);
      }
    };

    intervalRef.current = setTimeout(poll, 200);
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [actualTaskId, canvasId, id, resolveInpaintToolTask, runningOutputNode?.id, updateNodeData, updateNodeStatus, updateUserPoint]);

  const handleShow = (event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (outputNodeIsRunning) return;
    if (!sourceNodeIds.length) return;
    window.dispatchEvent(new CustomEvent('canvas:hide-context-menu'));
    setEditorVisible(true);
    updateNodeSelected(id, false);
  };

  const markPendingOutputFailure = useCallback(
    (outputNodeId: string, errorMsg: string) => {
      const outputNode = useFlowStore.getState().nodes.find(node => node.id === outputNodeId);
      if (!outputNode) return;
      const failedData = {
        ...(outputNode.data as any),
        taskInfo: {
          ...((outputNode.data as any)?.taskInfo || {}),
          status: 'failure',
          errorMsg,
        },
      };
      updateNodeData(outputNodeId, failedData, false, false);
      partialUpdate(canvasId, {
        updateNodes: [
          {
            id: outputNodeId,
            data: failedData,
          },
        ],
      }).catch(() => undefined);
    },
    [canvasId, updateNodeData]
  );

  const createPendingOutputNode = async () => {
    const currentNode = useFlowStore.getState().nodes.find(node => node.id === id);
    if (!currentNode || !modelsMap) return undefined;

    let outputNode = createNode(modelsMap, {
      type: 'image',
      position: {
        x: currentNode.position.x + (width || defaultWidth) + 120,
        y: currentNode.position.y,
      },
    }) as Node;
    outputNode.selected = false;
    outputNode.data = {
      ...buildInitialToolOutputNodeData(outputNode.data as Record<string, unknown>),
      taskInfo: {
        ...((outputNode.data as any)?.taskInfo || {}),
        status: 'running',
        errorMsg: '',
      },
    };

    const edge = dealEdge(
      createDragEdge(
        {
          id: 'image_source',
          type: 'source',
          nodeId: id,
        } as any,
        outputNode.id
      ) as Edge
    ) as Edge;

    const latestNodes = useFlowStore.getState().nodes;
    const latestEdges = useFlowStore.getState().edges;
    const [namedOutputNode] = assignNodeTitles({
      existingNodes: latestNodes,
      existingEdges: latestEdges,
      nodesToAdd: [outputNode],
      edgesToAdd: [edge],
      mode: 'auto',
    });
    outputNode = namedOutputNode || outputNode;
    const nextNodes = [
      outputNode,
      ...latestNodes.map(node => ({
        ...node,
        selected: false,
      })),
    ];
    const nextEdges = [...latestEdges, edge];

    setNodes(nextNodes);
    setEdges(nextEdges);
    recordSnapshot();

    try {
      await partialUpdate(canvasId, {
        addNodes: [outputNode],
        allEdges: nextEdges,
      });
      return outputNode.id;
    } catch {
      updateNodeStatus(outputNode.id, 'failure', '局部重绘结果节点同步失败，请刷新后重试');
      clearInpaintPendingTask();
      return undefined;
    }
  };

  const bindPendingOutputTask = async (outputNodeId: string, taskId: string) => {
    const latestNodes = useFlowStore.getState().nodes;
    const currentNode = latestNodes.find(node => node.id === id);
    const outputNode = latestNodes.find(node => node.id === outputNodeId);
    if (!currentNode || !outputNode) return;

    const pendingTask = {
      outputNodeId,
      taskId,
    };
    const outputNodeData = {
      ...(outputNode.data as any),
      taskInfo: {
        ...((outputNode.data as any)?.taskInfo || {}),
        status: 'running',
        taskId,
        errorMsg: '',
      },
    };
    const toolNodeData = withInpaintPendingTask(currentNode.data, pendingTask);

    updateNodeData(outputNodeId, outputNodeData, false, false);
    updateNodeData(id, toolNodeData, false, false);

    try {
      await partialUpdate(canvasId, {
        updateNodes: [
          {
            id: outputNodeId,
            data: outputNodeData,
          },
          {
            id,
            data: {
              params: (toolNodeData as any).params,
            },
          },
        ],
      });
    } catch {
      markPendingOutputFailure(outputNodeId, '局部重绘任务同步失败，请刷新后重试');
      clearInpaintPendingTask();
    }
  };

  const handleSuccess = (result: string, meta?: { finalUrl?: boolean; childNodeId?: string }) => {
    if (meta?.finalUrl) {
      updateNodeData(
        id,
        {
          ...dataRef.current,
          value: result,
          product: [{ value: result }],
        },
        true,
        false
      );
      updateNodeStatus(id, 'success');
      setEditorVisible(false);
      return;
    }

    const childNodeId = meta?.childNodeId;
    if (!childNodeId) {
      setEditorVisible(false);
      return;
    }
    bindPendingOutputTask(childNodeId, result);
    setEditorVisible(false);
  };

  return (
    <div
      ref={nodeRef}
      className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'} min-w-[270px]`}
      style={{ width: actualWidth, height: actualHeight }}
    >
      {handlers.map((item: Handler) => (
        <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />
      ))}

      {currentImage ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full'>
          <img src={compressImage(currentImage)} className='rounded-2xl w-full h-full bg-[#262626] object-cover' />
          <div className='absolute bottom-3 right-3'>
            <ToolCornerActionButton
              toolType={nodeType}
              active={sourceNodeIds.length > 0 && !outputNodeIsRunning}
              label={outputNodeIsRunning ? '局部重绘中' : sourceNodeIds.length ? '点击进入编辑器' : '请在左侧接入来源'}
              icon={<div className='iconfont text-3xl icon-import' />}
              onClick={event => handleShow(event)}
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
            hasValue={!!currentImage}
          />
        </div>
      )}

      {editorVisible && (
        <div onClick={event => event.stopPropagation()}>
          <ImageInpaintExtension
            canvasId={canvasId}
            nodeId={id}
            imageList={imageList}
            value={currentImage}
            onClose={() => setEditorVisible(false)}
            onPrepareChildNode={createPendingOutputNode}
            onSubmitFailure={markPendingOutputFailure}
            onSuccess={handleSuccess}
          />
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

      {/* 工具节点仅在 failure 时展示遮罩 */}
      {status === 'failure' && <StatusOverlay status={status} errorMsg={errorMsg} type={nodeType} id={id} />}

      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation type={nodeType} url={currentImage} status={status} previewUrls={previewUrls} onCopy={handleCopy} onDelete={handleDelete} />
      </NodeToolbar>

      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType} />
      </NodeToolbar>
    </div>
  );
};

export default memo(ImageInpaintTool);
