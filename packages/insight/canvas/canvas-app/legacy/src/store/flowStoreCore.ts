import { calculateSingleWorkflowCost } from '@/components/canvasFlow/utils/workflowCost';
import { getAgentGenerationCounts, validateAgentRunInputs } from '../../../src/agent-node-policy';
import { sameGenerationCounts } from '../../../../src/shared/canvas-generation-counts';
import { agentAudioConfigurationKey } from '../../../src/agent-audio-policy';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { placeAgentNodes } from '../../../src/agent-node-placement';
import { resolveAgentEdgeChange, type AgentEdgeChange } from '../../../src/agent-edge-policy';
import { createAgentEditGuard, type AgentEditGuard } from '../../../src/agent-edit-guard';
import { isEqual, isPlainObject } from 'lodash-es';
import { CanvasAgentError, type AgentWriteOptions, type AgentRunOptions, type Failure, type ErrorCode, type EdgeEditOperation } from '../../../../src/shared/canvas-agent-protocol';
import { parseCanvasId } from '../../../../src/shared/protocol';
import type { Node, Edge } from '@xyflow/react';
import { addEdge } from '@xyflow/react';
import util from '@/components/canvasFlow/utils/util';
import toolUtil from '@/components/canvasFlow/utils/toolUtil';
import { getHandleLimit } from '@/components/canvasFlow/utils/multiConnect';
import { layoutSelectedNodes, sortNodesParentFirst, type LayoutMode } from '@/components/canvasFlow/utils/autoLayout';
import { assignNodeTitles, validateNodeTitle, type NodeTitleValidationResult } from '@/components/canvasFlow/utils/nodeNaming';
import type { NormalizedModelPermission, ToolNodePermissionMap } from '@/components/canvasFlow/utils/modelPermission';
import type { ProcessNodesMigrationInput } from '@/components/canvasFlow/utils/util';
import type { ParamsContent } from '@/components/canvasFlow/utils/toolUtil';
import { saveFlow as saveFlowRequest, type CanvasData, type CanvasVersionNumber, type WorkFlowExcute } from '@/api/workflow';
import { createCanvasVersionBarrier, isVersionConflict, type CanvasVersionBarrier } from '@/lib/canvasVersionBarrier';
import { createFlowMediaDimensionCoordinator } from './flowMediaDimensionCoordinator';

const {
  copyNode: copy,
  creatGroupNode,
  updateGroupChild,
  validateConnection,
  isAllowHandler,
  isAllowRun,
  pasteNode: paste,
  dealEdge,
  processEdges,
  calibrateEdge,
  stripEdgeTransientUiState,
  addTemplateNodesAndEdges,
  upgroupChild,
  updateNodesByMap,
  processNodes,
  processNodesWithMigration,
} = util;

const {
  getMaxX,
  getMinX,
  getMinY,
  getNodesRange,
  excute,
  isAllowCapacity,
  partialUpdate: partialUpdateRequest,
  saveCanvas: saveCanvasRequest,
  uniqueByField,
  getEdgesByNodes,
  getInputEdgesByNodes,
  getAllSourceNodeIds,
  getAllNodeByNodeIds,
  getGroupAllChild,
  getEmptyGroupIdsAfterDelete,
  getSourceNodesAndEdges,
} = toolUtil;

export const buildSingleWorkflowPayload = (canvasId: string, nodes: Node[], edges: Edge[], nodeId: string) => {
  const currentNodes = nodes.filter(item => item.id == nodeId);
  const allSourceNodeIds = getAllSourceNodeIds(edges, nodeId);
  const excuteNodes = getAllNodeByNodeIds(nodes, [nodeId, ...allSourceNodeIds]);
  const excuteEdges = getInputEdgesByNodes(currentNodes, edges);

  return {
    canvasId,
    workflowData: {
      nodes: excuteNodes,
      edges: excuteEdges,
    },
    executeStrategy: 'single',
    runningNodeIds: [nodeId],
  };
};

/** 模型参数协议较复杂，这里用宽松结构承载（由 canvasFlow/util.ts 转换生成） */
type ModelsMap = Record<string, any>;

type ModelMaxPromptMap = Record<string, number>;

export interface FlowInitializationOptions {
  persistMediaInitialization?: boolean;
}

interface Data {
  data: any; // 节点以及连线
  taskStatus: string; // 画布状态
  versionNumber?: CanvasVersionNumber;
}

interface Result {
  type: string;
  content: string;
  taskId?: string;
  versionNumber?: CanvasVersionNumber;
}

interface Tone {
  value: string;
  label: string;
}

interface ImageMapItem {
  edgeId: string;
  value: string;
}

interface Position {
  x: number;
  y: number;
}

interface Measured {
  width: number;
  height: number;
}

export interface AgentMutationOutcome { version: string; affectedNodeIds: string[]; affectedEdgeIds?: string[]; unchanged?: boolean }
export type AgentNodeUpdate = NodeUpdate | ((state: FlowState, node: Node) => NodeUpdate);
export type AgentNodeCreate = Node[] | ((state: FlowState) => Node[]);

export type NodeUpdate = Omit<Partial<Node>, 'id'>;

/** 画布基础节点拖入分镜表时的落点预览（单元格高亮） */
export interface StoryboardDropPreview {
  storyboardNodeId: string;
  rowIndex: number;
  field: string;
  /** 拖拽节点处于生成中或生成失败时，仍显示落点预览但为红框且不可落盘 */
  blocked?: boolean;
}

const capacityWarning = {
  type: 'capacity_limit',
  content: '',
};

export interface FlowState {
  nodes: Node[];
  edges: Edge[];
  canvasId: string;
  versionNumber?: CanvasVersionNumber;
  versionConflict: boolean;
  agentPersistenceIssue: Failure | null;
  status: string;
  isSelection: boolean;
  focusNodes: Node[];
  modelsMap: ModelsMap;
  modelMaxPromptMap: ModelMaxPromptMap;
  /** 后端模型节点权限（扁平查询表），未拉到则为 null */
  modelNodePermission: NormalizedModelPermission | null;
  /** tool_key → 可见/可点；null 表示权限未加载 */
  toolNodePermission: ToolNodePermissionMap | null;
  pointList: Array<any>;
  customToneList: Tone[];
  zoom: number;
  shortCutLock: boolean;
  readOnly: boolean;
  /** 画布节点拖入分镜表时的目标单元格预览，null 表示无预览 */
  storyboardDropPreview: StoryboardDropPreview | null;
  undoStack: { nodes: Node[]; edges: Edge[] }[]; // 历史快照
  redoStack: { nodes: Node[]; edges: Edge[] }[];
  actions: {
    setNodes: (nodes: Node[]) => void;
    setEdges: (edges: Edge[]) => void;
    setFocusNodes: (nodes: Node[]) => void;
    setCanvasId: (canavasId: string) => void;
    setVersionNumber: (versionNumber?: CanvasVersionNumber) => void;
    setModelsMap: (modelsMap: ModelsMap) => void;
    setModelMaxPromptMap: (modelMaxPromptMap: ModelMaxPromptMap) => void;
    setModelNodePermission: (p: NormalizedModelPermission | null) => void;
    setToolNodePermission: (p: ToolNodePermissionMap | null) => void;
    setPointList: (pointList: Array<any>) => void;
    setStatus: (status: string) => void;
    setCustomToneList: (customToneList: Tone[]) => void;
    setSeletion: (status: boolean) => void;
    setZoom: (zoom: number) => void;
    setShortCutLock: (shortCutLock: boolean) => void;
    setReadOnly: (readOnly: boolean) => void;
    setStoryboardDropPreview: (preview: StoryboardDropPreview | null) => void;
    reset: () => void;
    init: (data: Data, migration?: ProcessNodesMigrationInput | null, options?: FlowInitializationOptions) => boolean;
    partialUpdate: (canvasId: string, payload: ParamsContent, options?: AgentWriteOptions) => Promise<AgentMutationOutcome | void>;
    applyAgentDelta: (build: (state: FlowState) => ParamsContent, options: AgentWriteOptions) => Promise<AgentMutationOutcome>;
    awaitMutationsIdle: () => Promise<void>;
    hasPendingMutations: () => boolean;
    saveFlow: (params: CanvasData) => Promise<any>;
    // 历史记录
    recordSnapshot: () => void;
    undo: () => void;
    redo: () => void;
    // 画布操作
    addTemplate: (nodes: Node[], edges: Edge[]) => Promise<void>;
    // 节点操作
    addNode: (nodes: AgentNodeCreate, options?: AgentWriteOptions) => Promise<AgentMutationOutcome | void>;
    dragAddNode: (newNode: Node, newEdge: Edge, options?: { selectNewNode?: boolean }) => Promise<void>;
    dragAddNodes: (newNodes: Node[], newEdges: Edge[], options?: { selectNewNode?: boolean }) => Promise<void>;
    deleteNodes: {
      (ids: string[]): void;
      (ids: string[], options: AgentWriteOptions): Promise<AgentMutationOutcome>;
    };
    deleteGroupNode: (id: string) => void;
    copyNode: (id: string) => Promise<void>;
    pasteNode: (originNodes: Node[], mousePosition?: Position) => Promise<void>;
    groupNodes: (selectedNodes: Node[]) => void;
    ungroupNodes: (groupId: string) => void;
    /** 多选节点排版 */
    layoutSelectedNodes: (selectedNodes: Node[], mode: LayoutMode) => void;
    // 节点数据操作
    updateNodesMap: (nodesMap: Node[]) => boolean;
    renameNode: (id: string, title: string) => NodeTitleValidationResult;
    updateNode: {
      (id: string, update: NodeUpdate, isRecord?: boolean, isSubmit?: boolean): void;
      (id: string, update: AgentNodeUpdate, isRecord: boolean, isSubmit: boolean, options: AgentWriteOptions): Promise<AgentMutationOutcome>;
    };
    updateNodeData: {
      (id: string, data: any, isRecord?: boolean, isSubmit?: boolean): void;
      (id: string, data: any, isRecord: boolean, isSubmit: boolean, options: AgentWriteOptions): Promise<AgentMutationOutcome>;
    };
    updateNodeStatus: (id: string, status: string, errorMsg?: string) => void;
    updateAllNodeStatus: () => void;
    updateNodeMeasured: (id: string, measured: Measured, shouldPersist: boolean) => void;
    ensureNodeMediaDimensions: (id: string, sourceValue?: string, force?: boolean) => void;
    invalidateMediaDimensionRequests: (ids: string[]) => void;
    persistNodeChanges: (updateNodes: Array<any>, deleteNodeIds: string[]) => void;
    updateNodeSelected: (id: string, selected: boolean) => void;
    // 连线操作
    editAgentEdges: (operation: EdgeEditOperation, options: AgentWriteOptions) => Promise<AgentMutationOutcome>;
    deleteEdges: (ids: string[]) => void;
    updateInputEdgesType: (id: string, type: string) => void;
    edgeOrderChange: (imageMap: ImageMapItem[]) => void;
    connect: (edge: Edge) => void;
    /** 批量连线：逐条校验/校准，单次 snapshot；返回成功与失败边 */
    connectMany: (edgesToAdd: Edge[]) => { added: Edge[]; failed: Edge[] };
    excuteGroup: (id: string) => Promise<Result>;
    excuteTemp: (nodes: Node[]) => Promise<Result>;
    excuteSingle: (id: string, options?: AgentRunOptions) => Promise<Result>;
  };
}

