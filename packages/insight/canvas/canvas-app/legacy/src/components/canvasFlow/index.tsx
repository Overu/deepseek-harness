import { getCanvasViewBinding } from '../../../../src/canvas-service-binding';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  Background,
  BackgroundVariant,
  SelectionMode,
  NodeToolbar,
  Position,
  PanOnScrollMode,
  useOnViewportChange,
  useStoreApi,
  type Node,
  type Edge,
  type FinalConnectionState,
  type Connection,
  type Handle,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Text from './customNode/text';
import Video from './customNode/video';
import Image from './customNode/image';
import Audio from './customNode/audio';
import Group from './customNode/group';
import PoseTool from './customNode/tool/PoseTool';
import HighDefinitionTool from './customNode/tool/HighDefinitionTool';
import ImageEditorTool from './customNode/tool/ImageEditorTool';
import ImageLayoutTool from './customNode/tool/ImageLayoutTool';
import TextRedrawTool from './customNode/tool/TextRedrawTool';
import HighDefinitionVideoTool from './customNode/tool/HighDefinitionVideoTool';
import MultiViewTool from './customNode/tool/MultiViewTool';
import ImageLipSyncTool from './customNode/tool/imageLipSync';
import PoseTransferTool from './customNode/tool/poseTransfer';
import AudioClipTool from './customNode/tool/AudioClipTool';
import VideoClipTool from './customNode/tool/VideoClipTool';
import SizeAdaptTool from './customNode/tool/SizeAdaptTool';
import ImageInpaintTool from './customNode/tool/ImageInpaintTool';
import StoryboardTool from './customNode/tool/storyboard';
import PanoramaTool from './customNode/tool/panorama';
import AnimationEdge from './customeEdge/AnimationEdge';
import ConnectionLine from './customeEdge/ConectionLine';
import DefaultLine from './customeEdge/DefaultLine';
import { useFlowStore } from '@/store/flowStore';
import { getFlowData, fetchTone, getAllRule } from '@/api/workflow';
import { loadNativeModels, loadNativeModelPermission, loadNativeToolPermission } from '../../../../src/canvas-initialization';
import { fetchSubscriptionModelMap } from '@/components/canvasFlow/utils/modelPermission';
import type { ProcessNodesMigrationInput } from '@/components/canvasFlow/utils/util';
import styles from './index.module.less';
import { toast } from 'sonner';
import SideOperations from './components/leftOperation/SideOperations';
import util from './utils/util';
import hooks from './hooks';
import toolUtil from './utils/toolUtil';
import setting from './settings/setting';
import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import Dialog from './components/common/Dialog';
import SelectionOperation from './components/canvasControl/SelectionOperation';
import HelperLines from './components/canvasControl/HelperLines';
import Header from './components/canvasControl/Header';
import DesktopCanvasHeader from '../../../../src/desktop-canvas-header';
import CanvasOperation from './components/canvasControl/CanvasOperation';
import ContextMenu from './components/canvasControl/ContextMenu';
import EmptyPlaceholder from './components/canvasControl/EmptyPlaceholder';
import FullscreenLoading from './components/canvasControl/FullscreenLoading';
import SelectionConnectHandle from './components/canvasControl/SelectionConnectHandle';
import MultiConnectionPreview from './components/canvasControl/MultiConnectionPreview';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
// import { CANVAS_ONBOARDING_TARGETS, CanvasOnboardingFloatingButton, useCanvasOnboarding } from './onboarding';
import { getMediaDimensionMeta, getMediaDimensionPolicy, getMediaNodeValue, type MediaDimensionMeta } from './utils/mediaDimensions';
import { useHelperLines } from './hooks/useHelperLines';
import { useMultiConnect } from './hooks/useMultiConnect';
import { prepareMultiConnectEdges } from './utils/multiConnect';
import withReadOnlyNodeGuard from './components/nodeControl/withReadOnlyNodeGuard';

const {
  createNode,
  applyEmptyMediaNodeDimensions,
  transformModelMapWithPromptLimit,
  createDragEdge,
  processNodeChanges,
  syncIntraGroupEdgeZIndex,
  validateConnection,
  stripEdgeTransientUiState,
} = util;
const { defaultWidth, defaultHeight, getCenterPosition, getNodePosition, focusOnNodes, getRelativeEdgesByNodes, measureMediaNodeSize } = toolUtil;
const { useKeyboardShortcuts, usePolling, useConfirmDialog, useDragAndDrop, useStoryboardNodeDrop } = hooks;
const { handlerColorMap } = setting;

type AddHistoryItem = {
  type: string;
  value: string;
  index?: number;
  width?: number;
  height?: number;
  measured?: {
    width: number;
    height: number;
  };
};

