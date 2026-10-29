import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import util from '../../../utils/util';
import type { PrepareToolOutputChildNodesOptions } from '../../../hooks';
import {
  buildStoryboardBatchChildNodeData,
  buildStoryboardBatchPayload,
  findSelectedRowsMissingText,
  layoutStoryboardBatchNodes,
  parseStoryboardBatchChildNodeInfo,
  resolveBatchModelType,
  resolveStoryboardToolNodeWidth,
  rowHasImage,
  selectedRowsHaveImage,
  type StoryboardBatchChildNodeInfo,
  type StoryboardUploadCreateMeta,
} from './storyboardBatchGenerate';
import { createStoryboardGenTitle, createStoryboardGroupTitle, createStoryboardRefTitle, getNextStoryboardGroupIndex, resolveStoryboardScriptTitle } from './storyboardBatchNaming';
import {
  type StoryboardGenerateParams,
  type StoryboardInfo,
  type StoryboardMode,
  type TableProtocol,
  DEFAULT_CELL_SIZE,
  SERIAL_COL_WIDTH,
  normalizeStoryboardGenCount,
} from './types';
import { toast } from 'sonner';
import { createExternalTask, queryExternalTaskResult } from '@/api/tool';
import { usePointStore } from '@/store/pointStore';
import toolUtil from '../../../utils/toolUtil';
import { creareDefaultParamsV2, isMediaNodeModelModeSupported } from '../../../utils/mediaNodeModelUtil';
import { preserveNodeTitle } from '../../../utils/nodeNaming';

const { createNode, createDragEdge, buildMediaToolOutputNodeData } = util;
const { caculateSingleNodePoint } = toolUtil;

type UseStoryboardBatchGenerateParams = {
  id: string;
  data: any;
  dataRef: RefObject<any>;
  table: TableProtocol;
  storyboardStatus: string;
  storyboardTaskId: string;
  toolPermissionDisabled: boolean;
  anyTaskRunningRef: RefObject<boolean>;
  nodeRef: RefObject<HTMLDivElement | null>;
  prepareChildNodes: (opts?: PrepareToolOutputChildNodesOptions) => Node[];
};

/**
 * 分镜批量生成（storyboardInfo）：生成模式、勾选行、提交拓扑、轮询回写。
 */