type FlowStateGetter = () => FlowState;
type FlowStateSetter = (partial: Partial<FlowState>) => void;

const rollbackAddedElements = (get: FlowStateGetter, set: FlowStateSetter, nodeIds: string[], edgeIds: string[] = []) => {
  const nodeIdSet = new Set(nodeIds);
  const edgeIdSet = new Set(edgeIds);
  const currentState = get();
  set({
    nodes: currentState.nodes.filter(node => !nodeIdSet.has(node.id)),
    edges: currentState.edges.filter(edge => !edgeIdSet.has(edge.id)),
  });
};

type FlowMediaDimensionCoordinator = ReturnType<typeof createFlowMediaDimensionCoordinator>;

interface CanvasMutationHandlers {
  partialUpdate: (canvasId: string, payload: ParamsContent, options?: AgentWriteOptions) => Promise<AgentMutationOutcome | void>;
  awaitMutationsIdle: () => Promise<void>;
  hasPendingMutations: () => boolean;
  saveCanvas: (canvasId: string, nodes: Node[], edges: Edge[]) => Promise<void>;
  saveFlow: (params: CanvasData) => Promise<any>;
  executeWorkflow: (params: WorkFlowExcute, options?: AgentRunOptions) => Promise<Result>;
}

const agentError = (code: ErrorCode, message: string) => Object.assign(new CanvasAgentError(code, message), { requestPhase: 'not_sent' as const });
const isUnknownWrite = (error: any) => error?.requestPhase === 'sent_unknown';
const notSentError = (error: any) => error?.requestPhase ? error : Object.assign(
  error instanceof Error ? error : Object.assign(new Error(typeof error?.msg === 'string' ? error.msg : '画布操作准备失败'), { raw: error, code: error?.code, status: error?.status }),
  { requestPhase: 'not_sent' }
);
const persistenceFailure = (error: any): Failure => ({
  code: isUnknownWrite(error) ? 'SUBMISSION_UNKNOWN' : 'SAVE_REJECTED',
  message: typeof error?.message === 'string' ? error.message : typeof error?.msg === 'string' ? error.msg : '画布持久化未确认，请重新加载核对',
  retry: 'read_first',
});
const assertAgentWrite = (state: FlowState, canvasId: string, options: AgentWriteOptions) => {
  if (options.signal?.aborted) throw agentError('CANCELLED_BEFORE_DISPATCH', '调用已取消，尚未发送');
  if (!parseCanvasId(canvasId)) throw agentError('FRAME_NOT_READY', '目标画布尚未初始化');
  if (state.canvasId !== canvasId) throw agentError('FRAME_GONE', '目标画布已切换');
  if (state.readOnly) throw agentError('READ_ONLY', '画布不可编辑');
  if (state.agentPersistenceIssue) throw agentError(state.agentPersistenceIssue.code, state.agentPersistenceIssue.message);
  if (state.versionConflict) throw agentError('VERSION_CONFLICT', '画布版本未确认，请重新加载');
  if (state.versionNumber === undefined || state.versionNumber === null) throw agentError('VERSION_UNAVAILABLE', '画布缺少版本');
  if (String(state.versionNumber) !== options.expectedVersion) throw agentError('VERSION_CONFLICT', '画布已发生变化');
};

const assertAgentNodesIdle = (nodes: Node[], ids: string[], completionId?: string) => {
  if (nodes.some(node => ids.includes(node.id) && (node.data.taskInfo as { status?: string } | undefined)?.status === 'running' && (!completionId || (node.data.desktopProcess as { operationId?: string } | undefined)?.operationId !== completionId))) {
    throw agentError('NODE_BUSY', '目标节点正在生成，请完成后再修改或执行');
  }
};

/** Restore only fields changed by this command, leaving later user/poll updates intact. */
const restoreChangedFields = (before: Record<string, any>, optimistic: Record<string, any>, current: Record<string, any>): { value: Record<string, any>; conflict: boolean } => {
  const value = { ...current };
  let conflict = false;
  for (const key of new Set([...Object.keys(before), ...Object.keys(optimistic)])) {
    if (isEqual(before[key], optimistic[key])) continue;
    if (isPlainObject(before[key]) && isPlainObject(optimistic[key]) && isPlainObject(current[key])) {
      const restored = restoreChangedFields(before[key], optimistic[key], current[key]);
      value[key] = restored.value; conflict ||= restored.conflict;
    } else if (isEqual(current[key], optimistic[key])) {
      if (Object.hasOwn(before, key)) value[key] = before[key];
      else delete value[key];
    } else conflict = true;
  }
  return { value, conflict };
};

const restoreDeletedElements = <T extends { id: string }>(before: T[], current: T[], deleted: Set<string>) => {
  const elements = [...current];
  let conflict = false;
  before.forEach((item, index) => {
    if (!deleted.has(item.id)) return;
    if (elements.some(existing => existing.id === item.id)) { conflict = true; return; }
    const anchor = before.slice(index + 1).find(next => elements.some(existing => existing.id === next.id));
    const position = anchor ? elements.findIndex(existing => existing.id === anchor.id) : elements.length;
    elements.splice(position, 0, item);
  });
  return { elements, conflict };
};