interface CanavsData {
  data: string;
  taskStatus: string;
  name: string;
  thumbnailUrl: string;
  temp?: boolean;
  templateId?: number;
}
export type SideOperationsPosition = 'left' | 'right';

interface CanavsFlowProps {
  canvasData?: CanavsData;
  readOnly?: boolean;
  hideHeader?: boolean;
  embeddedPreview?: boolean;
  sideOperationsPosition?: SideOperationsPosition;
  sidePosition?: SideOperationsPosition;
  onReferenceSelection?: () => void;
}

export type CanvasFlowProps = CanavsFlowProps;

export const resolveSideOperationsPosition = (
  propPosition?: SideOperationsPosition,
  aliasPosition?: SideOperationsPosition
): SideOperationsPosition => {
  if (propPosition === 'left' || propPosition === 'right') return propPosition;
  if (aliasPosition === 'left' || aliasPosition === 'right') return aliasPosition;
  if (typeof window !== 'undefined') {
    try {
      const urlParam =
        new URLSearchParams(window.location.search).get('sideOperationsPosition') ||
        new URLSearchParams(window.location.search).get('sidePosition');
      if (urlParam === 'left' || urlParam === 'right') return urlParam;
      const stored =
        window.localStorage?.getItem('canvas_side_operations_position') ||
        window.localStorage?.getItem('side_operations_position');
      if (stored === 'left' || stored === 'right') return stored;
    } catch {
      // ignore
    }
  }
  return setting.sideOperationsPosition || 'right';
};

const CANVAS_NODE_TYPES = {
  video: withReadOnlyNodeGuard(Video),
  text: withReadOnlyNodeGuard(Text),
  image: withReadOnlyNodeGuard(Image),
  audio: withReadOnlyNodeGuard(Audio),
  group: withReadOnlyNodeGuard(Group),
  poseTool: withReadOnlyNodeGuard(PoseTool),
  highDefinitionTool: withReadOnlyNodeGuard(HighDefinitionTool),
  imageEditorTool: withReadOnlyNodeGuard(ImageEditorTool),
  imageLayoutTool: withReadOnlyNodeGuard(ImageLayoutTool),
  textRedrawTool: withReadOnlyNodeGuard(TextRedrawTool),
  highDefinitionVideoTool: withReadOnlyNodeGuard(HighDefinitionVideoTool),
  multiViewTool: withReadOnlyNodeGuard(MultiViewTool),
  imageLipSyncTool: withReadOnlyNodeGuard(ImageLipSyncTool),
  poseTransVideoTool: withReadOnlyNodeGuard(PoseTransferTool),
  audioClipTool: withReadOnlyNodeGuard(AudioClipTool),
  videoClipTool: withReadOnlyNodeGuard(VideoClipTool),
  sizeAdaptTool: withReadOnlyNodeGuard(SizeAdaptTool),
  imageInpaintTool: withReadOnlyNodeGuard(ImageInpaintTool),
  storyboardTool: withReadOnlyNodeGuard(StoryboardTool),
  panoramaTool: withReadOnlyNodeGuard(PanoramaTool),
};

// 控制台启用：sessionStorage.setItem('canvas-node-debug', '1')
const CANVAS_NODE_DEBUG_KEY = 'canvas-node-debug';

const CANVAS_EDGE_TYPES = {
  default: DefaultLine,
  animated: AnimationEdge,
};

