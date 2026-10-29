import type { AgentMutationOutcome } from './flowStoreCore';
import type { Edge, Node } from '@xyflow/react';
import type { AgentWriteOptions } from '../../../../src/shared/canvas-agent-protocol';
import { loadIntrinsicMediaDimensions } from '@/components/canvasFlow/utils/mediaDimensionLoader';
import {
  getCompleteMediaNodeDimensions,
  getMediaDimensionMeta,
  getMediaDimensionPolicy,
  getMediaNodeValue,
  resolveMediaNodeDimensions,
  type MediaDimensionMeta,
  type MediaDimensionMode,
  type MediaNodeMeasuredSize,
} from '@/components/canvasFlow/utils/mediaDimensions';

interface FlowMediaDimensionState {
  nodes: Node[];
  edges: Edge[];
  canvasId: string;
  readOnly: boolean;
}

interface PartialUpdatePayload {
  updateNodes?: Array<any>;
  addNodes?: Node[];
  deleteNodeIds?: string[];
  allEdges?: Edge[];
}

interface FlowMediaDimensionDependencies {
  isContextActive?: () => boolean;
  getState: () => FlowMediaDimensionState;
  setNodes: (nodes: Node[]) => void;
  partialUpdate: (canvasId: string, payload: PartialUpdatePayload, options?: AgentWriteOptions) => Promise<AgentMutationOutcome | void>;
}

interface MediaDimensionResolutionContext {
  currentDimensions: MediaNodeMeasuredSize | null;
  currentDimensionsTrusted: boolean;
  mode: MediaDimensionMode;
  persist: boolean;
}

interface MediaDimensionResolutionRequest {
  id: string;
  sourceValue: string;
  context?: MediaDimensionResolutionContext;
}

export interface PreparedMediaNodes {
  nodes: Node[];
  pendingRequests: MediaDimensionResolutionRequest[];
  pendingNodes: Node[];
}

export interface PreparedMediaNodeData {
  data: any;
  valueChanged: boolean;
  shouldQueuePersistence: boolean;
  resolutionRequest: MediaDimensionResolutionRequest | null;
}

interface Measured {
  width: number;
  height: number;
}

const SOURCE_ONLY_MEDIA_NODE_TYPES = new Set(['textRedrawTool']);
const SOURCE_FIRST_MEDIA_NODE_TYPES = new Set(['textRedrawTool', 'imageInpaintTool']);
const SOURCE_FALLBACK_MEDIA_NODE_TYPES = new Set(['imageLayoutTool', 'videoClipTool']);

const withMediaDimensionMeta = (node: Node, meta: MediaDimensionMeta): Node => ({
  ...node,
  data: {
    ...node.data,
    dimensionMeta: meta,
  },
});

const withResolvedMediaDimensions = (node: Node, dimensions: MediaNodeMeasuredSize, meta: MediaDimensionMeta): Node => ({
  ...node,
  width: dimensions.width,
  height: dimensions.height,
  measured: {
    width: dimensions.measured.width,
    height: dimensions.measured.height,
  },
  data: {
    ...node.data,
    dimensionMeta: meta,
  },
});

const prepareMediaNodeForCreate = async (node: Node): Promise<Node> => {
  const policy = getMediaDimensionPolicy(node.type);
  const value = getMediaNodeValue(node);
  if (!policy || !value) return node;

  const currentDimensions = getCompleteMediaNodeDimensions(node);
  const currentMeta = getMediaDimensionMeta(node);
  const currentDimensionsMatchValue = !currentMeta || (currentMeta.status === 'valid' && currentMeta.sourceValue === value);

  if (currentDimensions && currentDimensionsMatchValue) {
    return withResolvedMediaDimensions(node, currentDimensions, {
      sourceValue: value,
      status: 'valid',
      mode: currentMeta?.mode ?? 'auto',
    });
  }

  const intrinsic = await loadIntrinsicMediaDimensions(policy.mediaType, value);
  const dimensions = intrinsic ? resolveMediaNodeDimensions(intrinsic, policy, currentDimensions, currentDimensionsMatchValue) : null;
  if (!dimensions) {
    return withMediaDimensionMeta(
      {
        ...node,
        width: undefined,
        height: undefined,
        measured: undefined,
      },
      {
        sourceValue: value,
        status: 'failed',
        mode: 'auto',
      }
    );
  }

  return withResolvedMediaDimensions(node, dimensions, {
    sourceValue: value,
    status: 'valid',
    mode: 'auto',
  });
};