const createFlowState = (
  set: FlowStateSetter,
  get: FlowStateGetter,
  mediaDimensions: FlowMediaDimensionCoordinator,
  { partialUpdate, awaitMutationsIdle, hasPendingMutations, saveCanvas, saveFlow, executeWorkflow }: CanvasMutationHandlers,
  guard: AgentEditGuard,
  feedback: FlowStoreFeedback,
  onReadOnlyChange?: (readOnly: boolean) => void,
  requestOptions?: () => import('@/api/workflow').CanvasRequestOptions
): FlowState => {
  const guardAgentOperation = <T>(operation: () => T | Promise<T>): Promise<T> => {
    const canvasId = get().canvasId;
    return guard.run(() => {
      if (get().canvasId !== canvasId) throw agentError('READ_ONLY', '目标画布已切换');
      return operation();
    }, awaitMutationsIdle);
  };

  const prepareNativeRun = async <T>(operation: () => Promise<T>): Promise<T> => {
    const marker = `native-run:${crypto.randomUUID()}`;
    guard.markEditorBusy(marker, true);
    try { return await operation(); }
    finally { guard.markEditorBusy(marker, false); }
  };

  function deleteNodes(ids: string[]): void;
  function deleteNodes(ids: string[], options: AgentWriteOptions): Promise<AgentMutationOutcome>;
  function deleteNodes(ids: string[], options?: AgentWriteOptions): void | Promise<AgentMutationOutcome> {
    if (options) return guardAgentOperation<AgentMutationOutcome | void>(applyDelete) as Promise<AgentMutationOutcome>;
    applyDelete();
    function applyDelete(): void | Promise<AgentMutationOutcome> {
      const { nodes, edges, canvasId } = get();
      if (options) {
        assertAgentWrite(get(), canvasId, options);
        if (!ids.length || ids.some(id => !nodes.some(node => node.id === id))) throw agentError('NODE_NOT_FOUND', '删除目标不存在');
      }
      const allDeleteIds = [...new Set([...ids, ...getEmptyGroupIdsAfterDelete(nodes, ids)])];
      if (options) assertAgentNodesIdle(nodes, allDeleteIds);
      const newEdges = edges.filter(e => !allDeleteIds.includes(e.source) && !allDeleteIds.includes(e.target));
      const removedEdges = edges.filter(edge => !newEdges.includes(edge));
      const affectedEdgeIds = removedEdges.map(edge => edge.id);
      const persistenceOptions = options ? { ...options, affectedNodeIds: [...new Set([...allDeleteIds, ...removedEdges.flatMap(edge => [edge.source, edge.target])])] } : undefined;
      if (persistenceOptions) assertAgentNodesIdle(nodes, persistenceOptions.affectedNodeIds);
      mediaDimensions.invalidate(allDeleteIds);
      set({
        nodes: nodes.filter(n => !allDeleteIds.includes(n.id)),
        edges: newEdges,
      });
      const operation = mediaDimensions.queuePersistence(allDeleteIds,
        () => partialUpdate(canvasId, {
          deleteNodeIds: allDeleteIds,
          allEdges: newEdges,
        }, persistenceOptions), options);
      if (!options) { get().actions.recordSnapshot(); return; }
      return operation.then(outcome => { if (get().canvasId === canvasId) get().actions.recordSnapshot(); return { ...outcome as AgentMutationOutcome, affectedEdgeIds }; }, error => {
        if (get().canvasId === canvasId) {
          if (!isUnknownWrite(error)) {
            const restoredNodes = restoreDeletedElements(nodes, get().nodes, new Set(allDeleteIds));
            const restoredEdges = restoreDeletedElements(edges, get().edges, new Set(edges.filter(edge => !newEdges.includes(edge)).map(edge => edge.id)));
            const existingIds = new Set(restoredNodes.elements.map(node => node.id));
            const currentEdgeIds = new Set(get().edges.map(edge => edge.id));
            const validEdges = restoredEdges.elements.filter(edge => currentEdgeIds.has(edge.id) || (existingIds.has(edge.source) && existingIds.has(edge.target)));
            set({ nodes: restoredNodes.elements, edges: validEdges });
            if (restoredNodes.conflict || restoredEdges.conflict || validEdges.length !== restoredEdges.elements.length) set({ agentPersistenceIssue: persistenceFailure(error) });
          }
          get().actions.recordSnapshot();
        }
        throw Object.assign(error, { affectedNodeIds: allDeleteIds, affectedEdgeIds });
      });
    }
  }

  const rollbackEdgeChange = (before: Edge[], change: AgentEdgeChange) => {
    const afterById = new Map(change.edges.map(edge => [edge.id, edge]));
    const beforeById = new Map(before.map(edge => [edge.id, edge]));
    const touched = new Set(change.affectedEdgeIds);
    const nodeIds = new Set(get().nodes.map(node => node.id));
    const unavailableRelations = new Set<string>();
    const sameEndpoints = (left: Edge, right: Edge) => left.source === right.source && left.target === right.target
      && left.sourceHandle === right.sourceHandle && left.targetHandle === right.targetHandle;
    let conflict = false;
    let current = get().edges.filter(edge => {
      if (!touched.has(edge.id) || beforeById.has(edge.id)) return true;
      const optimistic = afterById.get(edge.id);
      if (optimistic && sameEndpoints(edge, optimistic)) return false;
      conflict = true; return true;
    }).map(edge => {
      const old = beforeById.get(edge.id); const optimistic = afterById.get(edge.id);
      if (!touched.has(edge.id) || !old || !optimistic) return edge;
      // Reconnect endpoints form one relation; never combine old and newer relations field by field.
      if (!sameEndpoints(old, optimistic) && !sameEndpoints(edge, optimistic)) { conflict = true; return edge; }
      if (!sameEndpoints(old, optimistic) && (!nodeIds.has(old.source) || !nodeIds.has(old.target))) {
        conflict = true; unavailableRelations.add(edge.id); return edge;
      }
      const restored = restoreChangedFields(old, optimistic, edge); conflict ||= restored.conflict;
      return restored.value as Edge;
    });
    const deleted = new Set(before.filter(edge => touched.has(edge.id) && !afterById.has(edge.id)).map(edge => edge.id));
    const restored = restoreDeletedElements(before, current, deleted);
    conflict ||= restored.conflict; current = restored.elements;
    current = current.filter(edge => {
      if ((!deleted.has(edge.id) && !unavailableRelations.has(edge.id)) || (nodeIds.has(edge.source) && nodeIds.has(edge.target))) return true;
      conflict = true; return false;
    });
    const ordered = (edges: Edge[]) => edges.filter(edge => touched.has(edge.id)).map(edge => edge.id);
    const oldOrder = ordered(before); const optimisticOrder = ordered(change.edges);
    // Reorder only touched slots when no later operation changed that order or membership.
    if (oldOrder.length === optimisticOrder.length && oldOrder.every(id => afterById.has(id)) && !isEqual(oldOrder, optimisticOrder)) {
      if (isEqual(ordered(current), optimisticOrder)) {
        const byId = new Map(current.map(edge => [edge.id, edge])); let cursor = 0;
        current = current.map(edge => touched.has(edge.id) ? byId.get(oldOrder[cursor++])! : edge);
      } else conflict = true;
    }
    set({ edges: current });
    return conflict;
  };

  const editAgentEdges = (operation: EdgeEditOperation, options: AgentWriteOptions): Promise<AgentMutationOutcome> => guardAgentOperation(async () => {
    const { canvasId, nodes, edges } = get();
    assertAgentWrite(get(), canvasId, options);
    if (operation.expectedVersion !== options.expectedVersion) throw agentError('INVALID_ARGUMENT', '连线操作版本与保存版本不一致');
    const change = resolveAgentEdgeChange(get(), operation);
    assertAgentNodesIdle(nodes, change.affectedNodeIds);
    if (change.unchanged) return { version: String(get().versionNumber), affectedNodeIds: change.affectedNodeIds, affectedEdgeIds: change.affectedEdgeIds, unchanged: true };
    set({ edges: change.edges });
    try {
      const outcome = await partialUpdate(canvasId, { allEdges: change.edges }, { ...options, affectedNodeIds: change.affectedNodeIds });
      if (get().canvasId === canvasId) get().actions.recordSnapshot();
      return { ...outcome as AgentMutationOutcome, affectedNodeIds: change.affectedNodeIds, affectedEdgeIds: change.affectedEdgeIds };
    } catch (error) {
      if (get().canvasId === canvasId) {
        if (!isUnknownWrite(error) && rollbackEdgeChange(edges, change)) set({ agentPersistenceIssue: persistenceFailure(error) });
        get().actions.recordSnapshot();
      }
      throw Object.assign(error as Error, { affectedNodeIds: change.affectedNodeIds, affectedEdgeIds: change.affectedEdgeIds });
    }
  });

  function updateNode(id: string, update: NodeUpdate, isRecord?: boolean, isSubmit?: boolean): void;
  function updateNode(id: string, update: AgentNodeUpdate, isRecord: boolean, isSubmit: boolean, options: AgentWriteOptions): Promise<AgentMutationOutcome>;
  function updateNode(id: string, input: AgentNodeUpdate, isRecord = true, isSubmit = true, options?: AgentWriteOptions): void | Promise<AgentMutationOutcome> {
    if (options) return guardAgentOperation<AgentMutationOutcome | void>(applyUpdate) as Promise<AgentMutationOutcome>;
    applyUpdate();
    function applyUpdate(): void | Promise<AgentMutationOutcome> {
      const { nodes, edges, canvasId, readOnly } = get();
      if (options) {
        assertAgentWrite(get(), canvasId, options);
        if (!isSubmit) throw agentError('INVALID_ARGUMENT', '严格更新必须保存');
      }
      const currentNode = nodes.find(node => node.id === id);
      if (options && !currentNode) throw agentError('NODE_NOT_FOUND', '目标节点不存在');
      if (options) assertAgentNodesIdle(nodes, [id]);
      if (!currentNode) return;
      const update = typeof input === 'function' ? input(get(), currentNode) : input;
      if (Object.keys(update).length === 0 || (options && Object.entries(update).every(([key, value]) => isEqual((currentNode as any)[key], key === 'data' ? { ...currentNode.data, ...(value as any) } : value)))) {
        if (options) return Promise.resolve({ version: String(get().versionNumber), affectedNodeIds: [id], unchanged: true });
        return;
      }

      const { data: dataUpdate, ...nodeUpdate } = update;
      const preparedMediaData = dataUpdate !== undefined ? mediaDimensions.prepareNodeData(currentNode, options ? { ...currentNode.data, ...dataUpdate } : dataUpdate, nodes, edges, readOnly) : null;
      const nextData = preparedMediaData?.data ?? currentNode.data;
      const updateContent: { id: string; data?: any } & NodeUpdate = {
        id,
        ...nodeUpdate,
      };

      if (preparedMediaData) {
        const { taskInfo, value, product, ...restData } = nextData;
        void taskInfo;
        updateContent.data = preparedMediaData.valueChanged
          ? {
              ...restData,
              value,
              product,
            }
          : restData;
      }

      const newNodes = nodes.map(node =>
        node.id === id
          ? {
              ...node,
              ...nodeUpdate,
              ...(preparedMediaData ? { data: nextData } : {}),
            }
          : node
      );

      if (update.width !== undefined || update.height !== undefined || update.measured !== undefined) {
        mediaDimensions.invalidate([id]);
      }
      if (isSubmit && !options) {
        mediaDimensions.persistNodeData(canvasId, id, updateContent, preparedMediaData?.shouldQueuePersistence ?? false);
      }
      set({ nodes: newNodes });
      if (isRecord && !options) {
        get().actions.recordSnapshot();
      }
      if (preparedMediaData?.resolutionRequest) {
        mediaDimensions.scheduleRequests([preparedMediaData.resolutionRequest]);
      }
      if (options) {
        const optimisticNode = newNodes.find(node => node.id === id)!;
        return mediaDimensions.persistNodeData(canvasId, id, updateContent, preparedMediaData?.shouldQueuePersistence ?? false, options)
          .then(outcome => { if (isRecord && get().canvasId === canvasId) get().actions.recordSnapshot(); return outcome as AgentMutationOutcome; }, error => {
            if (get().canvasId === canvasId) {
              if (!isUnknownWrite(error)) {
                const latestNode = get().nodes.find(node => node.id === id);
                if (latestNode) {
                  const restored = restoreChangedFields(currentNode, optimisticNode, latestNode);
                  set({ nodes: get().nodes.map(node => node.id === id ? { ...node, ...restored.value } : node) });
                  if (restored.conflict) set({ agentPersistenceIssue: persistenceFailure(error) });
                } else set({ agentPersistenceIssue: persistenceFailure(error) });
              }
              if (isRecord) get().actions.recordSnapshot();
            }
            throw error;
          });
      }
    }
  }

  function updateNodeData(id: string, data: any, isRecord?: boolean, isSubmit?: boolean): void;
  function updateNodeData(id: string, data: any, isRecord: boolean, isSubmit: boolean, options: AgentWriteOptions): Promise<AgentMutationOutcome>;
  function updateNodeData(id: string, data: any, isRecord = true, isSubmit = true, options?: AgentWriteOptions): void | Promise<AgentMutationOutcome> {
    if (options) return get().actions.updateNode(id, { data }, isRecord, isSubmit, options);
    get().actions.updateNode(id, { data }, isRecord, isSubmit);
  }

  return {
  versionNumber: undefined,
  versionConflict: false,
  agentPersistenceIssue: null,
  nodes: [],
  edges: [],
  customToneList: [],
  canvasId: '',
  status: '',
  zoom: 1,
  shortCutLock: false,
  readOnly: false,
  storyboardDropPreview: null,
  undoStack: [],
  redoStack: [],
  isSelection: false,
  focusNodes: [],
  modelsMap: {},
  modelMaxPromptMap: {},
  modelNodePermission: null,
  toolNodePermission: null,
  pointList: [],

  actions: {
    partialUpdate: (canvasId, payload, options) => options
      ? guardAgentOperation(() => partialUpdate(canvasId, payload, options))
      : partialUpdate(canvasId, payload),
    awaitMutationsIdle,
    hasPendingMutations,
    saveFlow,
    setNodes: nodes => set({ nodes }),
    setEdges: edges => set({ edges }),
    setFocusNodes: nodes => set({ focusNodes: nodes }),
    setCanvasId: canvasId => set({ canvasId }),
    setVersionNumber: versionNumber => {
      const currentVersion = get().versionNumber;
      if (versionNumber === undefined || currentVersion === undefined || Number.isNaN(Number(versionNumber)) || Number(versionNumber) > Number(currentVersion)) {
        set({ versionNumber });
      }
    },
    setModelsMap: modelsMap => set({ modelsMap }),
    setModelMaxPromptMap: modelMaxPromptMap => set({ modelMaxPromptMap }),
    setModelNodePermission: modelNodePermission => set({ modelNodePermission }),
    setToolNodePermission: toolNodePermission => set({ toolNodePermission }),
    setPointList: pointList => set({ pointList }),
    setStatus: status => set({ status }),
    setCustomToneList: customToneList => set({ customToneList }),
    setZoom: zoom => set({ zoom }),
    setShortCutLock: shortCutLock => set({ shortCutLock }),
    setReadOnly: readOnly => {
      onReadOnlyChange?.(readOnly);
      set({ readOnly });
    },
    setStoryboardDropPreview: storyboardDropPreview => set({ storyboardDropPreview }),

    // 重置所有
    reset: () => {
      mediaDimensions.reset();
      onReadOnlyChange?.(false);
      set({
        nodes: [],
        edges: [],
        customToneList: [],
        canvasId: '',
        versionNumber: undefined,
        versionConflict: false,
        agentPersistenceIssue: null,
        status: '',
        readOnly: false,
        storyboardDropPreview: null,
        undoStack: [],
        redoStack: [],
        isSelection: false,
        focusNodes: [],
        modelsMap: {},
        modelMaxPromptMap: {},
        modelNodePermission: null,
        toolNodePermission: null,
      });
    },

    init: (data: Data, migration?: ProcessNodesMigrationInput | null, options?: FlowInitializationOptions) => {
      mediaDimensions.reset();
      const canvasData = JSON.parse(data.data);
      if (canvasData) {
        const { nodes: migratedNodes, replacedSubscriptionModel } = processNodesWithMigration(canvasData.nodes, canvasData.edges, migration ?? undefined);
        const edges = processEdges(canvasData.edges);
        const { canvasId, readOnly } = get();
        const persist = options?.persistMediaInitialization !== false && !readOnly;
        const prepared = mediaDimensions.prepareNodesForInitialization(migratedNodes, edges, persist);
        set({
          // 对连线进行旧数据兼容
          edges,
          nodes: prepared.nodes,
          status: data.taskStatus,
          versionNumber: data.versionNumber,
          versionConflict: false,
          agentPersistenceIssue: null,
        });
        get().actions.recordSnapshot();
        mediaDimensions.persistPendingNodes(canvasId, !persist, prepared);
        mediaDimensions.scheduleRequests(prepared.pendingRequests);
        return replacedSubscriptionModel;
      } else {
        set({
          status: data.taskStatus,
          versionNumber: data.versionNumber,
          versionConflict: false,
        });
        return false;
      }
    },

    setSeletion: status => {
      set({
        isSelection: status,
      });
    },

    recordSnapshot: () => {
      const { nodes, edges, undoStack } = get();

      // 保存当前状态并截断历史（最多50步）
      set({
        undoStack: [...undoStack.slice(-49), { nodes, edges }],
        redoStack: [], // 新操作时清空重做栈
      });
    },

    undo: () => {
      const { undoStack, redoStack, nodes, edges, canvasId } = get();
      if (undoStack.length < 2) return;

      const prevState = undoStack[undoStack.length - 2];
      mediaDimensions.invalidateAll();
      const prepared = mediaDimensions.prepareNodesForInitialization(prevState.nodes, prevState.edges);
      const mediaNodeIds = mediaDimensions.getManagedNodeIds(prepared.nodes);
      void mediaDimensions.queuePersistence(mediaNodeIds, () => saveCanvas(canvasId, prepared.nodes, prevState.edges));

      set({
        nodes: prepared.nodes,
        edges: prevState.edges,
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, { nodes, edges }], // 当前状态入重做栈
      });
      mediaDimensions.scheduleRequests(prepared.pendingRequests);
    },

    redo: () => {
      const { redoStack, nodes, edges, canvasId } = get();
      if (redoStack.length === 0) return;

      const nextState = redoStack[redoStack.length - 1];
      mediaDimensions.invalidateAll();
      const prepared = mediaDimensions.prepareNodesForInitialization(nextState.nodes, nextState.edges);
      const mediaNodeIds = mediaDimensions.getManagedNodeIds(prepared.nodes);
      void mediaDimensions.queuePersistence(mediaNodeIds, () => saveCanvas(canvasId, prepared.nodes, nextState.edges));

      set({
        nodes: prepared.nodes,
        edges: nextState.edges,
        undoStack: [...get().undoStack, { nodes, edges }], // 当前状态入撤销栈
        redoStack: redoStack.slice(0, -1),
      });
      mediaDimensions.scheduleRequests(prepared.pendingRequests);
    },

    // 新增模板工作流
    addTemplate: async (templateNodes: Node[], templateEdges: Edge[]) => {
      const processedTemplateNodes = await mediaDimensions.prepareNodesForCreate(processNodes(templateNodes, templateEdges));
      const { nodes, edges, canvasId } = get();

      // 使用util函数计算基准坐标
      const originMaxX = getMaxX(nodes) + 200;
      const originMinY = getMinY(nodes);
      const topLevelTemplateNodes = processedTemplateNodes.filter(node => !node.parentId);
      const templateMinX = getMinX(topLevelTemplateNodes.length ? topLevelTemplateNodes : processedTemplateNodes);
      const templateMinY = getMinY(topLevelTemplateNodes.length ? topLevelTemplateNodes : processedTemplateNodes);

      // 模板节点按模板命名规则保留标题，不走自动命名。
      const { newNodes, newEdges } = addTemplateNodesAndEdges(processedTemplateNodes, processEdges(templateEdges), originMaxX, originMinY, templateMinX, templateMinY);

      // 更新画布节点和连线
      const allNewNodes = [...nodes, ...newNodes];
      const allNewEdges = [...edges, ...newEdges];

      set({
        nodes: allNewNodes,
        edges: allNewEdges,
        focusNodes: newNodes,
      });

      get().actions.recordSnapshot();
      try {
          await partialUpdate(canvasId, {
            addNodes: newNodes,
            allEdges: allNewEdges,
          });
        } catch {
          rollbackAddedElements(
            get,
            set,
            newNodes.map(node => node.id),
            newEdges.map(edge => edge.id)
          );
          throw new Error('加入画布失败');
        }
      },

      // 新增节点
      addNode: async (input: AgentNodeCreate, options?: AgentWriteOptions) => {
        const applyAdd = async () => {
          const targetCanvasId = get().canvasId;
          if (options) assertAgentWrite(get(), targetCanvasId, options);
          const newNodes = typeof input === 'function' ? input(get()) : input;
          if (options) {
            assertAgentWrite(get(), targetCanvasId, options);
            if (!newNodes.length || newNodes.some(node => get().nodes.some(existing => existing.id === node.id))) throw agentError('INVALID_ARGUMENT', '新增节点为空或 ID 已存在');
          }
          const preparedNodes = await mediaDimensions.prepareNodesForCreate(newNodes);
          const { nodes, canvasId } = get();
          if (options) assertAgentWrite(get(), targetCanvasId, options);
          const placedNodes = options?.nodePlacement ? placeAgentNodes(preparedNodes, nodes, options.nodePlacement) : preparedNodes;
          const nodesToAdd = assignNodeTitles({
            existingNodes: nodes,
            nodesToAdd: placedNodes,
            mode: 'auto',
          }).map(item => ({
            ...item,
            selected: !options,
          }));
          const updateNodes = options ? nodes : nodes.map(item => {
            return {
              ...item,
              selected: false,
            };
          });
          set({ nodes: [...updateNodes, ...nodesToAdd] });
          if (!options) get().actions.recordSnapshot();
          // 容错回退机制
          try {
            const outcome = await partialUpdate(canvasId, {
              addNodes: nodesToAdd,
            }, options);
            if (options && get().canvasId === canvasId) get().actions.recordSnapshot();
            return outcome;
          } catch (error) {
            if (!options || (get().canvasId === canvasId && !isUnknownWrite(error))) {
              rollbackAddedElements(get, set, nodesToAdd.map(node => node.id));
              if (options) {
                let conflict = false;
                set({ nodes: get().nodes.map(node => {
                  const before = nodes.find(item => item.id === node.id);
                  const optimistic = updateNodes.find(item => item.id === node.id);
                  if (!before || !optimistic) return node;
                  const restored = restoreChangedFields(before, optimistic, node);
                  conflict ||= restored.conflict;
                  return { ...node, ...restored.value };
                }) });
                if (conflict || get().edges.some(edge => nodesToAdd.some(node => node.id === edge.source || node.id === edge.target))) set({ agentPersistenceIssue: persistenceFailure(error) });
              }
            }
            if (options) {
              if (get().canvasId === canvasId) get().actions.recordSnapshot();
              throw Object.assign(notSentError(error), { affectedNodeIds: nodesToAdd.map(node => node.id) });
            }
          }
        };
        return options ? guardAgentOperation(applyAdd) : applyAdd();
    },

    // 拖拽连线
    dragAddNode: async (newNode: Node, edge: Edge, options?: { selectNewNode?: boolean }) => {
      const [preparedNode = newNode] = await mediaDimensions.prepareNodesForCreate([newNode]);
      const { nodes, edges, canvasId } = get();
      const selectNewNode = options?.selectNewNode !== false;
      const newEdge = dealEdge(edge);
      const newEdges = [...edges, newEdge];
      const [namedNode] = assignNodeTitles({
        existingNodes: nodes,
        existingEdges: edges,
        nodesToAdd: [preparedNode],
        edgesToAdd: [newEdge],
        mode: 'auto',
      });
      const nodeToAdd = namedNode || preparedNode;
      const newNodes = nodes.map(item => {
        return {
          ...item,
          selected: false,
        };
      });
      if (selectNewNode) {
        nodeToAdd.selected = true;
      } else {
        nodeToAdd.selected = false;
      }
      set({
        nodes: [...newNodes, nodeToAdd],
        edges: newEdges,
      });
      get().actions.recordSnapshot();
      // 容错回退机制
      try {
        await partialUpdate(canvasId, {
          addNodes: [nodeToAdd],
          allEdges: newEdges,
        });
      } catch {
        rollbackAddedElements(get, set, [nodeToAdd.id], [newEdge.id]);
      }
    },

    // 批量拖拽连线（单次快照与持久化）
    dragAddNodes: async (newNodes: Node[], newEdges: Edge[], options?: { selectNewNode?: boolean }) => {
      if (!newNodes.length) return;
      const preparedNodes = await mediaDimensions.prepareNodesForCreate(newNodes);
      const { nodes, edges, canvasId } = get();
      const selectNewNode = options?.selectNewNode !== false;
      const processedEdges = newEdges.map(edge => dealEdge(edge));
      const mergedEdges = [...edges, ...processedEdges];
      const deselectedNodes = nodes.map(item => ({ ...item, selected: false }));
      const namedNodes = assignNodeTitles({
        existingNodes: nodes,
        existingEdges: edges,
        nodesToAdd: preparedNodes,
        edgesToAdd: processedEdges,
        mode: 'auto',
      });
      const nodesToAdd = namedNodes.map(node => ({
        ...node,
        selected: selectNewNode,
      }));
      if (!selectNewNode) {
        nodesToAdd.forEach(node => {
          node.selected = false;
        });
      } else if (nodesToAdd.length > 1) {
        nodesToAdd.forEach((node, index) => {
          node.selected = index === nodesToAdd.length - 1;
        });
      }
      set({
        nodes: [...deselectedNodes, ...nodesToAdd],
        edges: mergedEdges,
      });
      get().actions.recordSnapshot();
      try {
        await partialUpdate(canvasId, {
          addNodes: nodesToAdd,
          allEdges: mergedEdges,
        });
      } catch {
        rollbackAddedElements(
          get,
          set,
          nodesToAdd.map(node => node.id),
          processedEdges.map(edge => edge.id)
        );
      }
    },

    deleteNodes,

    // 删除组节点
    deleteGroupNode: (id: string) => {
      const { nodes, edges, canvasId } = get();
      const childNodes = nodes.filter(item => item.parentId == id);
      const childNodeIds = childNodes.map(item => item.id);
      const newEdges = edges.filter(e => !childNodeIds.includes(e.source) && !childNodeIds.includes(e.target));
      const allDeleteIds = [...childNodeIds, id];
      mediaDimensions.invalidate(allDeleteIds);
      set({
        nodes: nodes.filter(n => !allDeleteIds.includes(n.id)),
        edges: newEdges,
      });
      void mediaDimensions.queuePersistence(allDeleteIds, () =>
        partialUpdate(canvasId, {
          deleteNodeIds: allDeleteIds,
          allEdges: newEdges,
        })
      );
      get().actions.recordSnapshot();
    },

    // 复制节点
    copyNode: async (id: string) => {
      const { nodes, edges } = get();
      const originalNode = nodes.find(n => n.id === id);
      if (!originalNode) return;

      const { newNode, newEdges } = copy(originalNode, nodes, edges);
      const [preparedNode = newNode] = await mediaDimensions.prepareNodesForCreate([newNode]);
      const currentState = get();
      const [namedNode] = assignNodeTitles({
        existingNodes: currentState.nodes,
        nodesToAdd: [preparedNode],
        mode: 'copy',
      });
      const nodeToAdd = namedNode || preparedNode;
      const updateNodes = currentState.nodes.map((node: Node) => {
        if (node.id == originalNode.id) {
          return {
            ...node,
            selected: false,
          };
        } else return node;
      });
      const allEdges = newEdges.concat(currentState.edges);
      set({
        nodes: [...updateNodes, nodeToAdd],
        edges: allEdges,
      });
      get().actions.recordSnapshot();
      try {
        await partialUpdate(currentState.canvasId, {
          addNodes: [nodeToAdd],
          allEdges,
        });
      } catch {
        rollbackAddedElements(
          get,
          set,
          [nodeToAdd.id],
          newEdges.map(edge => edge.id)
        );
      }
    },

    // 粘贴节点
    pasteNode: async (originNodes: Node[], mousePosition?: Position) => {
      const { nodes, edges } = get();
      const { newNodes, newEdges } = paste(nodes, edges, originNodes, mousePosition);
      const preparedNodes = await mediaDimensions.prepareNodesForCreate(newNodes);
      const { nodes: currentNodes, edges: currentEdges, canvasId } = get();
      const nodesToAdd = assignNodeTitles({
        existingNodes: currentNodes,
        nodesToAdd: preparedNodes,
        mode: 'copy',
      });
      const updateNode = currentNodes.map((node: Node) => {
        return {
          ...node,
          selected: false,
        };
      });
      const allEdges = newEdges.concat(
        currentEdges.map(edge => {
          return { ...edge, selected: false };
        })
      );
      set({
        nodes: [...updateNode, ...nodesToAdd],
        edges: allEdges,
      });
      get().actions.recordSnapshot();
      try {
        await partialUpdate(canvasId, {
          addNodes: nodesToAdd,
          allEdges,
        });
      } catch {
        rollbackAddedElements(
          get,
          set,
          nodesToAdd.map(node => node.id),
          newEdges.map(edge => edge.id)
        );
      }
    },

    // 打组节点
    groupNodes: (selectedNodes: Node[]) => {
      const { nodes, canvasId } = get();
      if (!selectedNodes || selectedNodes.length < 2) return;
      const selectedChild = selectedNodes.filter(node => node.parentId);
      // 区分原来是否存在已组合节点
      if (selectedChild.length) {
        // 先解组
        const uniqueNodes = uniqueByField(selectedChild, 'parentId');
        const groupIds = uniqueNodes.map(item => item.parentId || '');
        const groupNodes = nodes.filter(item => groupIds.includes(item.id));
        // 解组的同时更新选中节点selectedNodes中各节点的位置
        const { newNodes, updateNodes: updateChild } = upgroupChild(nodes, groupNodes, selectedNodes);
        // 再打组
        const range = getNodesRange(selectedNodes);
        const groupNode = creatGroupNode(range);
        const { updatedNodes, needUpdateNodes } = updateGroupChild(newNodes, selectedNodes, groupNode);
        const lastNodes = [groupNode, ...updatedNodes];
        const lastUpdateNodes = updateChild.concat(needUpdateNodes);
        partialUpdate(canvasId, {
          deleteNodeIds: groupIds,
          addNodes: [groupNode],
          updateNodes: lastUpdateNodes,
        });
        set({ nodes: lastNodes });
      } else {
        const range = getNodesRange(selectedNodes);
        const groupNode = creatGroupNode(range);
        const { updatedNodes, needUpdateNodes } = updateGroupChild(nodes, selectedNodes, groupNode);
        const newNodes = [groupNode, ...updatedNodes];
        partialUpdate(canvasId, {
          addNodes: [groupNode],
          updateNodes: needUpdateNodes,
        });
        set({ nodes: newNodes });
      }
      get().actions.recordSnapshot();
    },

    // 多选排版
    layoutSelectedNodes: (selectedNodes: Node[], mode: LayoutMode) => {
      const { nodes, edges, canvasId, readOnly } = get();
      if (readOnly || !selectedNodes || selectedNodes.length < 2) return;

      const latestSelected = selectedNodes.map(n => nodes.find(item => item.id === n.id) || n);
      const updates = layoutSelectedNodes(latestSelected, edges, nodes, mode);
      if (updates.length === 0) return;

      const positionMap = new Map(updates.filter(item => item.position).map(item => [item.id, item.position!]));
      const styleMap = new Map(updates.filter(item => item.style).map(item => [item.id, item.style!]));

      const newNodes = sortNodesParentFirst(
        nodes.map(node => {
          const nextPosition = positionMap.get(node.id);
          const nextStyle = styleMap.get(node.id);
          if (!nextPosition && !nextStyle) return node;
          return {
            ...node,
            ...(nextPosition ? { position: nextPosition } : {}),
            ...(nextStyle
              ? {
                  style: {
                    ...(node.style || {}),
                    ...nextStyle,
                  },
                }
              : {}),
          };
        })
      );

      set({ nodes: newNodes });
      partialUpdate(canvasId, {
        updateNodes: updates.map(item => ({
          id: item.id,
          ...(item.position ? { position: item.position } : {}),
          ...(item.style
            ? {
                style: {
                  ...(nodes.find(node => node.id === item.id)?.style || {}),
                  ...item.style,
                },
              }
            : {}),
        })),
      });
      get().actions.recordSnapshot();
    },

    // 解组节点
    ungroupNodes: (groupId: string) => {
      const { nodes, canvasId } = get();
      const groupNode = nodes.find(node => node.id === groupId);
      if (!groupNode || groupNode.type !== 'group') return;
      const { newNodes, updateNodes } = upgroupChild(nodes, [groupNode]);
      partialUpdate(canvasId, {
        deleteNodeIds: [groupId],
        updateNodes: updateNodes,
      });
      set({ nodes: newNodes });
      get().actions.recordSnapshot();
    },

    // 根据轮询信息更新节点内容
    updateNodesMap: (nodesMap: Node[]) => {
      const { nodes, edges, canvasId, readOnly } = get();
      const { newNodes, isChangeFailure } = updateNodesByMap(nodes, nodesMap);
      mediaDimensions.reconcilePolledNodes(nodes, newNodes, edges, canvasId, readOnly);
      return isChangeFailure;
    },

    renameNode: (id: string, title: string) => {
      const { nodes } = get();
      const currentNode = nodes.find(node => node.id === id);
      const validation = validateNodeTitle({
        existingNodes: nodes,
        nodeId: id,
        nextTitle: title,
      });

      if (!validation.ok) return validation;
      if (!currentNode) return { ok: false, reason: 'missing' };

      get().actions.updateNodeData(id, {
        ...currentNode.data,
        title: validation.title,
      });

      return validation;
    },

    updateNode,

    updateNodeData,

    // 更新节点状态
    updateNodeStatus: async (id: string, status: string, errorMsg?: string) => {
      const { nodes } = get();
      let updateContent;
      const newNodes = nodes.map(node => {
        if (node.id === id) {
          updateContent = {
            id: node.id,
            data: {
              ...node.data,
              taskInfo: {
                ...(node.data.taskInfo ?? {}),
                status: status,
                errorMsg: errorMsg,
              },
            },
          };
          return {
            ...node,
            ...updateContent,
          };
        }
        return node;
      });
      if (updateContent) {
        set({ nodes: newNodes });
      }
    },

    // 更新所有运行中节点状态为失败状态
    updateAllNodeStatus: () => {
      const { nodes } = get();
      const newNodes = nodes.map(node => {
        const taskInfo: any = node.data.taskInfo;
        if (taskInfo && taskInfo.status == 'running') {
          return {
            ...node,
            data: {
              ...node.data,
              taskInfo: {
                ...(node.data.taskInfo ?? {}),
                status: 'failure',
                errorMsg: '【1013】系统升级维护中，请稍后重试~',
              },
            },
          };
        } else {
          return node;
        }
      });
      set({ nodes: newNodes });
    },

    // 更新节点尺寸
    updateNodeMeasured: mediaDimensions.updateNodeMeasured,

    ensureNodeMediaDimensions: mediaDimensions.ensureNodeMediaDimensions,

    invalidateMediaDimensionRequests: mediaDimensions.invalidate,

    persistNodeChanges: mediaDimensions.persistNodeChanges,

    // 更新节点选中状态
    updateNodeSelected: (id: string, selected: boolean) => {
      const { nodes } = get();
      const newNodes = nodes.map(node => {
        if (node.id === id) {
          return {
            ...node,
            selected,
          };
        }
        return node;
      });
      set({ nodes: newNodes });
    },

    // 更新节点所有入参连线类型
    updateInputEdgesType: (id: string, type: string) => {
      const { edges } = get();
      const newEdges = edges.map((edge: Edge) => {
        if (id == edge.target) {
          return {
            ...edge,
            type: type ? type : 'default',
          };
        } else {
          return edge;
        }
      });
      set({ edges: newEdges });
    },

    applyAgentDelta: (build, options) => guardAgentOperation(async () => {
      const before = get(); const canvasId = before.canvasId;
      assertAgentWrite(before, canvasId, options);
      const delta = build(before);
      if (delta.updateNodes?.some(node => !before.nodes.some(n => n.id === node.id))) throw agentError('NODE_NOT_FOUND', '更新节点已不存在');
      delta.updateNodes = delta.updateNodes?.filter(patch => {
        const node = before.nodes.find(n => n.id === patch.id)!;
        return Object.entries(patch).some(([key, value]) => key !== 'id' && !isEqual((node as any)[key], key === 'data' ? { ...node.data, ...(value as any) } : value));
      });
      if (delta.allEdges && isEqual(delta.allEdges, before.edges)) delete delta.allEdges;
      const changedIds = [...new Set([...(delta.addNodes ?? []).map(n => n.id), ...(delta.updateNodes ?? []).map(n => n.id)])];
      if (!changedIds.length && !delta.allEdges) return { version: String(before.versionNumber), affectedNodeIds: [], unchanged: true };
      assertAgentNodesIdle(before.nodes, [...changedIds, ...(options.affectedNodeIds ?? [])], options.processCompletionId);
      const added = delta.addNodes ?? [];
      if (added.some(node => before.nodes.some(n => n.id === node.id)) || new Set(added.map(n => n.id)).size !== added.length) throw agentError('INVALID_ARGUMENT', '新节点身份重复');
      const prepared = added.length ? await mediaDimensions.prepareNodesForCreate(added) : [];
      const payload = { ...delta, ...(added.length ? { addNodes: prepared } : {}) };
      try {
        const receipt = await partialUpdate(canvasId, payload, options) as AgentMutationOutcome;
        const patches = new Map((payload.updateNodes ?? []).map(n => [n.id, n]));
        const next = get().nodes.map(node => { const patch = patches.get(node.id); return patch ? { ...node, ...patch, ...(patch.data ? { data: { ...node.data, ...patch.data } } : {}) } : node; });
        set({ nodes: [...next, ...prepared], ...(payload.allEdges ? { edges: payload.allEdges } : {}) });
        get().actions.recordSnapshot();
        return { ...receipt, affectedNodeIds: changedIds, ...(payload.allEdges ? { affectedEdgeIds: payload.allEdges.filter(edge => !before.edges.some(old => old.id === edge.id)).map(edge => edge.id) } : {}) };
      } catch (error) { throw Object.assign(error as Error, { affectedNodeIds: changedIds }); }
    }),
    editAgentEdges,

    deleteEdges: (ids: string[]) => {
      if (!ids.length) return;
      const { canvasId, edges } = get();
      const deleteIds = new Set(ids);
      const newEdges = edges.filter(item => !deleteIds.has(item.id));
      if (newEdges.length === edges.length) return;
      set({ edges: newEdges });
      partialUpdate(canvasId, {
        allEdges: newEdges,
      });
      get().actions.recordSnapshot();
    },

    connect: (edge: Edge) => {
      const { canvasId, edges, nodes } = get();
      if (!validateConnection(edge, nodes)) return;

      const edgeToAdd = { ...edge };
      // 句柄不符合要求时校准句柄
      if (!isAllowHandler(edgeToAdd)) {
        const targetNode = nodes.find((n: Node) => n.id === edgeToAdd.target);
        if (!targetNode || !calibrateEdge(targetNode, edgeToAdd)) return;
      }

      const newEdge = dealEdge(edgeToAdd);
      const newEdges = addEdge(newEdge, edges);
      set({ edges: newEdges });
      partialUpdate(canvasId, {
        allEdges: newEdges,
      });
      get().actions.recordSnapshot();
    },

    connectMany: (edgesToAdd: Edge[]) => {
      const { canvasId, edges, nodes } = get();
      const added: Edge[] = [];
      const failed: Edge[] = [];
      let workingEdges = [...edges];

      edgesToAdd.forEach(edge => {
        if (!validateConnection(edge, nodes)) {
          failed.push(edge);
          return;
        }
        const edgeToAdd = { ...edge };
        if (!isAllowHandler(edgeToAdd)) {
          const targetNode = nodes.find((n: Node) => n.id === edgeToAdd.target);
          if (!targetNode || !calibrateEdge(targetNode, edgeToAdd)) {
            failed.push(edge);
            return;
          }
        }

        const targetNode = nodes.find((n: Node) => n.id === edgeToAdd.target);
        const limit = getHandleLimit(targetNode?.type, edgeToAdd.targetHandle);
        if (limit != null) {
          const used = workingEdges.filter(e => e.target === edgeToAdd.target && e.targetHandle === edgeToAdd.targetHandle).length;
          if (used >= limit) {
            failed.push(edge);
            return;
          }
        }

        const dup = workingEdges.some(
          e => e.source === edgeToAdd.source && e.target === edgeToAdd.target && e.sourceHandle === edgeToAdd.sourceHandle && e.targetHandle === edgeToAdd.targetHandle
        );
        if (dup) {
          failed.push(edge);
          return;
        }
        const newEdge = dealEdge(edgeToAdd);
        workingEdges = addEdge(newEdge, workingEdges);
        added.push(newEdge);
      });

      // 多选连入后：清边选中态 + 取消节点框选
      const cleanedEdges = (added.length > 0 ? workingEdges : edges).map(stripEdgeTransientUiState);
      const deselectedNodes = nodes.map(n => (n.selected ? { ...n, selected: false } : n));
      set({
        edges: cleanedEdges,
        nodes: deselectedNodes,
        isSelection: false,
      });

      if (added.length > 0) {
        partialUpdate(canvasId, {
          allEdges: cleanedEdges,
        });
        get().actions.recordSnapshot();
      }

      return { added, failed };
    },

    edgeOrderChange: (imageMap: ImageMapItem[]) => {
      const { canvasId, edges } = get();
      const edgeIds = imageMap.map(item => item.edgeId);

      // 创建一个映射来存储 edgeId 到其在 edgeIds 中索引的映射
      const edgeOrderMap = new Map(edgeIds.map((id, index) => [id, index]));

      // 按照 edgeIds 的顺序对 edges 进行排序
      const reorderedEdges = [...edges].sort((a, b) => {
        const orderA = edgeOrderMap.has(a.id) ? edgeOrderMap.get(a.id)! : Infinity;
        const orderB = edgeOrderMap.has(b.id) ? edgeOrderMap.get(b.id)! : Infinity;

        return orderA - orderB;
      });
      set({ edges: reorderedEdges });
      partialUpdate(canvasId, {
        allEdges: reorderedEdges,
      });
      get().actions.recordSnapshot();
    },

    // 执行组
    excuteGroup: (id: string) => prepareNativeRun(async () => {
      const { nodes, edges, canvasId, modelMaxPromptMap, modelNodePermission, modelsMap } = get();
      const excuteNodes = getGroupAllChild(nodes, id);
      const excuteEdges = getEdgesByNodes(excuteNodes, edges);
      const { isAllow, message } = await isAllowRun(excuteNodes, excuteEdges, modelMaxPromptMap, nodes, edges, 'total', modelNodePermission, '', modelsMap, () => isAllowCapacity(feedback.showCapacityLimit, requestOptions?.()));
      if (!isAllow) {
        return message;
      }
      const { sourceNodes, relateEdges } = getSourceNodesAndEdges(nodes, excuteNodes, edges);
      const params = {
        canvasId,
        workflowData: {
          nodes: excuteNodes.concat(sourceNodes),
          edges: excuteEdges.concat(relateEdges),
        },
        executeStrategy: 'total',
        runningNodeIds: [id],
      };
      const res = await executeWorkflow(params);
      if (res.type === 'success') {
        set({
          status: 'RUNNING',
        });
      }
      return res;
    }),

    // 临时执行
    excuteTemp: (nodes: Node[]) => prepareNativeRun(async () => {
      const { nodes: allNodes, edges, canvasId, modelMaxPromptMap, modelNodePermission, modelsMap } = get();
      const excuteEdges = getEdgesByNodes(nodes, edges);
      const { isAllow, message } = await isAllowRun(nodes, excuteEdges, modelMaxPromptMap, allNodes, edges, 'total', modelNodePermission, '', modelsMap, () => isAllowCapacity(feedback.showCapacityLimit, requestOptions?.()));
      if (!isAllow) {
        return message;
      }
      const { sourceNodes, relateEdges } = getSourceNodesAndEdges(allNodes, nodes, edges);
      const params = {
        canvasId,
        workflowData: {
          nodes: nodes.concat(sourceNodes),
          edges: excuteEdges.concat(relateEdges),
        },
        executeStrategy: 'total',
      };
      const res = await executeWorkflow(params);
      if (res.type === 'success') {
        set({
          status: 'RUNNING',
        });
      }
      return res;
    }),

    // 单点执行
    excuteSingle: async (id: string, options?: AgentRunOptions) => {
      const run = async () => {
        try {
          const targetCanvasId = get().canvasId;
          if (options) {
            assertAgentWrite(get(), targetCanvasId, options);
            assertAgentNodesIdle(get().nodes, [id]);
          }
          const allowCapacity = await isAllowCapacity(options ? (() => undefined) : (feedback.showCapacityLimit ?? (() => undefined)), options ? { ...requestOptions?.(), signal: options.signal, silentError: true } : requestOptions?.());
          if (!allowCapacity) {
            return capacityWarning;
          }

          const { nodes, edges, canvasId, modelMaxPromptMap, modelNodePermission, modelsMap } = get();
          if (options) {
            assertAgentWrite(get(), targetCanvasId, options);
            if (!nodes.some(node => node.id === id)) throw agentError('NODE_NOT_FOUND', '目标节点不存在');
            assertAgentNodesIdle(nodes, [id]);
          }
          const payload = buildSingleWorkflowPayload(canvasId, nodes, edges, id);
          const excuteNodes = payload.workflowData.nodes;
          const excuteEdges = payload.workflowData.edges;

          const { isAllow, message } = await isAllowRun(excuteNodes, excuteEdges, modelMaxPromptMap, nodes, edges, 'single', modelNodePermission, id, modelsMap, options ? async () => true : () => isAllowCapacity(feedback.showCapacityLimit, requestOptions?.()));
          if (!isAllow) {
            return message;
          }

          if (options) {
            try { await calculateSingleWorkflowCost(payload, { ...requestOptions?.(), signal: options.signal, silentError: true, receiptMode: 'agent' }); }
            catch (error) { throw Object.assign(error instanceof Error ? error : new Error('预估赛点消耗失败'), { requestPhase: 'not_sent' }); }
            assertAgentWrite(get(), targetCanvasId, options);
            assertAgentNodesIdle(get().nodes, [id]);
          }
          const res = await executeWorkflow(payload, options);
          if (res.type === 'success') {
            if (options) get().actions.updateNodeStatus(id, 'running');
            set({ status: 'RUNNING' });
          }
          return res;
        } catch (error) {
          if (options) {
            if ((error as any)?.raw?.__accepted) { get().actions.updateNodeStatus(id, 'running'); set({ status: 'RUNNING' }); }
            throw notSentError(error);
          }
          throw error;
        }
      };
      return options ? guardAgentOperation(run) : prepareNativeRun(run);
    },
  },
};
};