export function useStoryboardBatchGenerate({
  id,
  data,
  dataRef,
  table,
  storyboardStatus,
  storyboardTaskId,
  toolPermissionDisabled,
  anyTaskRunningRef,
  nodeRef,
  prepareChildNodes,
}: UseStoryboardBatchGenerateParams) {
  const { updateUserPoint, setNeedPoint } = usePointStore(state => state.actions);
  const modelsMap = useFlowStore(state => state.modelsMap);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);
  const pointList = useFlowStore(state => state.pointList);
  const canvasId = useFlowStore(state => state.canvasId);
  const { updateNodeData, updateNodeStatus, dragAddNodes, groupNodes, renameNode } = useFlowStore(state => state.actions);

  const storyboardIntervalRef = useRef<NodeJS.Timeout | null>(null);
  /** 本批生成图节点 id（仅当前会话，不持久化；轮询放弃时兜底标失败） */
  const storyboardGenChildIdsRef = useRef<string[]>([]);
  const storyboardPollErrorCountRef = useRef(0);
  const STORYBOARD_POLL_MAX_ERRORS = 3;
  const STORYBOARD_POLL_INTERVAL_MS = 3000;
  const [generateMode, setGenerateMode] = useState(false);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<number[]>([]);
  const [tempStoryboardTaskId, setTempStoryboardTaskId] = useState('');
  const [isStoryboardExcute, setIsStoryboardExcute] = useState(false);

  const actualStoryboardTaskId = useMemo(() => {
    return tempStoryboardTaskId || storyboardTaskId || '';
  }, [tempStoryboardTaskId, storyboardTaskId]);

  const storyboardParams: StoryboardGenerateParams = useMemo(() => {
    return (data?.params?.storyboardParams as StoryboardGenerateParams) || {};
  }, [data?.params?.storyboardParams]);

  const rowsHaveImage = useMemo(() => selectedRowsHaveImage(table, selectedRowIndexes), [table, selectedRowIndexes]);

  const missingTextRowNumbers = useMemo(() => findSelectedRowsMissingText(table, selectedRowIndexes), [table, selectedRowIndexes]);

  const modelUnsupportedForImage = useMemo(() => {
    if (!rowsHaveImage || !storyboardParams?.model) return false;
    return !isMediaNodeModelModeSupported(modelsMap, 'image', 'reference_image_to_image', String(storyboardParams.model));
  }, [rowsHaveImage, storyboardParams?.model, modelsMap]);

  /** 生成按钮禁用原因（有值时操作栏常驻上方 tooltip）；无模型不提示 */
  const generateDisabledReason = useMemo(() => {
    if (!selectedRowIndexes.length) return '请在表格左侧勾选你想要生成分镜的内容';
    if (missingTextRowNumbers.length) {
      const displayRows = missingTextRowNumbers.length > 5 ? `${missingTextRowNumbers.slice(0, 5).join('、')}…` : missingTextRowNumbers.join('、');
      return `第${displayRows}行缺少提示词`;
    }
    if (modelUnsupportedForImage) {
      return '当前勾选行含图片，请选择支持图生图的模型';
    }
    return null;
  }, [selectedRowIndexes.length, missingTextRowNumbers, modelUnsupportedForImage]);

  const generateUnitPoint = useMemo(() => {
    if (!storyboardParams?.model || !pointList?.length) return 0;
    return caculateSingleNodePoint(pointList, normalizeStoryboardGenCount(storyboardParams));
  }, [pointList, storyboardParams]);

  const generateTotalPoint = useMemo(() => generateUnitPoint * selectedRowIndexes.length, [generateUnitPoint, selectedRowIndexes.length]);

  const canSubmitGenerate = useMemo(() => {
    if (!selectedRowIndexes.length || !storyboardParams?.model) return false;
    if (missingTextRowNumbers.length) return false;
    if (modelUnsupportedForImage) return false;
    return true;
  }, [selectedRowIndexes.length, storyboardParams?.model, missingTextRowNumbers.length, modelUnsupportedForImage]);

  // 分镜批量生成任务轮询（storyboardInfo，不展示 StatusOverlay）
  useEffect(() => {
    if (storyboardStatus !== 'running') return;

    storyboardPollErrorCountRef.current = 0;

    const patchStoryboardInfo = (patch: Partial<StoryboardInfo>) => {
      const latest = dataRef.current;
      updateNodeData(
        id,
        {
          ...latest,
          storyboardInfo: {
            ...(latest.storyboardInfo || {}),
            ...patch,
          },
        },
        false
      );
    };

    const markLocalGenChildrenFailure = (msg: string) => {
      storyboardGenChildIdsRef.current.forEach(nodeId => {
        const child = useFlowStore.getState().nodes.find(n => n.id === nodeId);
        if (child && (child.data as any)?.taskInfo?.status === 'running') {
          updateNodeStatus(nodeId, 'failure', msg);
        }
      });
    };

    /** 查询失败/超时：累计 3 次后才终止；期间继续轮询 */
    const handlePollTransientError = (msg: string) => {
      storyboardPollErrorCountRef.current += 1;
      if (storyboardPollErrorCountRef.current >= STORYBOARD_POLL_MAX_ERRORS) {
        patchStoryboardInfo({ status: 'failure', errorMsg: msg });
        if (storyboardGenChildIdsRef.current.length) {
          markLocalGenChildrenFailure(msg);
        }
        storyboardGenChildIdsRef.current = [];
        setIsStoryboardExcute(false);
        return;
      }
      storyboardIntervalRef.current = setTimeout(poll, STORYBOARD_POLL_INTERVAL_MS);
    };

    /** 按接口 childNodeInfo 回写生成子节点；nodeMsg 有值则失败，否则成功 */
    const applyChildNodeInfo = (childNodeInfo: Record<string, StoryboardBatchChildNodeInfo>) => {
      const nodesState = useFlowStore.getState().nodes;
      Object.entries(childNodeInfo).forEach(([nodeId, info]) => {
        const childNode = nodesState.find(n => n.id === nodeId);
        if (!childNode) return;
        const prevData = { ...(childNode.data as Record<string, unknown>) };
        updateNodeData(nodeId, buildStoryboardBatchChildNodeData(prevData, info), false, false);
      });
    };

    const poll = async () => {
      try {
        if (!actualStoryboardTaskId) {
          patchStoryboardInfo({ status: 'failure', errorMsg: '任务ID缺失，请重试' });
          if (storyboardGenChildIdsRef.current.length) {
            markLocalGenChildrenFailure('任务ID缺失，请重试');
          }
          storyboardGenChildIdsRef.current = [];
          setIsStoryboardExcute(false);
          return;
        }

        const { code, data: resData }: any = await queryExternalTaskResult(actualStoryboardTaskId);
        syncCanvasVersionNumber(canvasId, resData?.versionNumber);
        if (code !== 'SUCCESS' || !resData) {
          handlePollTransientError(resData?.message || '查询失败，请重试');
          return;
        }

        // 有效响应后重置连续错误计数
        storyboardPollErrorCountRef.current = 0;

        if (resData.status === 'RUNNING') {
          storyboardIntervalRef.current = setTimeout(poll, STORYBOARD_POLL_INTERVAL_MS);
          return;
        }

        if (resData.status === 'SUCCESS') {
          const childNodeInfo = parseStoryboardBatchChildNodeInfo(resData);
          if (childNodeInfo) {
            applyChildNodeInfo(childNodeInfo);
          }
          patchStoryboardInfo({ status: 'success', errorMsg: '', taskId: actualStoryboardTaskId });
          storyboardGenChildIdsRef.current = [];
          setIsStoryboardExcute(false);
          setTempStoryboardTaskId('');
          return;
        }

        if (resData.status === 'FAILURE') {
          const msg = resData?.message || '生成失败，请重试';
          const childNodeInfo = parseStoryboardBatchChildNodeInfo(resData);
          if (childNodeInfo) {
            applyChildNodeInfo(childNodeInfo);
          }
          patchStoryboardInfo({ status: 'failure', errorMsg: msg });
          storyboardGenChildIdsRef.current = [];
          updateUserPoint();
          setIsStoryboardExcute(false);
          return;
        }
      } catch (e) {
        console.error('storyboard batch poll error', e);
        handlePollTransientError('超时错误，请重试');
      }
    };

    storyboardIntervalRef.current = setTimeout(poll, 200);
    return () => {
      if (storyboardIntervalRef.current) clearTimeout(storyboardIntervalRef.current);
      storyboardIntervalRef.current = null;
      storyboardPollErrorCountRef.current = 0;
    };
  }, [storyboardStatus, actualStoryboardTaskId, id, dataRef, updateNodeData, updateNodeStatus, updateUserPoint]);

  const ensureStoryboardParams = useCallback(() => {
    const latest = dataRef.current;
    if (latest?.params?.storyboardParams?.model) return latest.params.storyboardParams as StoryboardGenerateParams;
    const defaults = normalizeStoryboardGenCount(creareDefaultParamsV2(modelsMap, 'image', undefined, undefined, modelNodePermission));
    updateNodeData(id, {
      ...latest,
      params: {
        ...latest.params,
        storyboardParams: defaults,
      },
    });
    return defaults;
  }, [dataRef, id, modelsMap, modelNodePermission, updateNodeData]);

  const handleEnterGenerateMode = useCallback(() => {
    if (anyTaskRunningRef.current || toolPermissionDisabled) return;
    // 保留原编辑态；生成模式下表格交互由 selectionMode 门控，退出后自然恢复编辑
    ensureStoryboardParams();
    setSelectedRowIndexes([]);
    setGenerateMode(true);
  }, [anyTaskRunningRef, toolPermissionDisabled, ensureStoryboardParams]);

  /** 退出分镜生成 UI 模式；进行中任务不中止，轮询与子节点继续 */
  const handleCancelGenerateMode = useCallback(() => {
    setGenerateMode(false);
    setSelectedRowIndexes([]);
  }, []);

  const handleStoryboardParamsChange = useCallback(
    (next: StoryboardGenerateParams) => {
      const latest = dataRef.current;
      updateNodeData(id, {
        ...latest,
        params: {
          ...latest.params,
          storyboardParams: normalizeStoryboardGenCount(next),
        },
      });
    },
    [dataRef, id, updateNodeData]
  );

  const handleToggleRow = useCallback((rowIndex: number) => {
    setSelectedRowIndexes(prev => (prev.includes(rowIndex) ? prev.filter(i => i !== rowIndex) : [...prev, rowIndex].sort((a, b) => a - b)));
  }, []);

  const handleToggleAllRows = useCallback(() => {
    setSelectedRowIndexes(prev => {
      if (prev.length === table.data.length) return [];
      return table.data.map((_, i) => i);
    });
  }, [table.data]);

  const handleSubmitGenerate = useCallback(async () => {
    if (!canSubmitGenerate || anyTaskRunningRef.current || toolPermissionDisabled) return;
    const latest = dataRef.current;
    const params = normalizeStoryboardGenCount((latest?.params?.storyboardParams as StoryboardGenerateParams) || storyboardParams);
    if (!params?.model) {
      toast.error('请先选择模型');
      return;
    }
    const missingRows = findSelectedRowsMissingText(table, selectedRowIndexes);
    if (missingRows.length) {
      toast.error(`第${missingRows.join('、')}行缺少提示词`);
      return;
    }
    if (rowsHaveImage && !isMediaNodeModelModeSupported(modelsMap, 'image', 'reference_image_to_image', String(params.model))) {
      toast.error('当前勾选行含图片，请选择支持图生图的模型');
      return;
    }

    const currentNode = useFlowStore.getState().nodes.find(n => n.id === id);
    if (!currentNode || !modelsMap) {
      toast.error('节点信息缺失，请刷新后重试');
      return;
    }

    const sortedIndexes = [...selectedRowIndexes].sort((a, b) => a - b);
    const selectedRows = sortedIndexes.map(i => table.data[i]);
    const shotNumbers = sortedIndexes.map(i => i + 1);
    const scriptTitle = resolveStoryboardScriptTitle((currentNode.data as any)?.title);

    const preparedGenNodes = prepareChildNodes({
      count: sortedIndexes.length,
      layout: 'vertical',
      useRandomOffset: false,
      gapX: 120,
      customizeNode: (node: Node, index: number) => {
        const row = selectedRows[index];
        const modelType = resolveBatchModelType(rowHasImage(row));
        if (node.data) {
          // prepareChildNodes 会写入 type:'tool'；负责真实生成的图片节点不应为 tool
          const nextData = { ...(node.data as Record<string, unknown>) };
          delete nextData.type;
          node.data = {
            ...nextData,
            title: createStoryboardGenTitle(scriptTitle, shotNumbers[index]),
            params: {
              ...params,
              modelType,
              prompt: '',
            },
            product: [],
            tempFile: null,
            taskInfo: {
              ...((nextData as any).taskInfo || {}),
              status: 'running',
            },
          };
        }
      },
    }).map(node => preserveNodeTitle(node));

    if (preparedGenNodes.length !== sortedIndexes.length) {
      toast.error('创建输出节点失败');
      return;
    }

    const createUploadNode = (url: string, position: { x: number; y: number }, meta: StoryboardUploadCreateMeta) => {
      const newNode = createNode(modelsMap, { type: 'image', position }, modelNodePermission) as Node;
      newNode.selected = false;
      newNode.data = {
        ...buildMediaToolOutputNodeData(newNode.data as Record<string, unknown>, url),
        title: createStoryboardRefTitle(scriptTitle, meta.shotNumber, meta.refIndex),
        product: [{ value: url }],
        taskInfo: {
          ...((newNode.data as any)?.taskInfo || {}),
          status: 'success',
        },
      };
      return preserveNodeTitle(newNode);
    };

    const createToolToChildEdge = (childId: string) =>
      createDragEdge(
        {
          id: 'image_source',
          type: 'source',
          nodeId: id,
        } as any,
        childId
      ) as Edge;

    const createUploadToGenEdge = (uploadId: string, genId: string) =>
      ({
        id: crypto.randomUUID(),
        source: uploadId,
        target: genId,
        sourceHandle: 'image_source',
        targetHandle: 'image_target',
      }) as Edge;

    const tableContentWidth = SERIAL_COL_WIDTH + table.columns.reduce((sum, col) => sum + (Number(col.width) || DEFAULT_CELL_SIZE), 0);
    const domWidth = nodeRef.current?.offsetWidth || 0;
    const toolNodeWidth = Math.max(resolveStoryboardToolNodeWidth(currentNode, tableContentWidth), domWidth, tableContentWidth);

    const { allNodes, allEdges, genNodeIds } = layoutStoryboardBatchNodes({
      toolNode: currentNode,
      toolNodeWidth,
      selectedRows,
      shotNumbers,
      genNodes: preparedGenNodes,
      createUploadNode,
      createToolToChildEdge,
      createUploadToGenEdge,
    });

    const payload = buildStoryboardBatchPayload({
      canvasId: String(canvasId || ''),
      nodeId: id,
      storyboardParams: params,
      tableSource: (latest?.params?.mode as StoryboardMode) || 'custom',
      table,
      selectedRowIndexes: sortedIndexes,
      childNodeIds: genNodeIds,
    });

    if (!payload.canvasId || !payload.nodeId) {
      toast.error('画布信息缺失，请刷新后重试');
      return;
    }

    setIsStoryboardExcute(true);
    setNeedPoint(generateTotalPoint);

    try {
      const { code, data: resData }: any = await createExternalTask(payload as any);
      syncCanvasVersionNumber(canvasId, resData?.versionNumber);
      if (code === 'SUCCESS' && resData?.taskId) {
        await dragAddNodes(allNodes, allEdges, { selectNewNode: false });
        storyboardGenChildIdsRef.current = genNodeIds;
        // 打组：本批全部新节点，并按规则命名分镜组
        const attached = useFlowStore.getState().nodes.filter(n => allNodes.some(a => a.id === n.id));
        if (attached.length >= 2) {
          const groupIndex = getNextStoryboardGroupIndex(useFlowStore.getState().nodes, scriptTitle);
          groupNodes(attached);
          const nodesAfterGroup = useFlowStore.getState().nodes;
          const parentId = attached.map(n => nodesAfterGroup.find(x => x.id === n.id)?.parentId).find(Boolean);
          if (parentId) {
            renameNode(parentId, createStoryboardGroupTitle(scriptTitle, groupIndex));
          }
        }
        setTempStoryboardTaskId(String(resData.taskId));
        const after = dataRef.current;
        updateNodeData(
          id,
          {
            ...after,
            storyboardInfo: {
              status: 'running',
              taskId: String(resData.taskId),
              errorMsg: '',
            },
          },
          false
        );
        updateUserPoint();
      } else {
        // 非 SUCCESS 由 request 层统一 toast 并 reject；此处兜底 SUCCESS 但缺 taskId
        setIsStoryboardExcute(false);
      }
    } catch (e: any) {
      // 接口错误 toast 已由 request 统一处理，此处仅复位执行态
      console.error('storyboard batch create error', e);
      setIsStoryboardExcute(false);
    }
  }, [
    canSubmitGenerate,
    anyTaskRunningRef,
    toolPermissionDisabled,
    dataRef,
    storyboardParams,
    rowsHaveImage,
    modelsMap,
    modelNodePermission,
    id,
    selectedRowIndexes,
    table,
    prepareChildNodes,
    nodeRef,
    canvasId,
    generateTotalPoint,
    setNeedPoint,
    dragAddNodes,
    groupNodes,
    renameNode,
    updateNodeData,
    updateUserPoint,
  ]);

  return {
    generateMode,
    selectedRowIndexes,
    isStoryboardExcute,
    storyboardParams,
    rowsHaveImage,
    generateTotalPoint,
    canSubmitGenerate,
    generateDisabledReason,
    handleEnterGenerateMode,
    handleCancelGenerateMode,
    handleStoryboardParamsChange,
    handleToggleRow,
    handleToggleAllRows,
    handleSubmitGenerate,
  };
}

export type UseStoryboardBatchGenerateReturn = ReturnType<typeof useStoryboardBatchGenerate>;