const getNodeMediaSourceValue = (node: Node, nodes: Node[], edges: Edge[]) => {
  const ownValue = getMediaNodeValue(node);
  const policy = getMediaDimensionPolicy(node.type);
  if (!policy) return '';

  const nodeType = node.type || '';
  if (ownValue && !SOURCE_FIRST_MEDIA_NODE_TYPES.has(nodeType)) return ownValue;
  if (!SOURCE_FIRST_MEDIA_NODE_TYPES.has(nodeType) && !SOURCE_FALLBACK_MEDIA_NODE_TYPES.has(nodeType)) return '';

  const inputEdge = edges.find(edge => edge.target === node.id && edge.sourceHandle?.startsWith(`${policy.mediaType}_`));
  const sourceNode = inputEdge ? nodes.find(item => item.id === inputEdge.source) : null;
  const sourceValue = sourceNode ? getMediaNodeValue(sourceNode) : '';
  if (sourceValue) return sourceValue;

  return SOURCE_ONLY_MEDIA_NODE_TYPES.has(nodeType) ? '' : ownValue;
};

const hasTrustedMediaDimensionsForSource = (node: Node, sourceValue: string, allowLegacy = true) => {
  if (!sourceValue || !getCompleteMediaNodeDimensions(node)) return false;
  const meta = getMediaDimensionMeta(node);
  if (!meta) return allowLegacy;
  return meta.status === 'valid' && meta.sourceValue === sourceValue;
};

const markNodeMediaDimensionsPending = (node: Node, sourceValue = getMediaNodeValue(node)): Node => {
  const currentMeta = getMediaDimensionMeta(node);
  return withMediaDimensionMeta(node, {
    sourceValue,
    status: 'pending',
    mode: currentMeta?.mode ?? 'auto',
  });
};