export type FlowStoreApi = StoreApi<FlowState>;
export interface FlowStoreFeedback {
  error?: (message: string) => void;
  showCapacityLimit?: () => void | Promise<void>;
}
export interface FlowStoreOptions {
  barrier?: CanvasVersionBarrier;
  guard?: AgentEditGuard;
  feedback?: FlowStoreFeedback;
  onReadOnlyChange?: (readOnly: boolean) => void;
  isContextActive?: () => boolean;
  requireConfirmedNativeVersion?: boolean;
  requestOptions?: () => import('@/api/workflow').CanvasRequestOptions;
}

export function createFlowStoreApi({
  barrier = createCanvasVersionBarrier(), guard = createAgentEditGuard(),
  feedback = {}, onReadOnlyChange, isContextActive, requestOptions, requireConfirmedNativeVersion,
}: FlowStoreOptions = {}): FlowStoreApi {
  return createStore<FlowState>((set, get) => {
    let mutationQueue: Promise<void> = Promise.resolve();
    let pendingMutations = 0;

    const updateVersionNumber = (canvasId: string, response: any) => {
      if (get().canvasId !== canvasId) return;
      const versionNumber = response?.versionNumber ?? response?.data?.versionNumber;
      if (typeof versionNumber === 'number' || typeof versionNumber === 'string') get().actions.setVersionNumber(versionNumber);
    };

    const enqueueMutation = <T>(canvasId: string, mutation: () => Promise<T>, options?: AgentWriteOptions) => {
      pendingMutations++;
      const releasePollingBarrier = barrier.beginMutation();
      const result = mutationQueue
        .catch(() => undefined)
        .then(async () => {
          if (isContextActive && !isContextActive()) throw agentError('FRAME_GONE', '目标画布上下文已失效');
          if (!options && get().canvasId === canvasId && get().versionConflict) {
            return Promise.reject(new Error('Version conflict: skipping pending mutation'));
          }

          await barrier.waitPollingIdle();
          if (barrier.consumeUncertain()) {
            if (get().canvasId === canvasId) set({ versionConflict: true });
            if (options) throw agentError('VERSION_CONFLICT', '轮询后的画布版本未确认');
            throw new Error('Canvas version is uncertain after polling');
          }

          if (isContextActive && !isContextActive()) throw agentError('FRAME_GONE', '目标画布上下文已失效');
          if (options) { guard.assertOperationActive(); assertAgentWrite(get(), canvasId, options); }

          return mutation();
        })
        .then(response => {
          if (options) {
            const version = (response as any)?.versionNumber ?? (response as any)?.data?.versionNumber;
            const valid = typeof version === 'string' ? version.trim().length > 0 && version.length <= 100
              : typeof version === 'number' && Number.isSafeInteger(version) && version >= 0;
            if (!valid || get().canvasId !== canvasId) {
              if ((response as any)?.type === 'success' && get().canvasId === canvasId) {
                (response as any).__accepted = true;
              }
              throw Object.assign(new CanvasAgentError('SUBMISSION_UNKNOWN', '请求已返回，但缺少可信版本或目标画布已切换'), { requestPhase: 'sent_unknown', raw: response });
            }
            // A strict receipt preserves the exact server version; never compare Long strings via Number.
            set({ versionNumber: version });
          } else {
            const version = (response as any)?.versionNumber ?? (response as any)?.data?.versionNumber;
            const trusted = typeof version === 'string' ? version.trim().length > 0 && version.length <= 100
              : typeof version === 'number' && Number.isSafeInteger(version) && version >= 0;
            if (requireConfirmedNativeVersion && !trusted && get().canvasId === canvasId) {
              // Preserve native UI success/return behaviour; fence future Agent writes until reload.
              set({ agentPersistenceIssue: { code: 'SUBMISSION_UNKNOWN', message: '原生保存或执行已返回，但缺少可信版本，请刷新核对', retry: 'read_first' } });
            } else updateVersionNumber(canvasId, response);
          }
          return response;
        })
        .catch(error => {
          // Strict request.ts tags every fetch outcome; an untagged local preparation error was not sent.
          if (options && !error?.requestPhase) {
            error = notSentError(error);
          }
          if (get().canvasId === canvasId && (!options || isUnknownWrite(error))) {
            set({ agentPersistenceIssue: persistenceFailure(error) });
          }
          if (get().canvasId === canvasId && !isUnknownWrite(error) && isVersionConflict(error)) {
            set({ versionConflict: true });
          } else if (!options && error?.raw?.msg) {
            feedback.error?.(error.message);
          }
          throw error;
        })
        .finally(() => { pendingMutations--; releasePollingBarrier(); });
      mutationQueue = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    };

    const partialUpdate = (canvasId: string, payload: ParamsContent, options?: AgentWriteOptions) =>
      enqueueMutation(canvasId, async () => {
        const currentVersion = get().canvasId === canvasId ? get().versionNumber : undefined;
        if (options) assertAgentNodesIdle(get().nodes, [...(payload.updateNodes ?? []).map(node => node.id), ...(payload.deleteNodeIds ?? []), ...(options.affectedNodeIds ?? [])], options.processCompletionId);
        return partialUpdateRequest(canvasId, payload, currentVersion, { ...requestOptions?.(), ...(options ? { receiptMode: 'agent' as const, signal: options.signal } : {}) }, get().readOnly);
      }, options).then(response => options ? {
        version: String((response as any)?.versionNumber ?? (response as any)?.data?.versionNumber),
        affectedNodeIds: [...new Set([...(payload.addNodes ?? []).map(node => node.id), ...(payload.updateNodes ?? []).map(node => node.id), ...(payload.deleteNodeIds ?? [])])],
      } : undefined);

    const saveCanvas = (canvasId: string, nodes: Node[], edges: Edge[]) => {
      return enqueueMutation(canvasId, () => {
        const versionNumber = get().canvasId === canvasId ? get().versionNumber : undefined;
        return saveCanvasRequest(canvasId, nodes, edges, versionNumber, requestOptions?.(), get().readOnly);
      }).then(() => undefined);
    };

    const saveFlow = (params: CanvasData) => {
      const canvasId = params.id || get().canvasId;
      return enqueueMutation(canvasId, () => {
        const versionNumber = get().canvasId === canvasId ? get().versionNumber : undefined;
        return saveFlowRequest({ ...params, versionNumber }, { silentError: true, ...requestOptions?.() });
      });
    };

    const executeWorkflow = (params: WorkFlowExcute, options?: AgentRunOptions) =>
      enqueueMutation(params.canvasId, () => {
        const currentVersion = get().canvasId === params.canvasId ? get().versionNumber : undefined;
        if (options) {
          const ids = params.runningNodeIds ?? [];
          assertAgentNodesIdle(get().nodes, ids);
          const target = get().nodes.find(node => node.id === ids[0]);
          const counts = target && getAgentGenerationCounts(get(), target);
          if (target) validateAgentRunInputs(get(), target);
          if (!counts || !sameGenerationCounts(counts, options.approvedGeneration)
            || options.approvedAudioConfig !== undefined && (!target || agentAudioConfigurationKey(get(), target) !== options.approvedAudioConfig)) throw agentError('COUNT_CHANGED', '生成数量或参数已变化，请重新预检');
        }
        const currentPayload = options ? buildSingleWorkflowPayload(params.canvasId, get().nodes, get().edges, params.runningNodeIds![0]) : params;
        return excute({ ...currentPayload, versionNumber: currentVersion }, { ...requestOptions?.(), ...(options ? { receiptMode: 'agent' as const, signal: options.signal } : {}) });
      }, options);

    const mediaDimensions = createFlowMediaDimensionCoordinator({
      getState: get,
      setNodes: nodes => set({ nodes }),
      partialUpdate, isContextActive,
    });
    const awaitMutationsIdle = async () => {
      let previous: Promise<void>;
      do {
        previous = mutationQueue;
        await mediaDimensions.waitPersistenceIdle();
        await mutationQueue;
      } while (previous !== mutationQueue);
    };
    const hasPendingMutations = () => pendingMutations > 0 || mediaDimensions.hasPendingPersistence();
    return createFlowState(set, get, mediaDimensions, { partialUpdate, awaitMutationsIdle, hasPendingMutations, saveCanvas, saveFlow, executeWorkflow }, guard, feedback, onReadOnlyChange, requestOptions);
  });
}