const CanvasFlow = ({
  canvasData,
  readOnly,
  hideHeader = false,
  embeddedPreview = false,
  sideOperationsPosition,
  sidePosition,
  onReferenceSelection,
}: CanavsFlowProps) => {
  const resolvedSideOperationsPosition = resolveSideOperationsPosition(sideOperationsPosition, sidePosition);
  const nodes = useFlowStore(state => state.nodes);
  const edges = useFlowStore(state => state.edges);
  const focusNodes = useFlowStore(state => state.focusNodes);
  const modelsMap = useFlowStore(state => state.modelsMap);
  const status = useFlowStore(state => state.status);
  const storyboardDropPreview = useFlowStore(state => state.storyboardDropPreview);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);
  const versionConflict = useFlowStore(state => state.versionConflict);
  const navigator = useNavigate();
  const location = useLocation();
  const { authStatus } = useAuth();
  const {
    setNodes,
    setEdges,
    recordSnapshot,
    connect,
    addNode,
    dragAddNode,
    dragAddNodes,
    groupNodes,
    setSeletion,
    setCanvasId,
    setModelsMap,
    setModelMaxPromptMap,
    setModelNodePermission,
    setToolNodePermission,
    setPointList,
    reset,
    init,
    setCustomToneList,
    setZoom,
    setReadOnly,
    invalidateMediaDimensionRequests,
    persistNodeChanges,
  } = useFlowStore(state => state.actions);
  const storeApi = useStoreApi();
  const reactFlowInstance = useRef<any>(null);
  const isConnectEndRef = useRef(false);
  const routeParams = useParams({ strict: false }) as { id: string };
  const [name, setName] = useState('');
  const [temp, setTemp] = useState(false); // 是否缓存画布
  const [thumbnailUrl, setThumbnailUrl] = useState(''); // 画布封面图
  const [templateId, setTemplateId] = useState<number | string>(0);
  const [shouldConfirmBeforeUnload, setShouldConfirmBeforeUnload] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    show: boolean;
    fromHandle?: Handle | null;
    /** 多选加号松手后的批量连线源节点 */
    multiSourceNodeIds?: string[];
  }>({ x: 0, y: 0, show: false });
  // 添加loading状态
  const [loading, setLoading] = useState(true);
  const [selectedMap, setSelectedMap] = useState<{
    nodes: Node[];
    edges: Edge[];
    allNodes: Node[];
  } | null>();
  const { helperLines, helperLinesHighlighted, snapPulse, applyHelperLineSnap } = useHelperLines();
  // TODO: 因未能按期获取到必要的素材资源，暂时隐藏新手引导的功能
  // const canvasOnboarding = useCanvasOnboarding({
  //   arrowColor: '#4355f4',
  //   enabled: !hideHeader,
  //   loading,
  //   readOnly,
  // });
  const redirectToLoginForReadOnly = useCallback(() => {
    if (!readOnly || authStatus.status === 'logged_in') {
      return false;
    }

    const searchStr = location.searchStr || '';
    sessionStorage.setItem('redirectPath', location.pathname + searchStr);
    navigator({ to: '/login' });
    return true;
  }, [readOnly, authStatus.status, location.pathname, location.searchStr, navigator]);
  const flowEdges = useMemo(() => {
    let displayEdges = edges;
    if (selectedMap?.nodes?.length === 1) {
      const relativeEdgeIds = new Set(getRelativeEdgesByNodes(selectedMap.nodes, edges).map(item => item.id));
      displayEdges = edges.map(item => (relativeEdgeIds.has(item.id) ? { ...item, style: { ...item.style, stroke: '#fff' } } : item));
    }
    return syncIntraGroupEdgeZIndex(displayEdges, nodes);
  }, [selectedMap, edges, nodes]);

  const syncViewportZoom = useCallback(
    (viewport: Viewport) => {
      setZoom(viewport.zoom);
    },
    [setZoom]
  );

  useOnViewportChange({
    onChange: syncViewportZoom,
    onEnd: syncViewportZoom,
  });

  // 实现打组功能：从 store 当前 nodes 按选中 id 解析节点再打组，避免批量添加后立即打组时
  // selectedMap 中的节点尚未包含 measured 尺寸，导致组宽高计算错误（组变得很窄）
  const handleGroup = () => {
    const selected = selectedMap?.nodes;
    if (!selected || selected.length < 2) return;
    const selectedIds = selected.map((n: Node) => n.id);
    const resolvedNodes = nodes.filter((n: Node) => selectedIds.includes(n.id));
    if (resolvedNodes.length < 2) return;
    if (resolvedNodes.some((n: Node) => n.parentId)) {
      openConfirmDialog('节点已经组合，是否取消原组合？', '确认后原组合将取消并创建新组合，请确认是否组合', async () => {
        groupNodes(resolvedNodes);
        closeConfirmDialog();
        setSelectedMap(null);
      });
    } else {
      groupNodes(resolvedNodes);
      setSelectedMap(null);
    }
  };

  usePolling(status, routeParams.id);
  const { confirmDialog, openConfirmDialog, closeConfirmDialog } = useConfirmDialog();
  const {
    isCtrlPressed,
    confirmDialog: deleteConfirmDialog,
    closeConfirmDialog: closeDeleteConfirmDialog,
  } = useKeyboardShortcuts(reactFlowInstance, selectedMap, modelsMap, handleGroup, readOnly, redirectToLoginForReadOnly);
  const { handleDragOver, handleDragEnter, handleDragLeave, handleDrop } = useDragAndDrop(modelsMap, reactFlowInstance, readOnly, redirectToLoginForReadOnly);

  const selectedNodeIds = useMemo(() => {
    if (selectedMap) {
      return selectedMap.nodes.map(item => item.id);
    }
  }, [selectedMap]);

  const onInit = (rf: any) => {
    reactFlowInstance.current = rf;
  };

  useEffect(() => {
    if (!shouldConfirmBeforeUnload) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [shouldConfirmBeforeUnload]);

  // Owned views consume the Client's native initialization and never reset its Store.
  const ownedBinding = !readOnly && !embeddedPreview ? getCanvasViewBinding() : undefined;
  useEffect(() => {
    if (!ownedBinding) return;
    const syncMetadata = () => {
      const metadata = ownedBinding.getCanvasMetadata();
      setName(metadata.name); setTemp(metadata.temp); setThumbnailUrl(metadata.thumbnailUrl); setTemplateId(metadata.templateId);
      setShouldConfirmBeforeUnload(metadata.temp); setLoading(ownedBinding.getReadiness().phase === 'loading');
    };
    syncMetadata();
    const stages = ownedBinding.getInitialization();
    if (stages.models.status === 'failed') toast.error('获取模型参数失败');
    if (stages.graph.replacedSubscriptionModel) toast.success('检测到画布中使用了您未订阅的模型，已自动帮您替换到相似效果的模型');
    const unsubscribe = ownedBinding.subscribeReadiness(syncMetadata);
    void ownedBinding.loadUiData().then(() => {
      if (ownedBinding.getInitialization().prices.status === 'failed') toast.error('获取价格表失败');
    }).catch(error => console.error('Canvas auxiliary data failed:', error));
    return unsubscribe;
  }, [ownedBinding]);

  // 获取工作流信息
  useEffect(() => {
    if (ownedBinding) return;
    setCanvasId(embeddedPreview ? '' : routeParams.id);
    const getCanavasData = async () => {
      const params = {
        id: routeParams.id,
      };
      const res: any = await getFlowData(params);
      const data = res.data;
      if (data === null) {
        navigator({ to: '/', replace: true });
        return false;
      }
      setName(data.name || '');
      setTemp(data.temp || false);
      setThumbnailUrl(data.thumbnailUrl || '');
      setTemplateId(data.templateId || 0);
      return data;
    };
    const getToneList = async () => {
      const res: any = await fetchTone();
      if (res.code === 'SUCCESS') {
        setCustomToneList(
          res.data.map((item: any) => {
            return {
              value: item.voiceId,
              label: item.name,
            };
          })
        );
      }
    };
    const getModelMap = async () => {
      try {
        const { modelsMap, modelMaxPromptMap } = await loadNativeModels();
        setModelsMap(modelsMap);
        setModelMaxPromptMap(modelMaxPromptMap);
      } catch {
        toast.error('获取模型参数失败');
      }
    };

    const getAllPoint = async () => {
      try {
        const res: any = await getAllRule();
        if (res.code === 'SUCCESS') {
          setPointList(res.data);
        } else {
          toast.error('获取价格表失败');
        }
      } catch {
        toast.error('获取价格表失败');
      }
    };

    const getModelPermission = async () => {
      try {
        const permission = await loadNativeModelPermission();
        if (permission) setModelNodePermission(permission);
      } catch (e) {
        console.error('listModelNodeSetting failed:', e);
      }
    };

    const getToolPermission = async () => {
      try {
        // data 为空数组时白名单为空，全部工具不可用
        setToolNodePermission(await loadNativeToolPermission());
      } catch (e) {
        console.error('listToolNodeSetting failed:', e);
      }
    };

    let cancelled = false;
    const deferredCleanups: Array<() => void> = [];
    const scheduleAfterCanvasPaint = (callback: () => void) => {
      let firstFrameId = 0;
      let secondFrameId = 0;
      let idleId: number | null = null;
      let timeoutId: number | null = null;

      const run = () => {
        if (cancelled) return;
        callback();
      };

      firstFrameId = window.requestAnimationFrame(() => {
        secondFrameId = window.requestAnimationFrame(() => {
          if (cancelled) return;
          if (typeof window.requestIdleCallback === 'function') {
            idleId = window.requestIdleCallback(run, { timeout: 2000 });
          } else {
            timeoutId = window.setTimeout(run, 300);
          }
        });
      });

      deferredCleanups.push(() => {
        window.cancelAnimationFrame(firstFrameId);
        window.cancelAnimationFrame(secondFrameId);
        if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleId);
        }
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      });
    };

    const initializeAll = async () => {
      setLoading(true);
      if (readOnly) {
        try {
          if (canvasData) {
            setName(canvasData.name || '');
            setTemp(true);
            setThumbnailUrl(canvasData.thumbnailUrl || '');
            setReadOnly(true);
            init(canvasData);
            await Promise.all([getModelMap(), getAllPoint()]);
            void getToneList();
            if (embeddedPreview) {
              const initializedState = useFlowStore.getState();
              setNodes(initializedState.nodes.map(node => (node.selected ? { ...node, selected: false } : node)));
              setEdges(initializedState.edges.map(edge => (edge.selected ? { ...edge, selected: false } : edge)));
            }
          }
        } catch (error) {
          console.error('Failed to load read-only canvas:', error);
        } finally {
          if (!cancelled) setLoading(false);
        }
      } else {
        try {
          const flowRow = await getCanavasData();
          if (cancelled) return;
          setShouldConfirmBeforeUnload(flowRow.temp === true);
          await Promise.all([getModelMap(), getModelPermission(), getToolPermission()]);
          let fallbackMap: Record<string, string> = {};
          try {
            fallbackMap = await fetchSubscriptionModelMap();
          } catch {
            fallbackMap = {};
          }
          if (cancelled) return;
          // await 后需读 store 当前快照；此处 hook 闭包可能尚未随 setState 更新
          const migration: ProcessNodesMigrationInput = {
            modelNodePermission: useFlowStore.getState().modelNodePermission,
            subscriptionFallbackMap: fallbackMap,
          };
          const replaced = init(flowRow, migration);
          if (replaced) {
            toast.success('检测到画布中使用了您未订阅的模型，已自动帮您替换到相似效果的模型');
          }
          scheduleAfterCanvasPaint(() => {
            void Promise.all([getToneList(), getAllPoint()]);
          });
        } catch (error) {
          console.error('Failed to load data:', error);
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
    };

    initializeAll();
    return () => {
      cancelled = true;
      deferredCleanups.forEach(cleanup => cleanup());
      reset();
    };
  }, []);

  useEffect(() => {
    if (focusNodes && reactFlowInstance.current) {
      focusOnNodes(reactFlowInstance, focusNodes);
    }
  }, [focusNodes]);

  // 监听强制关闭菜单的全局信号
  useEffect(() => {
    const handleForceHide = () => setContextMenu({ x: 0, y: 0, show: false });
    window.addEventListener('canvas:hide-context-menu', handleForceHide);
    return () => window.removeEventListener('canvas:hide-context-menu', handleForceHide);
  }, []);

  // 节点列表中新增节点（含多选加号松手后的全量菜单批量连入）
  const handleAddContent = useCallback(
    (type: string, contextMenu?: any) => {
      if (redirectToLoginForReadOnly()) return;
      if (!reactFlowInstance.current) return;
      storeApi.setState({ nodesSelectionActive: false });
      setContextMenu({ x: 0, y: 0, show: false });

      const canvasPosition = getNodePosition(reactFlowInstance, contextMenu);

      const basic = {
        position: canvasPosition,
        type,
      };

      const newNode = applyEmptyMediaNodeDimensions(createNode(modelsMap, basic, modelNodePermission));
      const multiSourceNodeIds: string[] | undefined = contextMenu?.multiSourceNodeIds;
      if (multiSourceNodeIds?.length) {
        const sourceNodes = nodes.filter(n => multiSourceNodeIds.includes(n.id));
        const { edges: prepared, failed } = prepareMultiConnectEdges(sourceNodes, newNode.id, [...nodes, newNode], edges, null);
        // 菜单新建连入：先清框选残留的边选中态，再批量写入（dragAddNodes 会取消节点选中）
        setEdges(edges.map(stripEdgeTransientUiState));
        setSeletion(false);
        setSelectedMap(null);
        dragAddNodes([newNode], prepared);
        if (failed.length > 0) {
          toast.warning(prepared.length === 0 ? `${failed.length} 个节点无法连入该目标` : `${failed.length} 个节点无法连入该目标，其余已连入`);
        }
        return;
      }
      if (contextMenu && contextMenu.fromHandle) {
        const newEdge = createDragEdge(contextMenu.fromHandle, newNode.id);
        dragAddNode(newNode, newEdge);
      } else {
        addNode([newNode]);
      }
    },
    [reactFlowInstance, modelsMap, modelNodePermission, redirectToLoginForReadOnly, nodes, edges, dragAddNode, dragAddNodes, addNode, storeApi, setEdges, setSeletion]
  );

  const handleMultiConnectMenu = useCallback((payload: { x: number; y: number; sourceNodeIds: string[] }) => {
    setContextMenu({
      x: payload.x,
      y: payload.y,
      show: true,
      multiSourceNodeIds: payload.sourceNodeIds,
    });
    isConnectEndRef.current = true;
    setTimeout(() => {
      isConnectEndRef.current = false;
    }, 200);
  }, []);

  const clearMultiConnectSelection = useCallback(() => {
    setSelectedMap(null);
    setSeletion(false);
  }, [setSeletion]);

  const { multiConnectActive, multiConnectAnchors, multiConnectToX, multiConnectToY, startMultiConnect } = useMultiConnect(handleMultiConnectMenu, clearMultiConnectSelection);

  /** 将资产加入画布，支持单个或多个；多个时按 450px 横向间距排列 */
  const handleAddHistory = useCallback(
    async (items: AddHistoryItem[]) => {
      if (redirectToLoginForReadOnly()) return;
      if (!reactFlowInstance.current || !items.length) return;
      storeApi.setState({ nodesSelectionActive: false });
      const canvasPosition = getCenterPosition(reactFlowInstance.current, true);
      const NODE_X_OFFSET = defaultWidth + 50;
      const NODE_Y_OFFSET = defaultHeight + 50;

      let prevBatchIndex: number | undefined;
      let indexInBatch = 0;
      const positionedItems = items.map(item => {
        const batchIndex = item.index ?? 0;
        if (prevBatchIndex !== undefined && batchIndex > prevBatchIndex) {
          indexInBatch = 0;
        }
        prevBatchIndex = batchIndex;
        const position = {
          x: canvasPosition.x + NODE_X_OFFSET * indexInBatch,
          y: canvasPosition.y + NODE_Y_OFFSET * batchIndex,
        };
        indexInBatch += 1;
        return { item, position };
      });

      const newNodes: Node[] = [];
      for (const { item, position } of positionedItems) {
        const providedMeasured = item.measured || (item.width && item.height ? { width: item.width, height: item.height } : null);
        const measured = providedMeasured
          ? { width: providedMeasured.width, height: providedMeasured.height, measured: providedMeasured }
          : await measureMediaNodeSize(item.type, item.value);
        const basic = {
          position,
          type: item.type,
          value: item.value,
          ...(measured || {}),
        };
        newNodes.push(createNode(modelsMap, basic, modelNodePermission));
      }
      addNode(newNodes);
    },
    [reactFlowInstance, modelsMap, modelNodePermission, redirectToLoginForReadOnly]
  );

  // 监听节点变化
  const onNodesChange = useCallback(
    (changes: any) => {
      // 单节点拖拽：对齐吸附 + 辅助线（多选拖动跳过）
      applyHelperLineSnap(changes, nodes);

      const changedNodes = applyNodeChanges(changes, nodes);
      const { updateNodes: rawUpdateNodes, deleteNodeIds, positionNodes, manualResizeNodeIds } = processNodeChanges(changes);
      const manualResizeNodeIdSet = new Set<string>(manualResizeNodeIds);
      const nextNodes = changedNodes.map(node => {
        const sourceValue = getMediaDimensionMeta(node)?.sourceValue || getMediaNodeValue(node) || '';
        if (!manualResizeNodeIdSet.has(node.id) || !sourceValue || !getMediaDimensionPolicy(node.type)) return node;

        return {
          ...node,
          data: {
            ...node.data,
            dimensionMeta: {
              sourceValue,
              status: 'valid',
              mode: 'manual',
            } satisfies MediaDimensionMeta,
          },
        };
      });
      const updateNodes = rawUpdateNodes.map(item => {
        if (!manualResizeNodeIdSet.has(item.id)) return item;
        const node = nextNodes.find(currentNode => currentNode.id === item.id);
        return node
          ? {
              ...item,
              data: {
                dimensionMeta: node.data.dimensionMeta,
              },
            }
          : item;
      });
      setNodes(nextNodes);
      invalidateMediaDimensionRequests([...manualResizeNodeIds, ...deleteNodeIds]);
      // 更新选中节点的位置
      if (positionNodes) {
        selectedMap?.nodes.forEach(node => {
          positionNodes.forEach(item => {
            if (item.id == node.id) {
              node.position = item.position;
            }
          });
        });
      }
      if (updateNodes.length > 0 || deleteNodeIds.length > 0) {
        persistNodeChanges(updateNodes, deleteNodeIds);
        recordSnapshot();
      }
    },
    [nodes, embeddedPreview, redirectToLoginForReadOnly, setNodes, invalidateMediaDimensionRequests, persistNodeChanges, recordSnapshot, selectedMap, applyHelperLineSnap]
  );

  // 监听连线变化
  const onEdgesChange = useCallback(
    (changes: any) => {
      if (embeddedPreview || readOnly) return;
      if (redirectToLoginForReadOnly()) return;
      const newEdges = applyEdgeChanges(changes, edges);
      setEdges(newEdges);
    },
    [edges, embeddedPreview, redirectToLoginForReadOnly, readOnly]
  );

  // 监听连接操作
  const onConnect = useCallback(
    (params: any) => {
      if (embeddedPreview) return;
      if (redirectToLoginForReadOnly()) return;
      connect(params);
    },
    [edges, embeddedPreview, redirectToLoginForReadOnly]
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      return validateConnection(connection, nodes);
    },
    [nodes]
  );

  const {
    onNodeDragStart: handleStoryboardNodeDragStart,
    onNodeDrag: handleStoryboardNodeDrag,
    onNodeDragStop: handleStoryboardNodeDragStop,
  } = useStoryboardNodeDrop(redirectToLoginForReadOnly);

  // 监听连接结束事件
  const onConnectEnd = useCallback(
    (event: any, connectionState: FinalConnectionState) => {
      if (embeddedPreview) return;
      if (redirectToLoginForReadOnly()) return;
      // 如果没有连接到节点，则显示上下文菜单
      if (!connectionState.isValid) {
        // 工具节点拖出未连接时不显示右键菜单
        if (connectionState.fromNode?.type?.includes('Tool')) {
          return;
        }
        // 获取鼠标位置
        const { clientX, clientY } = event;
        setContextMenu({
          fromHandle: connectionState.fromHandle,
          x: clientX,
          y: clientY,
          show: true,
        });
        isConnectEndRef.current = true;
        setTimeout(() => {
          isConnectEndRef.current = false;
        }, 200);
      }
    },
    [embeddedPreview, redirectToLoginForReadOnly]
  );

  // 监听选中变化
  const handleSelectionChange = useCallback(
    (params: any) => {
      if (readOnly) return;
      // 打印节点日志用于测试
      if (import.meta.env.MODE !== 'production') {
        console.log('select', params.nodes);
      }
      if (sessionStorage.getItem(CANVAS_NODE_DEBUG_KEY) === '1' && params.nodes.length === 1) {
        const node = params.nodes[0];
        const label = `${node.type ?? 'unknown'} · ${node.data.title}`;
        const color = handlerColorMap[`${node.type}_source` as keyof typeof handlerColorMap];
        if (color) {
          console.info(`%c${label}`, `background:${color};color:#fff;padding:2px 6px;border-radius:4px;font-weight:600`, node);
        } else {
          console.info(label, node);
        }
      }
      // 过滤掉type为'group'的节点，只保留非group类型的节点用于多选
      const nonGroupNodes = params.nodes.filter((node: Node) => node.type !== 'group');

      if (nonGroupNodes.length > 1) {
        setSeletion(true);
      } else {
        setSeletion(false);
      }
      setSelectedMap({
        ...params,
        nodes: nonGroupNodes,
        allNodes: params.nodes, // 用于单选删除组节点操作
      });
    },
    [readOnly]
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (readOnly) return;
      if (redirectToLoginForReadOnly()) return;
      const el = event.target as HTMLElement;
      // 仅允许在画布空白 pane 上触发；节点内部/弹层(Portal)等双击不触发
      if (!el.closest('.react-flow__pane')) return;
      if (el.closest('.react-flow__node, .react-flow__panel, .react-flow__minimap')) return;
      setContextMenu({ x: event.clientX, y: event.clientY, show: true });
    },
    [readOnly, redirectToLoginForReadOnly]
  );

  const onSelectionEnd = () => {
    setNodes(
      nodes.map((item: Node) => {
        if (item.type == 'group') {
          return {
            ...item,
            selected: false,
          };
        } else {
          return item;
        }
      })
    );
    onReferenceSelection?.();
  };

  // 点击其他地方隐藏菜单
  const handleClickOutside = useCallback(() => {
    if (isConnectEndRef.current) {
      isConnectEndRef.current = false;
      return;
    }
    setContextMenu({ x: 0, y: 0, show: false });
  }, [isConnectEndRef]);

  return (
    <div
      className={`${styles.canvasFlow}${storyboardDropPreview ? ` ${styles.storyboardNodeDropActive}` : ''}${snapPulse ? ` ${styles.helperLineSnapPulse}` : ''}`}
      onClick={handleClickOutside}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* TODO: 因未能按期获取到必要的素材资源，暂时隐藏新手引导的功能 */}
      {/* <div data-onboarding-target={CANVAS_ONBOARDING_TARGETS.center} className='absolute top-0 left-0 w-full h-full flex items-center justify-center'></div> */}
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={CANVAS_NODE_TYPES}
        edgeTypes={CANVAS_EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStart={handleStoryboardNodeDragStart}
        onNodeDrag={handleStoryboardNodeDrag}
        onNodeDragStop={handleStoryboardNodeDragStop}
        onConnectEnd={onConnectEnd}
        onNodeClick={() => onReferenceSelection?.()}
        onSelectionEnd={onSelectionEnd}
        selectionOnDrag={!readOnly}
        // 可写：中键/右键平移；只读：左键拖拽改为平移画布（不再框选）
        panOnDrag={readOnly ? [0, 1, 2] : [1, 2]}
        panOnScroll={true}
        panOnScrollMode={PanOnScrollMode.Free}
        onSelectionChange={handleSelectionChange}
        onInit={onInit}
        onDoubleClick={handleDoubleClick}
        connectionLineComponent={ConnectionLine}
        zoomOnDoubleClick={false}
        zoomOnScroll={false}
        deleteKeyCode={[]}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        nodesFocusable
        edgesFocusable={!readOnly}
        connectionRadius={100}
        selectionMode={isCtrlPressed ? SelectionMode.Full : SelectionMode.Partial}
        fitView
        fitViewOptions={{
          padding: 0.5,
          duration: 500,
        }}
        minZoom={0.1}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      >
        <Background style={{ background: '#000000' }} color='#999999' variant={BackgroundVariant.Dots} />
        <HelperLines lines={helperLines} highlighted={helperLinesHighlighted} />
        {/* 框选操作栏 */}
        <NodeToolbar isVisible={!readOnly && selectedNodeIds && selectedNodeIds.length > 1} position={Position.Top} nodeId={selectedNodeIds} align='center'>
          <SelectionOperation selectedNodes={selectedMap?.nodes} onGroup={handleGroup} onExcuteSuccess={() => setSelectedMap(null)}></SelectionOperation>
        </NodeToolbar>
        {/* 多选右侧加号：批量拖拽连线（拖拽中隐藏，由预览层跟随鼠标） */}
        <NodeToolbar
          isVisible={!readOnly && !!selectedNodeIds && selectedNodeIds.length > 1 && !multiConnectActive}
          position={Position.Right}
          nodeId={selectedNodeIds}
          align='center'
        >
          <SelectionConnectHandle onPointerDown={e => startMultiConnect(e, selectedMap?.nodes)} />
        </NodeToolbar>
        <CanvasOperation instance={reactFlowInstance}></CanvasOperation>
      </ReactFlow>
      <MultiConnectionPreview active={multiConnectActive} anchors={multiConnectAnchors} toX={multiConnectToX} toY={multiConnectToY} />
      {!embeddedPreview && (
        <SideOperations
          position={resolvedSideOperationsPosition}
          className={`absolute top-1/2 ${resolvedSideOperationsPosition === 'left' ? 'left-4' : 'right-4'} transform -translate-y-1/2 z-[9]`}
          onAddContent={handleAddContent}
          onAddHistory={handleAddHistory}
        />
      )}
      {hideHeader
        ? <DesktopCanvasHeader id={routeParams.id} name={name} thumbnailUrl={thumbnailUrl} ready={!loading && status !== ''} />
        : <Header name={name} temp={temp} id={routeParams.id} thumbnailUrl={thumbnailUrl} templateId={templateId}></Header>}
      {versionConflict ? (
        <div className='fixed top-8 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-neutral-800 px-4 py-3 text-white shadow-2xl'>
          <div className='min-w-0 text-sm font-semibold'>当前画布内容未能同步，请刷新后继续编辑</div>
          <Button
            type='button'
            size='sm'
            variant='secondary'
            className='h-8 shrink-0 rounded-lg bg-neutral-700 px-4 text-sm font-semibold hover:bg-neutral-600'
            onClick={() => { if (ownedBinding) void ownedBinding.reloadFromUi().catch(error => toast.error(error.message)); else window.location.reload(); }}
          >
            刷新
          </Button>
        </div>
      ) : null}
      {/* 右键菜单 */}
      <ContextMenu contextMenu={contextMenu} handleAddContent={handleAddContent} />
      <Dialog confirmDialog={confirmDialog} closeConfirmDialog={closeConfirmDialog}></Dialog>
      <Dialog confirmDialog={deleteConfirmDialog} closeConfirmDialog={closeDeleteConfirmDialog}></Dialog>
      {/* 空白提示 */}
      <EmptyPlaceholder show={!contextMenu.show && !nodes.length} />
      {/* TODO: 因未能按期获取到必要的素材资源，暂时隐藏新手引导的功能 */}
      {/* {!readOnly && !hideHeader && <CanvasOnboardingFloatingButton loading={canvasOnboarding.loading} onRestart={canvasOnboarding.restart} />} */}
      {/* 全屏Loading */}
      <FullscreenLoading loading={loading} />
    </div>
  );
};

export default CanvasFlow;