export const createFlowMediaDimensionCoordinator = ({ getState, setNodes, partialUpdate, isContextActive }: FlowMediaDimensionDependencies) => {
  const revisions = new Map<string, number>();
  const persistences = new Map<string, Promise<unknown>>();
  let nextRevision = 0;
  const preparations = new Set<Promise<unknown>>();

  const invalidate = (ids: string[]) => {
    ids.forEach(id => revisions.delete(id));
  };

  const invalidateAll = () => {
    revisions.clear();
  };

  const clearPersistenceQueue = () => {
    persistences.clear();
  };

  const reset = () => {
    invalidateAll();
    clearPersistenceQueue();
  };

  const queuePersistence = <T>(ids: string[], persist: () => Promise<T>, options?: { strictReceipt?: true }) => {
    const uniqueIds = [...new Set(ids)];
    const barriers = uniqueIds.map(id => persistences.get(id)).filter((persistence): persistence is Promise<unknown> => Boolean(persistence));
    const operation = Promise.all(barriers).then(persist);
    const queuedPersistence = operation.catch(() => undefined);

    uniqueIds.forEach(id => persistences.set(id, queuedPersistence));
    void queuedPersistence.finally(() => {
      uniqueIds.forEach(id => {
        if (persistences.get(id) === queuedPersistence) {
          persistences.delete(id);
        }
      });
    });
    return options?.strictReceipt ? operation : queuedPersistence;
  };

  const waitPersistenceIdle = async () => {
    while (persistences.size > 0 || preparations.size > 0) await Promise.allSettled([...persistences.values(), ...preparations]);
  };

  const persistResolvedNode = (canvasId: string, node: Node) => {
    return partialUpdate(canvasId, {
      updateNodes: [
        {
          id: node.id,
          width: node.width,
          height: node.height,
          measured: node.measured,
          data: {
            value: node.data.value,
            product: node.data.product,
            dimensionMeta: node.data.dimensionMeta,
          },
        },
      ],
    });
  };

  const scheduleResolution = (request: MediaDimensionResolutionRequest) => {
    const initialState = getState();
    const node = initialState.nodes.find(item => item.id === request.id);
    if (!node) return;

    const policy = getMediaDimensionPolicy(node.type);
    const value = request.sourceValue || getNodeMediaSourceValue(node, initialState.nodes, initialState.edges);
    if (!policy || !value) return;

    const meta = getMediaDimensionMeta(node);
    const context: MediaDimensionResolutionContext = request.context ?? {
      currentDimensions: getCompleteMediaNodeDimensions(node),
      currentDimensionsTrusted: hasTrustedMediaDimensionsForSource(node, value, false),
      mode: meta?.mode ?? 'auto',
      persist: !getState().readOnly,
    };
    const canvasId = initialState.canvasId;
    const revision = ++nextRevision;
    revisions.set(request.id, revision);

    void loadIntrinsicMediaDimensions(policy.mediaType, value).then(intrinsic => {
      if (revisions.get(request.id) !== revision || (isContextActive && !isContextActive())) return;

      const currentState = getState();
      const currentNode = currentState.nodes.find(item => item.id === request.id);
      const currentSourceValue = currentNode ? getNodeMediaSourceValue(currentNode, currentState.nodes, currentState.edges) : '';
      if (!currentNode || currentSourceValue !== value) return;

      const dimensions = intrinsic ? resolveMediaNodeDimensions(intrinsic, policy, context.currentDimensions, context.currentDimensionsTrusted) : null;
      const resolvedNode = dimensions
        ? withResolvedMediaDimensions(currentNode, dimensions, {
            sourceValue: value,
            status: 'valid',
            mode: context.mode,
          })
        : withMediaDimensionMeta(currentNode, {
            sourceValue: value,
            status: 'failed',
            mode: 'auto',
          });

      setNodes(getState().nodes.map(item => (item.id === request.id ? resolvedNode : item)));
      if (context.persist) {
        void queuePersistence([request.id], () => {
          if (revisions.get(request.id) !== revision) return Promise.resolve();
          const latestState = getState();
          const latestNode = latestState.nodes.find(item => item.id === request.id);
          const latestSourceValue = latestNode ? getNodeMediaSourceValue(latestNode, latestState.nodes, latestState.edges) : '';
          if (!latestNode || latestSourceValue !== value) return Promise.resolve();
          return persistResolvedNode(canvasId, latestNode);
        });
      }
    });
  };

  const scheduleRequests = (requests: MediaDimensionResolutionRequest[]) => {
    requests.forEach(scheduleResolution);
  };

  const prepareNodesForCreate = (nodes: Node[]) => {
    const canvasId = getState().canvasId;
    const task = Promise.all(nodes.map(prepareMediaNodeForCreate)).then(result => {
      if (getState().canvasId !== canvasId || (isContextActive && !isContextActive())) throw Object.assign(new Error('目标画布上下文已失效'), { code: 'FRAME_GONE', requestPhase: 'not_sent' });
      return result;
    });
    preparations.add(task);
    task.then(() => preparations.delete(task), () => preparations.delete(task));
    return task;
  };

  const prepareNodesForInitialization = (nodes: Node[], edges: Edge[], persist = true): PreparedMediaNodes => {
    const pendingRequests: MediaDimensionResolutionRequest[] = [];
    const pendingNodes: Node[] = [];

    const preparedNodes = nodes.map(node => {
      const policy = getMediaDimensionPolicy(node.type);
      const sourceValue = getNodeMediaSourceValue(node, nodes, edges);
      if (!policy || !sourceValue) return node;

      const meta = getMediaDimensionMeta(node);
      const dimensions = getCompleteMediaNodeDimensions(node);
      if (dimensions && !meta) {
        // 在首次 render 前标记历史合法尺寸，避免后续把 React Flow 的占位 measured 误判成 legacy 数据。
        return withMediaDimensionMeta(node, {
          sourceValue,
          status: 'valid',
          mode: 'auto',
        });
      }
      if (dimensions && meta?.status === 'valid' && meta.sourceValue === sourceValue) return node;

      pendingRequests.push({
        id: node.id, sourceValue,
        ...(persist ? {} : { context: { currentDimensions: dimensions, currentDimensionsTrusted: false, mode: meta?.mode ?? 'auto', persist: false } }),
      });
      const pendingNode = withMediaDimensionMeta(node, {
        sourceValue,
        status: 'pending',
        mode: meta?.mode ?? 'auto',
      });
      pendingNodes.push(pendingNode);
      return pendingNode;
    });

    return {
      nodes: preparedNodes,
      pendingRequests,
      pendingNodes,
    };
  };

  const getManagedNodeIds = (nodes: Node[]) => nodes.filter(node => getMediaDimensionPolicy(node.type)).map(node => node.id);

  const persistPendingNodes = (canvasId: string, readOnly: boolean, prepared: PreparedMediaNodes) => {
    if (readOnly || !prepared.pendingNodes.length) return;

    void queuePersistence(
      prepared.pendingRequests.map(request => request.id),
      () =>
        partialUpdate(canvasId, {
          updateNodes: prepared.pendingNodes.map(node => ({
            id: node.id,
            data: {
              dimensionMeta: node.data.dimensionMeta,
            },
          })),
        })
    );
  };

  const reconcilePolledNodes = (previousNodes: Node[], nextNodes: Node[], edges: Edge[], canvasId: string, readOnly: boolean) => {
    const resolutionRequests: MediaDimensionResolutionRequest[] = [];
    const dimensionStateNodes: Node[] = [];
    const preparedNodes = nextNodes.map(node => {
      const previousNode = previousNodes.find(item => item.id === node.id);
      const policy = getMediaDimensionPolicy(node.type);
      if (!previousNode || !policy) return node;

      const previousSourceValue = getNodeMediaSourceValue(previousNode, previousNodes, edges);
      const sourceValue = getNodeMediaSourceValue(node, nextNodes, edges);
      if (previousSourceValue === sourceValue) return node;

      invalidate([node.id]);
      if (!sourceValue) {
        const emptyNode = {
          ...node,
          data: {
            ...node.data,
            dimensionMeta: null,
          },
        };
        dimensionStateNodes.push(emptyNode);
        return emptyNode;
      }

      const previousMeta = getMediaDimensionMeta(previousNode);
      const previousDimensionsTrusted = hasTrustedMediaDimensionsForSource(previousNode, previousSourceValue, true);
      const mode = previousDimensionsTrusted ? (previousMeta?.mode ?? 'auto') : 'auto';
      const pendingNode = withMediaDimensionMeta(node, {
        sourceValue,
        status: 'pending',
        mode,
      });
      dimensionStateNodes.push(pendingNode);
      resolutionRequests.push({
        id: node.id,
        sourceValue,
        context: {
          currentDimensions: getCompleteMediaNodeDimensions(previousNode),
          currentDimensionsTrusted: previousDimensionsTrusted,
          mode,
          persist: !readOnly,
        },
      });
      return pendingNode;
    });

    setNodes(preparedNodes);
    if (!readOnly && dimensionStateNodes.length) {
      void queuePersistence(
        dimensionStateNodes.map(node => node.id),
        () =>
          partialUpdate(canvasId, {
            updateNodes: dimensionStateNodes.map(node => ({
              id: node.id,
              data: {
                dimensionMeta: node.data.dimensionMeta,
              },
            })),
          })
      );
    }
    scheduleRequests(resolutionRequests);
  };

  const prepareNodeData = (node: Node, data: any, nodes: Node[], edges: Edge[], readOnly: boolean): PreparedMediaNodeData => {
    const previousValue = getMediaNodeValue(node);
    const nextValue = typeof data?.value === 'string' ? data.value : '';
    const valueChanged = previousValue !== nextValue;
    const policy = getMediaDimensionPolicy(node.type);
    let nextData = data;
    let resolutionRequest: MediaDimensionResolutionRequest | null = null;

    if (valueChanged && policy) {
      const nextNode = {
        ...node,
        data,
      };
      const previousSourceValue = getNodeMediaSourceValue(node, nodes, edges);
      const nextSourceValue = getNodeMediaSourceValue(nextNode, nodes, edges);
      if (previousSourceValue !== nextSourceValue) {
        invalidate([node.id]);
      }
      if (nextSourceValue && previousSourceValue !== nextSourceValue) {
        const previousMeta = getMediaDimensionMeta(node);
        const previousDimensionsTrusted = hasTrustedMediaDimensionsForSource(node, previousSourceValue, true);
        const mode = previousDimensionsTrusted ? (previousMeta?.mode ?? 'auto') : 'auto';
        nextData = {
          ...data,
          dimensionMeta: {
            sourceValue: nextSourceValue,
            status: 'pending',
            mode,
          } satisfies MediaDimensionMeta,
        };
        resolutionRequest = {
          id: node.id,
          sourceValue: nextSourceValue,
          context: {
            currentDimensions: getCompleteMediaNodeDimensions(node),
            currentDimensionsTrusted: previousDimensionsTrusted,
            mode,
            persist: !readOnly,
          },
        };
      } else if (!nextSourceValue) {
        nextData = {
          ...data,
          dimensionMeta: null,
        };
      }
    }

    return {
      data: nextData,
      valueChanged,
      shouldQueuePersistence: Boolean(policy && valueChanged),
      resolutionRequest,
    };
  };

  function persistNodeData(canvasId: string, id: string, updateContent: Pick<Node, 'id'> & Omit<Partial<Node>, 'id'>, shouldQueuePersistence: boolean): void;
  function persistNodeData(canvasId: string, id: string, updateContent: Pick<Node, 'id'> & Omit<Partial<Node>, 'id'>, shouldQueuePersistence: boolean, options: AgentWriteOptions): Promise<AgentMutationOutcome>;
  function persistNodeData(canvasId: string, id: string, updateContent: Pick<Node, 'id'> & Omit<Partial<Node>, 'id'>, shouldQueuePersistence: boolean, options?: AgentWriteOptions): void | Promise<AgentMutationOutcome> {
    const persist = () =>
      partialUpdate(canvasId, {
        updateNodes: [updateContent],
      }, options);

    if (options?.strictReceipt) return queuePersistence([id], persist, options).then(outcome => outcome as AgentMutationOutcome);

    if (shouldQueuePersistence) {
      void queuePersistence([id], persist);
    } else {
      void persist().catch(() => undefined);
    }
  }

  const updateNodeMeasured = (id: string, measured: Measured, shouldPersist: boolean) => {
    const { nodes, canvasId } = getState();
    const node = nodes.find(item => item.id === id);
    if (!node) return;

    invalidate([id]);
    const expectedSourceValue = getMediaNodeValue(node);
    const policy = getMediaDimensionPolicy(node.type);
    const currentMeta = getMediaDimensionMeta(node);
    const nextData = policy
      ? {
          ...node.data,
          dimensionMeta: expectedSourceValue
            ? ({
                sourceValue: expectedSourceValue,
                status: 'valid',
                mode: currentMeta?.mode ?? 'auto',
              } satisfies MediaDimensionMeta)
            : null,
        }
      : node.data;
    const measuredUpdate = {
      id,
      measured,
      width: measured.width,
      height: measured.height,
      ...(nextData !== node.data ? { data: nextData } : {}),
    };
    setNodes(
      nodes.map(item =>
        item.id === id
          ? {
              ...item,
              ...measuredUpdate,
            }
          : item
      )
    );
    if (!shouldPersist) return;

    const persistMeasuredNode = () => {
      if (!expectedSourceValue) {
        return partialUpdate(canvasId, {
          updateNodes: [
            {
              ...measuredUpdate,
              ...(measuredUpdate.data
                ? {
                    data: {
                      value: measuredUpdate.data.value,
                      product: measuredUpdate.data.product,
                      dimensionMeta: measuredUpdate.data.dimensionMeta,
                    },
                  }
                : {}),
            },
          ],
        });
      }

      const latestNode = getState().nodes.find(item => item.id === id);
      const latestMeta = latestNode ? getMediaDimensionMeta(latestNode) : null;
      if (!latestNode || latestMeta?.status !== 'valid' || latestMeta.sourceValue !== expectedSourceValue) return Promise.resolve();
      return partialUpdate(canvasId, {
        updateNodes: [
          {
            id,
            measured: latestNode.measured,
            width: latestNode.width,
            height: latestNode.height,
            data: {
              value: latestNode.data.value,
              product: latestNode.data.product,
              dimensionMeta: latestNode.data.dimensionMeta,
            },
          },
        ],
      });
    };
    void queuePersistence([id], persistMeasuredNode);
  };

  const ensureNodeMediaDimensions = (id: string, providedSourceValue?: string, force = false) => {
    const { nodes, edges, canvasId, readOnly } = getState();
    const node = nodes.find(item => item.id === id);
    if (!node || !getMediaDimensionPolicy(node.type)) return;

    const expectedSourceValue = getNodeMediaSourceValue(node, nodes, edges);
    const sourceValue = expectedSourceValue || providedSourceValue || '';
    const shouldIgnoreProvidedChange = Boolean(expectedSourceValue && providedSourceValue && providedSourceValue !== expectedSourceValue);
    const shouldForce = force && !shouldIgnoreProvidedChange;
    if (!sourceValue) return;

    const currentMeta = getMediaDimensionMeta(node);
    const currentDimensions = getCompleteMediaNodeDimensions(node);
    if (!shouldForce && currentDimensions && currentMeta?.status === 'valid' && currentMeta.sourceValue === sourceValue) return;
    if (currentMeta?.status === 'pending' && currentMeta.sourceValue === sourceValue && revisions.has(id)) return;

    const context: MediaDimensionResolutionContext = {
      currentDimensions,
      currentDimensionsTrusted: hasTrustedMediaDimensionsForSource(node, sourceValue, false),
      mode: currentMeta?.mode ?? 'auto',
      persist: !readOnly,
    };
    const pendingNode = markNodeMediaDimensionsPending(node, sourceValue);
    setNodes(nodes.map(item => (item.id === id ? pendingNode : item)));
    if (!readOnly) {
      void queuePersistence([id], () =>
        partialUpdate(canvasId, {
          updateNodes: [
            {
              id,
              data: {
                dimensionMeta: pendingNode.data.dimensionMeta,
              },
            },
          ],
        })
      );
    }
    scheduleResolution({ id, sourceValue, context });
  };

  const persistNodeChanges = (updateNodes: Array<any>, deleteNodeIds: string[]) => {
    const manualUpdates = updateNodes.filter(item => item.data?.dimensionMeta?.mode === 'manual');
    const manualNodeIds = manualUpdates.map(item => item.id);
    const persistenceNodeIds = [...new Set([...manualNodeIds, ...deleteNodeIds])];
    const canvasId = getState().canvasId;

    const persistChanges = () => {
      const { nodes } = getState();
      const safeUpdateNodes = updateNodes.flatMap(item => {
        if (item.data?.dimensionMeta?.mode !== 'manual') return [item];

        const currentNode = nodes.find(node => node.id === item.id);
        const currentMeta = currentNode ? getMediaDimensionMeta(currentNode) : null;
        const expectedSourceValue = item.data.dimensionMeta.sourceValue;
        if (!currentNode || currentMeta?.status !== 'valid' || currentMeta.mode !== 'manual' || currentMeta.sourceValue !== expectedSourceValue) return [];

        return [
          {
            ...item,
            measured: currentNode.measured,
            width: currentNode.width,
            height: currentNode.height,
            data: {
              dimensionMeta: currentNode.data.dimensionMeta,
            },
          },
        ];
      });
      if (!safeUpdateNodes.length && !deleteNodeIds.length) return Promise.resolve();
      return partialUpdate(canvasId, {
        updateNodes: safeUpdateNodes,
        deleteNodeIds,
      });
    };

    if (persistenceNodeIds.length) {
      void queuePersistence(persistenceNodeIds, persistChanges);
    } else {
      void persistChanges();
    }
  };

  return {
    ensureNodeMediaDimensions,
    getManagedNodeIds,
    invalidate,
    invalidateAll,
    persistNodeChanges,
    persistNodeData,
    persistPendingNodes,
    prepareNodeData,
    prepareNodesForCreate,
    prepareNodesForInitialization,
    queuePersistence,
    waitPersistenceIdle,
    hasPendingPersistence: () => persistences.size > 0 || preparations.size > 0,
    reconcilePolledNodes,
    reset,
    scheduleRequests,
    updateNodeMeasured,
  };
};
