import { parseChildNodeInfoFromPollData } from '../../../../src/tool-output-info';
import { getCanvasViewBinding } from '../../../../src/canvas-service-binding';
import { createCanvasGenerationMonitor } from '../../../../src/canvas-generation-monitor';
import { defaultCanvasVersionBarrier } from '@/lib/canvasVersionBarrier';
import { createAgentEditorDebounce } from '../../../../src/agent-editor-debounce';
import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Node, type Edge } from '@xyflow/react';
import util from './utils/util';
import type { MediaInputItem, TextInputItem } from './utils/util';
import toolUtil from './utils/toolUtil';
import type { MediaNodeMeasuredSize } from './utils/toolUtil';
import { calculateWorkflowCost } from '@/api/order';
import { calculateSingleWorkflowCost } from './utils/workflowCost';
import { useFlowStore, buildSingleWorkflowPayload, type StoryboardDropPreview } from '@/store/flowStore';
import { type titleStyleData } from './components/nodeControl/NodeTitle';
import { debounce, copyToClipboard } from '@/utils';
import { resolveUploadMediaType, partitionUploadMediaFiles, validateUploadFile, UNSUPPORTED_MEDIA_FILE_TOAST, type UploadMediaType } from '@/hooks/useFileUpload';
import type { TaskInfo } from './utils/type';
import { usePointStore } from '@/store/pointStore';
import { toast } from 'sonner';
import { HEADER_ROW_HEIGHT, SERIAL_COL_WIDTH, type TableProtocol, type CellData } from './customNode/tool/storyboard/types';
import { isToolUsable } from './utils/modelPermission';
import setting from './settings/setting';
import { useHelperLines } from './hooks/useHelperLines';
import { useAutoLayoutMenu } from './hooks/useAutoLayoutMenu';

const { toolQuickConnectMap } = setting;

interface UseHoverWithDelayOptions {
  delay?: number;
}

interface Params {
  [key: string]: string;
}

interface SelectMap {
  nodes: Node[];
  edges: Edge[];
  allNodes: Node[];
}

interface ImageMapItem {
  edgeId: string;
  value: string;
}

const { createNode, applyEmptyMediaNodeDimensions, getSourceMap, createDragEdge, buildInitialToolOutputNodeData, buildMediaToolOutputNodeData } = util;
const { defaultWidth, defaultHeight, caculateSingleNodePoint, getEdgesByNodes, getSourceNodesAndEdges, shouldUseNativeTextInput, measureMediaNodeSize } = toolUtil;

/** 子节点相对工具节点的水平/垂直随机偏移（与快捷添加后续节点一致） */
const createRandomOffset = () => {
  const r = () => Math.round(Math.random() * 100 - 20);
  return { x: r(), y: r() };
};

/** 前接来源节点与工具节点之间的水平间距（defaultWidth + 50 基础上额外 +200） */
const TOOL_SOURCE_NODE_GAP_X = 250;

const MEDIA_FILE_DROP_OFFSET = 40;

const findMediaNodeAtDropPoint = (reactFlowInstance: React.RefObject<any>, clientX: number, clientY: number, mediaType: UploadMediaType): Node | null => {
  if (!reactFlowInstance.current) return null;
  const flowPos = reactFlowInstance.current.screenToFlowPosition({ x: clientX, y: clientY });
  const intersecting: Node[] = reactFlowInstance.current.getIntersectingNodes({
    x: flowPos.x,
    y: flowPos.y,
    width: 1,
    height: 1,
  });
  for (let i = intersecting.length - 1; i >= 0; i--) {
    if (intersecting[i].type === mediaType) return intersecting[i];
  }
  return null;
};

const applyTempFileToNode = (node: Node, file: File) => {
  const { updateNodeData } = useFlowStore.getState().actions;
  updateNodeData(node.id, { ...node.data, tempFile: file }, false, false);
};

export interface UseToolOutputChildNodesOptions {
  /** 工具节点 id */
  toolNodeId: string;
  /** 工具节点宽度，用于计算子节点位置 */
  nodeWidth?: number;
  /** 输出子节点类型，默认 image */
  childType?: string;
  /** 从工具节点连出的 source handle id，如 image_source */
  sourceHandleId?: string;
  /** 子节点初始 taskInfo.status */
  childInitialStatus?: 'running' | 'success';
}

export interface PrepareToolOutputChildNodesOptions {
  /** 子节点数量，默认 1 */
  count?: number;
  /** single：右侧单个；vertical：右侧纵向排列多个 */
  layout?: 'single' | 'vertical';
  /** vertical 布局时的纵向间距 */
  spacingY?: number;
  /** 相对工具节点右侧的水平间距；single 默认 defaultWidth+50 并可叠加随机偏移 */
  gapX?: number;
  /** 是否在 single 布局叠加随机偏移 */
  useRandomOffset?: boolean;
  /** 创建后自定义节点 data */
  customizeNode?: (node: Node, index: number) => void;
}

interface AttachUploadOutputNodeOptions {
  gapX?: number;
  useRandomOffset?: boolean;
  measured?: MediaNodeMeasuredSize | null;
}

/** 从轮询/任务结果中解析 childNodeInfo */
export { parseChildNodeInfoFromPollData } from '../../../../src/tool-output-info';

const getClientPoint = (e: any): { x: number; y: number } | null => {
  const ev = e?.nativeEvent ?? e;
  if (typeof ev?.clientX === 'number' && typeof ev?.clientY === 'number') return { x: ev.clientX, y: ev.clientY };
  const t = ev?.changedTouches?.[0] ?? ev?.touches?.[0];
  if (t && typeof t.clientX === 'number' && typeof t.clientY === 'number') return { x: t.clientX, y: t.clientY };
  return null;
};

// 处理确认对话框逻辑
const useConfirmDialog = () => {
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    content: '',
    onConfirm: () => {},
  });

  const openConfirmDialog = (title: string, content: string, onConfirm: () => void) => {
    setConfirmDialog({
      open: true,
      title,
      content,
      onConfirm,
    });
  };

  const closeConfirmDialog = () => {
    setConfirmDialog(prev => ({ ...prev, open: false }));
  };

  return {
    confirmDialog,
    openConfirmDialog,
    closeConfirmDialog,
  };
};

interface DeleteSelectionInput {
  nodes?: Node[];
  edges?: Edge[];
  allNodes?: Node[];
  groupId?: string;
}

type DeleteIntent =
  | { kind: 'none' }
  | { kind: 'edges'; ids: string[] }
  | { kind: 'nodes'; ids: string[]; confirmTitle?: string }
  | { kind: 'group'; id: string; confirmTitle?: string };

/** 纯决策：根据选中数据产出删除意图，不做副作用 */
const resolveDeleteSelection = (input: DeleteSelectionInput, groupChildNodes: Node[] = []): DeleteIntent => {
  const hasRunning = (nodes: Node[]) => nodes.some(item => (item.data.taskInfo as TaskInfo)?.status === 'running');
  const runningTitle = (nodes: Node[]) => (nodes.length > 1 ? '选中节点中存在运行中的节点，确认批量删除？' : '该节点当前处于运行状态，是否确认删除该节点？');

  if (input.groupId) {
    return {
      kind: 'group',
      id: input.groupId,
      confirmTitle: hasRunning(groupChildNodes) ? '组内存在运行中的节点，确认删除该组？' : undefined,
    };
  }

  const nodes = input.nodes ?? [];
  const edges = input.edges ?? [];
  const allNodes = input.allNodes ?? [];
  const canDeleteEdge = edges.length > 0 && nodes.length === 0;
  const canDeleteNodes = nodes.length > 0;
  const canDeleteGroup = !canDeleteEdge && !canDeleteNodes && allNodes.length === 1;

  if (canDeleteEdge) {
    return { kind: 'edges', ids: edges.map(item => item.id) };
  }

  if (canDeleteNodes) {
    return {
      kind: 'nodes',
      ids: nodes.map(item => item.id),
      confirmTitle: hasRunning(nodes) ? runningTitle(nodes) : undefined,
    };
  }

  if (canDeleteGroup) {
    return {
      kind: 'group',
      id: allNodes[0].id,
      confirmTitle: hasRunning(groupChildNodes) ? '组内存在运行中的节点，确认删除该组？' : undefined,
    };
  }

  return { kind: 'none' };
};

/** 选中项删除：内部封装 store 删除与运行中确认弹窗 */
const useDeleteSelection = () => {
  const { deleteNodes, deleteGroupNode, deleteEdges } = useFlowStore(state => state.actions);
  const { confirmDialog, openConfirmDialog, closeConfirmDialog } = useConfirmDialog();

  const deleteSelection = useCallback(
    (input: DeleteSelectionInput): boolean => {
      const potentialGroupId = input.groupId ?? (input.allNodes?.length === 1 ? input.allNodes[0].id : undefined);
      const groupChildNodes = potentialGroupId ? useFlowStore.getState().nodes.filter(n => n.parentId === potentialGroupId) : [];
      const intent = resolveDeleteSelection(input, groupChildNodes);

      if (intent.kind === 'none') return false;

      const runDelete = () => {
        if (intent.kind === 'edges') deleteEdges(intent.ids);
        else if (intent.kind === 'nodes') deleteNodes(intent.ids);
        else if (intent.kind === 'group') deleteGroupNode(intent.id);
      };

      if ('confirmTitle' in intent && intent.confirmTitle) {
        openConfirmDialog(intent.confirmTitle, '删除后已产生的赛点消耗不予返还', () => {
          runDelete();
          closeConfirmDialog();
        });
      } else {
        runDelete();
      }

      return true;
    },
    [deleteNodes, deleteGroupNode, deleteEdges, openConfirmDialog, closeConfirmDialog]
  );

  return { deleteSelection, confirmDialog, closeConfirmDialog };
};

// 处理键盘事件
const useKeyboardShortcuts = (
  reactFlowInstance: React.RefObject<any>,
  selectedMap: SelectMap | null | undefined,
  modelsMap: any,
  group: () => void,
  readOnly = false,
  onReadonlyAction?: () => void
) => {
  // 添加Shift键状态管理
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  // 添加Ctrl键状态管理
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [copyNodes, setCopyNodes] = useState<Node[] | any>(undefined);
  const shortCutLock = useFlowStore(state => state.shortCutLock);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);
  const { pasteNode, undo, redo, addNode } = useFlowStore(state => state.actions);
  const { deleteSelection, confirmDialog, closeConfirmDialog } = useDeleteSelection();
  const isAllowPaste = useMemo(() => {
    if (!selectedMap?.nodes || !selectedMap.nodes.length) return false;
    let isAllow = true;
    selectedMap?.nodes.forEach((item: Node) => {
      if (item.type == 'group') {
        isAllow = false;
      }
    });
    return isAllow;
  }, [selectedMap]);

  // 添加鼠标位置状态
  const mousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: MouseEvent) => {
    mousePositionRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // 图片/视频/音频粘贴
  const handleMediaFilePaste = useCallback(
    async (mediaFile: File) => {
      if (!mediaFile) return;
      const mediaType = resolveUploadMediaType(mediaFile);
      if (!mediaType) return;

      if (selectedMap?.nodes && selectedMap.nodes.length === 1 && selectedMap.nodes[0].type === mediaType) {
        const validation = await validateUploadFile(mediaType, mediaFile);
        if (!validation.valid) {
          toast.error(validation.message);
          return;
        }
        applyTempFileToNode(selectedMap.nodes[0], mediaFile);
      } else if (modelsMap && reactFlowInstance.current && mousePositionRef.current) {
        const screenPosition = reactFlowInstance.current.screenToFlowPosition({
          x: mousePositionRef.current.x,
          y: mousePositionRef.current.y,
        });
        const basic = {
          position: screenPosition,
          type: mediaType,
          tempFile: mediaFile,
        };
        const newNode = createNode(modelsMap, basic, modelNodePermission);
        addNode([newNode]);
      }
    },
    [selectedMap, modelsMap, modelNodePermission, reactFlowInstance, addNode]
  );

  // 监听粘贴事件
  const handlePasteEvent = useCallback(
    async (e: ClipboardEvent) => {
      if (readOnly) {
        e.preventDefault();
        onReadonlyAction?.();
        return;
      }

      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      // --- 策略 A: 检查是否是文件系统复制的图片/视频/音频或截图 ---
      const files = e.clipboardData?.files;
      let hasMediaFile = false;

      if (files && files.length > 0) {
        const { valid: validFiles, hasRejected } = partitionUploadMediaFiles(Array.from(files));
        if (hasRejected) {
          toast.error(UNSUPPORTED_MEDIA_FILE_TOAST);
        }
        if (validFiles.length > 0) {
          e.preventDefault();
          handleMediaFilePaste(validFiles[0]);
          hasMediaFile = true;
        }
      }

      if (hasMediaFile) return;

      // --- 策略 B: 检查剪切板里是否有自定义节点数据 ---
      // 这对应你 copyToClipboard(JSON.stringify(clipboardData)) 的内容
      const rawData = e.clipboardData?.getData('text/plain');
      if (rawData) {
        try {
          const parsedData = JSON.parse(rawData);
          if (parsedData === 'insight-flow-nodes' && isAllowPaste && copyNodes) {
            e.preventDefault();
            // 执行粘贴节点逻辑
            executePasteNodes(copyNodes);
            return;
          }
        } catch {
          // 说明不是 JSON 或不是我们定义的格式，忽略即可
        }
      }
    },
    [handleMediaFilePaste, copyNodes, isAllowPaste, readOnly, onReadonlyAction]
  );

  // 粘贴节点
  const executePasteNodes = (nodes: any[]) => {
    if (mousePositionRef.current && reactFlowInstance.current) {
      const screenPosition = reactFlowInstance.current.screenToFlowPosition({
        x: mousePositionRef.current.x,
        y: mousePositionRef.current.y,
      });
      pasteNode(nodes, screenPosition);
    } else {
      pasteNode(nodes);
    }
  };

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (readOnly) {
        const isMutationKey = event.key === 'Delete' || event.key === 'Backspace' || ((event.ctrlKey || event.metaKey) && ['d', 'v', 'x'].includes(event.key.toLowerCase()));

        if (isMutationKey) {
          event.preventDefault();
          event.stopPropagation();
          onReadonlyAction?.();
        }
        return;
      }

      if (shortCutLock) return;
      if (event.shiftKey) {
        setIsShiftPressed(true);
      }

      if (event.ctrlKey || event.metaKey) {
        setIsCtrlPressed(true);
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const edges = selectedMap?.edges ?? [];
        const nodes = selectedMap?.nodes ?? [];
        const allNodes = selectedMap?.allNodes ?? [];

        if (nodes.length <= 1 && shouldUseNativeTextInput(event.target)) return;

        const deleted = deleteSelection({ nodes, edges, allNodes });

        if (!deleted) return;

        event.preventDefault();
      }

      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 'z':
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
              // 重做
              redo();
            } else {
              // 撤销
              undo();
            }
            break;
          case 'y':
            event.preventDefault();
            // 重做
            redo();
            break;
          case 'c': {
            const nodes = selectedMap?.nodes ?? [];
            if (nodes.length === 0) break;
            if (nodes.length <= 1 && shouldUseNativeTextInput(event.target)) break;

            event.preventDefault();
            setCopyNodes([...nodes]);
            copyToClipboard(JSON.stringify('insight-flow-nodes'));
            break;
          }
          case 'd':
            event.preventDefault();
            // 快速粘贴
            if (isAllowPaste && selectedMap?.nodes) {
              const currentNodes = useFlowStore.getState().nodes;
              const latestNodes = selectedMap.nodes.map(node => currentNodes.find(item => item.id === node.id) || node);
              pasteNode(latestNodes);
            }
            break;
          case 'g':
            event.preventDefault();
            event.stopPropagation();
            // 组合
            group();
            break;
          case '+':
          case '=':
            event.preventDefault();
            event.stopPropagation();
            // 放大
            if (reactFlowInstance.current) {
              reactFlowInstance.current.zoomIn({ duration: 300 });
            }
            break;
          case '-':
          case '_':
            event.preventDefault();
            event.stopPropagation();
            // 缩小
            if (reactFlowInstance.current) {
              reactFlowInstance.current.zoomOut({ duration: 300 });
            }
            break;
          case '0':
            event.preventDefault();
            event.stopPropagation();
            // 重置缩放到100%
            if (reactFlowInstance.current) {
              reactFlowInstance.current.zoomTo(1, { duration: 300 });
            }
            break;
        }
      } else if (event.key.startsWith('Arrow')) {
        // 方向键微平移画布
        if (reactFlowInstance.current) {
          const currentViewport = reactFlowInstance.current.getViewport();
          const step = 20; // 微调步长
          let newX = currentViewport.x;
          let newY = currentViewport.y;

          switch (event.key) {
            case 'ArrowUp':
              newY += step;
              break;
            case 'ArrowDown':
              newY -= step;
              break;
            case 'ArrowLeft':
              newX += step;
              break;
            case 'ArrowRight':
              newX -= step;
              break;
          }

          reactFlowInstance.current.setViewport({
            x: newX,
            y: newY,
            zoom: currentViewport.zoom,
          });
        }
      }
    },
    [copyNodes, selectedMap, reactFlowInstance, shortCutLock, isAllowPaste, modelsMap, readOnly, onReadonlyAction, deleteSelection, group, pasteNode, undo, redo]
  );

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Shift') {
      setIsShiftPressed(false);
    }
    if (event.key === 'Control' || event.key === 'Meta') {
      setIsCtrlPressed(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('paste', handlePasteEvent);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('paste', handlePasteEvent);
    };
  }, [handleKeyDown, handleKeyUp]);

  return { isShiftPressed, isCtrlPressed, confirmDialog, closeConfirmDialog };
};

// 处理选择事件
const useSelectionLogic = (reactFlowInstance: React.RefObject<any>) => {
  const [selectionPosition, setSelectionPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [selectedMap, setSelectedMap] = useState<{
    nodes: Node[];
    edges: Edge[];
  } | null>();

  const updateSelectionPosition = useCallback((nodes: Node[]) => {
    if (nodes && nodes.length > 1 && reactFlowInstance.current) {
      const minX = Math.min(...nodes.map(n => n.position.x));
      const minY = Math.min(...nodes.map(n => n.position.y));
      const maxX = Math.max(...nodes.map(n => n.position.x + (n.measured?.width || 0)));
      const topCenterX = (maxX - minX) / 2 + minX - 160;
      const topCenterY = minY;

      const screenPosition = reactFlowInstance.current.flowToScreenPosition({
        x: topCenterX,
        y: topCenterY + 100,
      });

      setSelectionPosition({ top: screenPosition.y, left: screenPosition.x });
    }
  }, []);

  const onSelectionChange = (params: any) => {
    setSelectedMap(params);
  };

  const onSelectionStart = useCallback(() => {
    setSelectionPosition(null);
  }, []);

  const onSelectionEnd = useCallback(() => {
    if (selectedMap?.nodes) {
      updateSelectionPosition(selectedMap.nodes);
    }
  }, [selectedMap, updateSelectionPosition]);

  const onPaneDragStop = useCallback(() => {
    if (selectedMap?.nodes) {
      updateSelectionPosition(selectedMap.nodes);
    }
  }, [selectedMap, updateSelectionPosition]);

  const onSelectionDrag = useCallback(
    (_: React.MouseEvent, nodes: Node[]) => {
      updateSelectionPosition(nodes);
    },
    [updateSelectionPosition]
  );

  return {
    selectionPosition,
    setSelectionPosition,
    selectedMap,
    setSelectedMap,
    onSelectionChange,
    onSelectionStart,
    onSelectionEnd,
    onPaneDragStop,
    onSelectionDrag,
  };
};

// 处理悬浮事件
const useHoverWithDelay = (options: UseHoverWithDelayOptions = {}) => {
  const { delay = 200 } = options;
  const [isHovered, setIsHovered] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, delay);
  };

  return {
    isHovered,
    handleMouseEnter,
    handleMouseLeave,
  };
};

const useMediaNodeDimensions = (id: string, value: string, width: number, height: number) => {
  const hasMountedRef = useRef(false);
  const previousValueRef = useRef(value);
  const widthRef = useRef(width);
  const heightRef = useRef(height);
  const { ensureNodeMediaDimensions, updateNodeMeasured } = useFlowStore(state => state.actions);

  widthRef.current = width;
  heightRef.current = height;

  useEffect(() => {
    const isFirstMount = !hasMountedRef.current;
    const valueChangedAfterMount = hasMountedRef.current && previousValueRef.current !== value;
    hasMountedRef.current = true;
    previousValueRef.current = value;

    if (!value) {
      if (!widthRef.current || !heightRef.current || valueChangedAfterMount) {
        updateNodeMeasured(id, { width: defaultWidth, height: defaultHeight }, !isFirstMount);
      }
      return;
    }

    ensureNodeMediaDimensions(id, value, valueChangedAfterMount);
  }, [id, value, ensureNodeMediaDimensions, updateNodeMeasured]);
};

// 图片/视频节点只触发统一尺寸协调器；保留现有 Hook 签名，避免批量修改调用方。
const useImageNodeDimensions = (id: string, value: string, width: number, height: number, _time?: string, _maxSize?: number) => {
  void _time;
  void _maxSize;
  useMediaNodeDimensions(id, value, width, height);
};

const useVideoNodeDimensions = (id: string, value: string, width: number, height: number, _time?: string) => {
  void _time;
  useMediaNodeDimensions(id, value, width, height);
};

// 处理轮询逻辑
const usePolling = (status: string, canvasId: string) => {
  const binding = getCanvasViewBinding();
  useEffect(() => {
    if (binding) return; // Client context already owns this canvas's poller.
    const monitor = createCanvasGenerationMonitor(useFlowStore, defaultCanvasVersionBarrier, usePointStore);
    monitor.reconcile();
    return monitor.stop;
  }, [status, canvasId, binding]);
};

// 处理节点尺寸变化
const useNodeResizeObserver = (nodeRef: React.RefObject<HTMLElement> | null, id: string, updateNodeInternals: any) => {
  useEffect(() => {
    if (!nodeRef || !nodeRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      // 尺寸变化时触发更新
      updateNodeInternals(id);
    });

    resizeObserver.observe(nodeRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [id, updateNodeInternals]);
};

// 封装节点统一操作事件
const useNodeOperations = (id: string, data: any) => {
  const modelsMap = useFlowStore(state => state.modelsMap);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);
  const { copyNode, deleteNodes, renameNode, updateNodeData, dragAddNode, dragAddNodes } = useFlowStore(state => state.actions);

  const handleCopy = () => {
    copyNode(id);
  };

  const handleDelete = () => {
    deleteNodes([id]);
  };

  const handleEdit = (title: string) => {
    const result = renameNode(id, title);
    if (!result.ok) {
      toast.error(result.reason === 'duplicate' ? '命名已存在' : '命名不能为空');
      return false;
    }
    return true;
  };

  const handleChangePrompt = (prompt: string) => {
    const currentData = useFlowStore.getState().nodes.find(node => node.id === id)?.data;
    if (!currentData) return;
    updateNodeData(
      id,
      {
        ...currentData,
        params: {
          ...(currentData.params as object),
          prompt: prompt,
        },
      },
      false
    );
  };

  const handleChangeTitleStyle = (titleStyle: titleStyleData) => {
    updateNodeData(id, {
      ...data,
      titleStyle,
    });
  };

  // 监听级联选项变化
  const handleCascadeChange = (changeParams: Params) => {
    const newParams = {
      ...data.params,
      ...changeParams,
    };
    updateNodeData(id, {
      ...data,
      params: newParams,
    });
  };

  /**
   * 新增后续节点（工具节点），并自动连线到当前节点后面
   * - x 在当前基础上 +450
   * - x/y 各自增加 [-20, 20] 随机偏移避免重叠
   */
  const handleAddNextNode = (currentNodeType: 'image' | 'video' | 'text' | 'audio', nextToolType: string, currentPosition: { x: number; y: number }) => {
    const offset = createRandomOffset();
    const newNode = createNode(
      modelsMap,
      {
        type: nextToolType,
        position: {
          x: currentPosition.x + defaultWidth + 50 + offset.x,
          y: currentPosition.y + offset.y,
        },
      },
      modelNodePermission
    );

    // 从视频节点快捷栏创建分镜脚本时，默认使用视频反推模式
    if (nextToolType === 'storyboardTool' && currentNodeType === 'video') {
      newNode.data.params = {
        ...newNode.data.params,
        mode: 'video_understand',
      };
    }

    const fromHandle = {
      id: `${currentNodeType}_source`,
      type: 'source' as const,
      nodeId: id,
    };
    const edge = createDragEdge(fromHandle as any, newNode.id);
    dragAddNode(newNode as any, edge as any);
  };

  /**
   * 新增前接节点（基础节点），并自动连线到当前工具节点
   * - x 在当前基础上 -(defaultWidth + TOOL_SOURCE_NODE_GAP_X)
   * - x/y 各自增加 [-20, 20] 随机偏移避免重叠
   * - 对口型等多输入工具仅补连缺失的类型
   */
  const handleAddPrevNode = (toolType: string, currentPosition: { x: number; y: number }) => {
    const { readOnly, edges } = useFlowStore.getState();
    if (readOnly) return;

    const sourceTypes = toolQuickConnectMap[toolType];
    if (!sourceTypes?.length) return;

    const connectedTargetHandles = new Set(edges.filter(edge => edge.target === id && edge.targetHandle).map(edge => edge.targetHandle as string));
    const missingTypes = sourceTypes.filter(type => !connectedTargetHandles.has(`${type}_target`));
    if (!missingTypes.length) return;

    const offset = createRandomOffset();
    const baseX = currentPosition.x - defaultWidth - TOOL_SOURCE_NODE_GAP_X + offset.x;
    const baseY = currentPosition.y + offset.y;
    const verticalGap = defaultHeight + 50;

    const createPrevNodeWithEdge = (basicType: string, position: { x: number; y: number }) => {
      const newNode = applyEmptyMediaNodeDimensions(
        createNode(
          modelsMap,
          {
            type: basicType,
            position,
          },
          modelNodePermission
        )
      );

      const fromHandle = {
        id: `${basicType}_source`,
        type: 'source' as const,
        nodeId: newNode.id,
      };
      const edge = createDragEdge(fromHandle as any, id);
      return { newNode, edge };
    };

    if (missingTypes.length === 1) {
      const { newNode, edge } = createPrevNodeWithEdge(missingTypes[0], { x: baseX, y: baseY });
      dragAddNode(newNode as any, edge as any);
      return;
    }

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    missingTypes.forEach((basicType, index) => {
      const { newNode, edge } = createPrevNodeWithEdge(basicType, { x: baseX, y: baseY + index * verticalGap });
      newNodes.push(newNode as Node);
      newEdges.push(edge as Edge);
    });
    dragAddNodes(newNodes, newEdges);
  };

  return {
    handleCopy,
    handleDelete,
    handleEdit,
    handleChangePrompt,
    handleChangeTitleStyle,
    handleCascadeChange,
    handleAddNextNode,
    handleAddPrevNode,
  };
};

/**
 * 工具节点执行后输出子节点：预创建、挂载到画布、回写结果、失败标记
 */
const useToolOutputChildNodes = (options: UseToolOutputChildNodesOptions) => {
  const { toolNodeId, nodeWidth, childType = 'image', sourceHandleId = 'image_source', childInitialStatus = 'running' } = options;

  const nodes = useFlowStore(state => state.nodes);
  const modelsMap = useFlowStore(state => state.modelsMap);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);
  const { dragAddNode, dragAddNodes, updateNodeData, updateNodeStatus, updateNodeMeasured } = useFlowStore(state => state.actions);
  const childNodeIdsRef = useRef<string[]>([]);

  const prepareChildNodes = useCallback(
    (prepOptions?: PrepareToolOutputChildNodesOptions): Node[] => {
      const count = prepOptions?.count ?? 1;
      const layout = prepOptions?.layout ?? 'single';
      const spacingY = prepOptions?.spacingY ?? 480;
      const useRandomOffset = prepOptions?.useRandomOffset ?? layout === 'single';
      const gapX = prepOptions?.gapX ?? (layout === 'vertical' ? 120 : defaultWidth + 50);
      const currentNode = nodes.find(n => n.id === toolNodeId);
      if (!currentNode || !modelsMap) return [];

      const offset = useRandomOffset ? createRandomOffset() : { x: 0, y: 0 };
      const baseX = currentNode.position.x + (nodeWidth || defaultWidth) + gapX + offset.x;
      const baseY = currentNode.position.y + offset.y;
      const result: Node[] = [];

      for (let i = 0; i < count; i++) {
        const position = layout === 'vertical' ? { x: baseX, y: baseY + i * spacingY } : { x: baseX, y: baseY };
        const newNode = createNode(modelsMap, { type: childType, position }, modelNodePermission) as Node;
        newNode.selected = false;
        if (newNode.data) {
          newNode.data = {
            ...buildInitialToolOutputNodeData(newNode.data as Record<string, unknown>),
            taskInfo: {
              ...((newNode.data as any).taskInfo || {}),
              status: childInitialStatus,
            },
          };
        }
        prepOptions?.customizeNode?.(newNode, i);
        result.push(newNode);
      }
      return result;
    },
    [nodes, modelsMap, modelNodePermission, toolNodeId, nodeWidth, childType, childInitialStatus]
  );

  const attachChildNodes = useCallback(
    async (childNodes: Node[]) => {
      if (!childNodes.length) return;
      childNodeIdsRef.current = childNodes.map(n => n.id);

      const newEdges = childNodes.map(
        childNode =>
          createDragEdge(
            {
              id: sourceHandleId,
              type: 'source',
              nodeId: toolNodeId,
            } as any,
            childNode.id
          ) as Edge
      );

      if (childNodes.length === 1) {
        await dragAddNode(childNodes[0], newEdges[0], { selectNewNode: false });
        return;
      }
      await dragAddNodes(childNodes, newEdges, { selectNewNode: false });
    },
    [toolNodeId, sourceHandleId, dragAddNode, dragAddNodes]
  );

  /** 任务失败时将 running 子节点置为 failure，并同步工具节点报错信息 */
  const markChildNodesFailure = useCallback(
    (errorMsg = '') => {
      childNodeIdsRef.current.forEach(nodeId => {
        const childNode = useFlowStore.getState().nodes.find(n => n.id === nodeId);
        if (childNode && (childNode.data as any)?.taskInfo?.status === 'running') {
          updateNodeStatus(nodeId, 'failure', errorMsg);
        }
      });
    },
    [updateNodeStatus]
  );

  const applyChildNodeInfo = useCallback(
    (childNodeInfo: Record<string, string> | null, measuredMap?: Record<string, MediaNodeMeasuredSize | null>) => {
      if (!childNodeInfo) return;
      const nodesState = useFlowStore.getState().nodes;
      Object.entries(childNodeInfo).forEach(([nodeId, url]) => {
        const childNode = nodesState.find(n => n.id === nodeId);
        if (childNode && url) {
          updateNodeData(
            nodeId,
            {
              ...buildMediaToolOutputNodeData(childNode.data as Record<string, unknown>, url),
              taskInfo: {
                ...(childNode.data as any).taskInfo,
                status: 'success',
              },
            },
            false,
            false
          );
          const measured = measuredMap?.[nodeId];
          if (measured) {
            updateNodeMeasured(nodeId, measured.measured, true);
          }
        }
      });
    },
    [updateNodeData, updateNodeMeasured]
  );

  /** 纯前端工具：操作完成后创建 tool 输出子节点并挂载到工具节点后方；返回子节点 id */
  const attachUploadOutputNode = useCallback(
    async (url: string, attachOptions?: AttachUploadOutputNodeOptions): Promise<string | undefined> => {
      if (!url) return;
      const measured = attachOptions?.measured ?? (await measureMediaNodeSize(childType, url));
      const childNodes = prepareChildNodes({
        count: 1,
        layout: 'single',
        gapX: attachOptions?.gapX,
        useRandomOffset: attachOptions?.useRandomOffset ?? true,
        customizeNode: node => {
          if (node.data) {
            node.data = {
              ...buildMediaToolOutputNodeData(node.data as Record<string, unknown>, url),
              product: [{ value: url }],
              taskInfo: {
                ...((node.data as any).taskInfo || {}),
                status: 'success',
              },
            };
            if (measured) {
              node.width = measured.width;
              node.height = measured.height;
              node.measured = measured.measured;
            }
          }
        },
      });
      if (!childNodes.length) return;
      await attachChildNodes(childNodes);
      return childNodes[0].id;
    },
    [prepareChildNodes, attachChildNodes, childType]
  );

  const applyChildNodeInfoFromPollData = useCallback(
    (resData: any, measuredMap?: Record<string, MediaNodeMeasuredSize | null>) => {
      applyChildNodeInfo(parseChildNodeInfoFromPollData(resData), measuredMap);
    },
    [applyChildNodeInfo]
  );

  return {
    childNodeIdsRef,
    prepareChildNodes,
    attachChildNodes,
    markChildNodesFailure,
    attachUploadOutputNode,
    applyChildNodeInfo,
    applyChildNodeInfoFromPollData,
    parseChildNodeInfoFromPollData,
  };
};

// 添加拖拽功能hook
const useDragAndDrop = (modelsMap: any, reactFlowInstance: React.RefObject<any>, readOnly = false, onReadonlyAction?: () => void) => {
  const { addNode } = useFlowStore(state => state.actions);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);

  // 当拖拽发生在上传弹窗内时，避免同时触发画布“拖入创建节点”
  const isFromUploadDialog = useCallback((e: React.DragEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    return Boolean(target.closest('[data-canvas-ignore-drop="true"]'));
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isFromUploadDialog(e)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [isFromUploadDialog]
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (isFromUploadDialog(e)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [isFromUploadDialog]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (isFromUploadDialog(e)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [isFromUploadDialog]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (readOnly) {
        e.preventDefault();
        e.stopPropagation();
        onReadonlyAction?.();
        return;
      }

      if (isFromUploadDialog(e)) return;
      e.preventDefault();
      e.stopPropagation();

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (!droppedFiles.length) return;

      const { valid: validFiles, hasRejected } = partitionUploadMediaFiles(droppedFiles);
      if (hasRejected) {
        toast.error(UNSUPPORTED_MEDIA_FILE_TOAST);
      }
      if (!validFiles.length || !reactFlowInstance.current) return;

      const flowPosition = reactFlowInstance.current.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      const newNodes: Node[] = [];
      const allowReplace = validFiles.length === 1;

      for (const [index, file] of validFiles.entries()) {
        const mediaType = resolveUploadMediaType(file);
        if (!mediaType) continue;

        if (allowReplace) {
          const targetNode = findMediaNodeAtDropPoint(reactFlowInstance, e.clientX, e.clientY, mediaType);
          if (targetNode) {
            const validation = await validateUploadFile(mediaType, file);
            if (!validation.valid) {
              toast.error(validation.message);
              continue;
            }
            applyTempFileToNode(targetNode, file);
            continue;
          }
        }

        const basic = {
          position: {
            x: flowPosition.x + index * MEDIA_FILE_DROP_OFFSET,
            y: flowPosition.y + index * MEDIA_FILE_DROP_OFFSET,
          },
          type: mediaType,
          tempFile: file,
        };
        newNodes.push(createNode(modelsMap, basic, modelNodePermission));
      }

      if (newNodes.length > 0) {
        addNode(newNodes);
      }
    },
    [reactFlowInstance, modelsMap, modelNodePermission, isFromUploadDialog, readOnly, onReadonlyAction, addNode]
  );

  return {
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  };
};

const mapCanvasNodeTypeToCellType = (type?: string) => (type === 'text' || type === 'image' || type === 'video' || type === 'audio' ? type : 'empty');

/** 运行中不允许拖入；生成失败时仅当已有 value 才允许拖入分镜表格 */
const isStoryboardNodeDropBlocked = (taskInfo?: TaskInfo, value?: string) => {
  if (taskInfo?.status === 'running') return true;
  if (taskInfo?.status === 'failure') return !value;
  return false;
};

const isStoryboardAcceptCellType = (_mode: string | undefined, cellType: string) => {
  // 需求：无论什么模式都支持四种类型拖入单元格
  return cellType === 'text' || cellType === 'image' || cellType === 'video' || cellType === 'audio';
};

const getStoryboardCellLocationByPoint = (wrapperEl: HTMLElement, table: TableProtocol, clientX: number, clientY: number, zoom: number) => {
  const scrollContainer = wrapperEl.querySelector('[data-storyboard-scroll="true"]') as HTMLElement | null;
  if (!scrollContainer) return null;
  // 仅编辑态接受画布拖入；生成模式勾选栏会打开 pointer-events，需另看 accept-drop
  if (scrollContainer.dataset.storyboardAcceptDrop !== 'true') return null;
  if (window.getComputedStyle(scrollContainer).pointerEvents === 'none') return null;

  const rect = wrapperEl.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;

  // rect / clientX,Y 是屏幕坐标，会随画布 zoom 缩放；scrollLeft/Top 和行列宽高是内容坐标（未缩放）。
  const scale = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const localX = (clientX - rect.left) / scale + (scrollContainer.scrollLeft ?? 0);
  const localY = (clientY - rect.top) / scale + (scrollContainer.scrollTop ?? 0);
  if (localX < SERIAL_COL_WIDTH || localY < HEADER_ROW_HEIGHT) return null;

  let runX = SERIAL_COL_WIDTH;
  let foundCol = -1;
  for (let i = 0; i < table.columns.length; i++) {
    const w = table.columns[i].width;
    if (localX >= runX && localX < runX + w) {
      foundCol = i;
      break;
    }
    runX += w;
  }

  let runY = HEADER_ROW_HEIGHT;
  let foundRow = -1;
  for (let i = 0; i < table.rowsHeight.length; i++) {
    const h = table.rowsHeight[i];
    if (localY >= runY && localY < runY + h) {
      foundRow = i;
      break;
    }
    runY += h;
  }

  if (foundCol < 0 || foundRow < 0) return null;
  return { rowIndex: foundRow, field: table.columns[foundCol].field } as const;
};

const isSameStoryboardDropPreview = (a: StoryboardDropPreview | null, b: StoryboardDropPreview | null) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.storyboardNodeId === b.storyboardNodeId && a.rowIndex === b.rowIndex && a.field === b.field && !!a.blocked === !!b.blocked;
};

/** 基础节点拖拽 -> 分镜表格单元格（支持横纵滚动、编辑态、拖拽过程蓝框预览） */
const useStoryboardNodeDrop = (redirectToLoginForReadOnly: () => boolean) => {
  const zoom = useFlowStore(state => state.zoom);
  const { updateNodeData, setNodes, setStoryboardDropPreview } = useFlowStore(state => state.actions);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ event: any; node: Node } | null>(null);
  const dragOriginRef = useRef<{ nodeId: string; position: { x: number; y: number } } | null>(null);

  const resolveDropPreview = useCallback(
    (pt: { x: number; y: number }, draggedNode: Node, nodeList: Node[]): StoryboardDropPreview | null => {
      if (draggedNode.type === 'storyboardTool') return null;

      const sourceNode = nodeList.find(n => n.id === draggedNode.id) ?? draggedNode;
      const taskInfo = sourceNode.data?.taskInfo as TaskInfo | undefined;

      const cellType = mapCanvasNodeTypeToCellType(draggedNode.type);
      if (cellType === 'empty') return null;

      const value = String((draggedNode as any).data?.value ?? '');
      if (!value && cellType !== 'text') return null;

      const blocked = isStoryboardNodeDropBlocked(taskInfo, value);

      const wrappers = Array.from(document.querySelectorAll('[data-storyboard-table="true"]')) as HTMLElement[];
      const hitWrapper = wrappers.find(w => {
        const rect = w.getBoundingClientRect();
        return pt.x >= rect.left && pt.x <= rect.right && pt.y >= rect.top && pt.y <= rect.bottom;
      });
      if (!hitWrapper) return null;

      const flowNodeEl = hitWrapper.closest('.react-flow__node') as HTMLElement | null;
      if (!flowNodeEl) return null;

      const targetId = flowNodeEl.getAttribute('data-id') || '';
      if (!targetId || targetId === draggedNode.id) return null;

      const targetNode = nodeList.find(n => n.id === targetId);
      if (!targetNode || targetNode.type !== 'storyboardTool') return null;

      const table = (targetNode.data as any)?.table as TableProtocol | undefined;
      if (!table) return null;

      const hit = getStoryboardCellLocationByPoint(hitWrapper, table, pt.x, pt.y, zoom);
      if (!hit) return null;

      const mode = (targetNode.data as any)?.params?.mode as string | undefined;
      if (!isStoryboardAcceptCellType(mode, cellType)) return null;

      return {
        storyboardNodeId: targetNode.id,
        rowIndex: hit.rowIndex,
        field: hit.field,
        ...(blocked ? { blocked: true } : {}),
      };
    },
    [zoom]
  );

  const clearDropPreview = useCallback(() => {
    pendingDragRef.current = null;
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    setStoryboardDropPreview(null);
  }, [setStoryboardDropPreview]);

  const restoreDragOriginPosition = useCallback(
    (nodeId: string) => {
      const origin = dragOriginRef.current;
      if (!origin || origin.nodeId !== nodeId) return;

      const restoredPosition = { x: origin.position.x, y: origin.position.y };
      const { nodes: currentNodes, canvasId } = useFlowStore.getState();
      setNodes(currentNodes.map(n => (n.id === nodeId ? { ...n, position: restoredPosition } : n)));
      if (canvasId) useFlowStore.getState().actions.partialUpdate(canvasId, { updateNodes: [{ id: nodeId, position: restoredPosition }] });
    },
    [setNodes]
  );

  const handleNodeDragStart = useCallback(
    (_event: any, draggedNode: Node) => {
      clearDropPreview();
      if (!draggedNode?.id) {
        dragOriginRef.current = null;
        return;
      }
      const source = useFlowStore.getState().nodes.find(n => n.id === draggedNode.id) ?? draggedNode;
      dragOriginRef.current = {
        nodeId: draggedNode.id,
        position: { x: source.position.x, y: source.position.y },
      };
    },
    [clearDropPreview]
  );

  const handleNodeDrag = useCallback(
    (event: any, draggedNode: Node) => {
      if (redirectToLoginForReadOnly()) return;
      pendingDragRef.current = { event, node: draggedNode };
      if (dragRafRef.current != null) return;

      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        const pending = pendingDragRef.current;
        if (!pending) return;

        const { event: dragEvent, node } = pending;
        if (!dragEvent || !node) {
          clearDropPreview();
          return;
        }

        const pt = getClientPoint(dragEvent);
        if (!pt) {
          clearDropPreview();
          return;
        }

        const next = resolveDropPreview(pt, node, useFlowStore.getState().nodes);
        const prev = useFlowStore.getState().storyboardDropPreview;
        if (!isSameStoryboardDropPreview(prev, next)) {
          setStoryboardDropPreview(next);
        }
      });
    },
    [redirectToLoginForReadOnly, resolveDropPreview, setStoryboardDropPreview, clearDropPreview]
  );

  const handleNodeDragStop = useCallback(
    (event: any, draggedNode: Node) => {
      const preview = useFlowStore.getState().storyboardDropPreview;
      clearDropPreview();

      try {
        if (redirectToLoginForReadOnly()) return;
        if (!event || !draggedNode) return;
        if (draggedNode.type === 'storyboardTool') return;

        const currentNodes = useFlowStore.getState().nodes;
        const sourceNode = currentNodes.find(n => n.id === draggedNode.id) ?? draggedNode;
        const taskInfo = sourceNode.data?.taskInfo as TaskInfo | undefined;
        const value = String((sourceNode as any).data?.value ?? '');
        const blocked = isStoryboardNodeDropBlocked(taskInfo, value);

        const pt = getClientPoint(event);
        if (!pt) return;

        const hitPreview = preview ?? resolveDropPreview(pt, draggedNode, currentNodes);
        if (!hitPreview) return;

        const restoreAfterStoryboardDrop = () => restoreDragOriginPosition(draggedNode.id);

        if (blocked || hitPreview.blocked) {
          toast.error('生成中的节点不支持拖入表格；生成失败且无内容的节点也不支持，请重试');
          restoreAfterStoryboardDrop();
          return;
        }

        const targetNode = currentNodes.find(n => n.id === hitPreview.storyboardNodeId);
        if (!targetNode || targetNode.type !== 'storyboardTool') {
          restoreAfterStoryboardDrop();
          return;
        }

        const table = (targetNode.data as any)?.table as TableProtocol | undefined;
        if (!table) {
          restoreAfterStoryboardDrop();
          return;
        }

        const hit = { rowIndex: hitPreview.rowIndex, field: hitPreview.field };
        const targetRow = table.data[hit.rowIndex];
        if (!targetRow) {
          restoreAfterStoryboardDrop();
          return;
        }

        const cellType = mapCanvasNodeTypeToCellType(draggedNode.type);
        if (cellType === 'empty') {
          restoreAfterStoryboardDrop();
          return;
        }

        const mode = (targetNode.data as any)?.params?.mode as string | undefined;
        if (!isStoryboardAcceptCellType(mode, cellType)) {
          restoreAfterStoryboardDrop();
          return;
        }

        if (!value && cellType !== 'text') {
          restoreAfterStoryboardDrop();
          return;
        }

        const nextTable = JSON.parse(JSON.stringify(table)) as TableProtocol;
        const fields = nextTable.columns.map(c => c.field);
        const nextRow = nextTable.data[hit.rowIndex];
        if (!nextRow) {
          restoreAfterStoryboardDrop();
          return;
        }
        fields.forEach(f => {
          if (!nextRow[f]) nextRow[f] = { type: 'empty', value: '' } as CellData;
        });
        nextRow[hit.field] = { type: cellType as any, value };
        nextTable.data[hit.rowIndex] = nextRow;

        updateNodeData(
          targetNode.id,
          {
            ...targetNode.data,
            table: nextTable,
          },
          false
        );
        restoreAfterStoryboardDrop();
      } finally {
        dragOriginRef.current = null;
      }
    },
    [redirectToLoginForReadOnly, updateNodeData, clearDropPreview, resolveDropPreview, restoreDragOriginPosition]
  );

  return {
    onNodeDragStart: handleNodeDragStart,
    onNodeDrag: handleNodeDrag,
    onNodeDragStop: handleNodeDragStop,
  };
};

interface PointCaculateResult {
  point: number;
  loading: boolean;
}

interface SinglePointCaculateOptions {
  nodeType?: string;
  audioInputTexts?: string[];
  videoUrls?: string[];
}

const useSinglePointCaculate = (params: any, options?: SinglePointCaculateOptions): number => {
  const pointList = useFlowStore(state => state.pointList);
  const nodeType = options?.nodeType;
  const audioInputTexts = options?.audioInputTexts;

  return useMemo(() => {
    return caculateSingleNodePoint(pointList, params, audioInputTexts, nodeType);
  }, [params, pointList, nodeType, audioInputTexts]);
};

type NodeCostData = {
  caculatePoint: number;
  originalPoints: number | null;
};

const DEFAULT_IGNORE_CACHED_KEYS: string[] = ['prompt'];

export const useNodeCostQuery = (nodeId: string, params: any, enabled: boolean, ignoreCachedKeys: string[] = DEFAULT_IGNORE_CACHED_KEYS) => {
  const { nodes, edges, canvasId } = useFlowStore();

  const paramsKey = useMemo(() => {
    const cachedParams = Object.fromEntries(Object.entries(params || {}).filter(([key]) => !ignoreCachedKeys.includes(key)));
    return JSON.stringify(cachedParams);
  }, [params, ignoreCachedKeys]);

  const sourceMapKey = useMemo(() => {
    const sourceMap = getSourceMap(nodes, edges, nodeId);
    return JSON.stringify(sourceMap);
  }, [nodes, edges, nodeId]);

  return useQuery<NodeCostData>({
    queryKey: ['videoCost', canvasId, nodeId, paramsKey, sourceMapKey],
    queryFn: async ({ signal }) => {
      try {
        const payload = buildSingleWorkflowPayload(canvasId, nodes, edges, nodeId);
        const quote = await calculateSingleWorkflowCost(payload, { signal });
        return { caculatePoint: quote.points, originalPoints: quote.originalPoints };
      } catch {
        throw new Error('预估赛点消耗失败，请稍后重试');
      }
    },
    enabled: enabled,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });
};

interface UsePromptModelCommonOptions {
  nodeId?: string;
  nodePrompt: string;
  model?: string;
  status: string;
  hasExtraInputs?: boolean;
  /**
   * TODO: 当不同的 modelType 存在相同的模型，且模型的参数存在冲突时（例如：maxPrompt），
   * modelMaxPromptMap 的参数会被覆盖，这不符合预期。增加 maxPrompt，增加调用时的确定性，
   * 同时先兼容旧的逻辑，后续统一优化。
   */
  maxPrompt?: number;
  inputTextsForLen?: string[];
  onChangePrompt: (value: string) => void;
  debounceMs?: number;
}

interface PromptDisabledReason {
  currentTextLen: number;
  maxPrompt: number;
}

const usePromptModelCommon = ({
  nodeId,
  nodePrompt,
  model,
  status,
  hasExtraInputs = false,
  maxPrompt: maxPromptFromProps,
  inputTextsForLen = [],
  onChangePrompt,
  debounceMs = 1500,
}: UsePromptModelCommonOptions) => {
  const [prompt, setPrompt] = useState(nodePrompt || '');
  const nodePromptRef = useRef(nodePrompt);
  nodePromptRef.current = nodePrompt;
  const modelMaxPromptMap = useFlowStore(state => state.modelMaxPromptMap);



  const currentTextLen = useMemo(() => {
    const inputTextLen = inputTextsForLen.reduce((sum, t) => sum + (t?.length ?? 0), 0);
    return (prompt?.length ?? 0) + inputTextLen;
  }, [prompt, inputTextsForLen]);

  const maxPrompt = useMemo(() => {
    const key = String(model || '');
    const limit = maxPromptFromProps ?? modelMaxPromptMap?.[key];
    return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : undefined;
  }, [model, modelMaxPromptMap, maxPromptFromProps]);

  const overLimit = useMemo(() => {
    if (!maxPrompt) return false;
    return currentTextLen > maxPrompt;
  }, [currentTextLen, maxPrompt]);

  const allowSend = useMemo(() => {
    if ((!hasExtraInputs && !prompt.trim()) || status == 'running') {
      return false;
    }
    return !overLimit;
  }, [hasExtraInputs, prompt, overLimit, status]);

  const disabledReason = useMemo(() => {
    if (!overLimit || !maxPrompt) return undefined;
    return {
      currentTextLen,
      maxPrompt,
    } as PromptDisabledReason;
  }, [currentTextLen, maxPrompt, overLimit]);

  const updateValue = useCallback(
    (content: string) => {
      if (content === nodePromptRef.current) return;
      onChangePrompt(content);
      // 编辑保护先于 React 回传节点值解除，避免此时同步回旧提示词。
      nodePromptRef.current = content;
    },
    [onChangePrompt]
  );

  const updateValueRef = useRef(updateValue);
  updateValueRef.current = updateValue;

  const debouncedUpdateValue = useMemo(() => {
    return createAgentEditorDebounce(`${nodeId ?? 'tool'}:prompt`, (content: string) => {
      updateValueRef.current(content);
    }, debounceMs);
  }, [debounceMs, nodeId]);

  useEffect(() => {
    const binding = getCanvasViewBinding();
    if (!binding) return;
    const sync = () => {
      const active = document.hasFocus() && document.activeElement?.closest('input, textarea, [contenteditable]');
      if (!debouncedUpdateValue.isPending() && !binding.guard.isEditorBusy() && !active) setPrompt(nodePromptRef.current || '');
    };
    sync(); return binding.guard.subscribeEditors(sync);
  }, [nodePrompt, debouncedUpdateValue]);

  const flushPrompt = useCallback(() => debouncedUpdateValue.flush(prompt), [debouncedUpdateValue, prompt]);

  return {
    prompt,
    setPrompt,
    allowSend,
    disabledReason,
    updateValue,
    debouncedUpdateValue,
    flushPrompt,
  };
};

const GROUP_COST_DEBOUNCE_MS = 400;
const useGroupPointCaculate = (nodes: Node[], runningNodeId?: string): PointCaculateResult => {
  const queryClient = useQueryClient();
  const edges = useFlowStore(state => state.edges);
  const allNodes = useFlowStore(state => state.nodes);
  const canvasId = useFlowStore(state => state.canvasId);
  const abortControllerRef = useRef<AbortController | null>(null);

  const nodesKey = useMemo(
    () =>
      nodes
        .map(n => {
          const p = (n.data?.params ?? {}) as Params;
          return `${n.id}:${n.type}:${p.model}:${p.duration}:${p.resolution}:${p.gen_count}`;
        })
        .join('|'),
    [nodes]
  );

  const targetQueryKey = useMemo(() => ['groupCost', canvasId, nodesKey, runningNodeId], [canvasId, nodesKey, runningNodeId]);
  const cachedData = queryClient.getQueryData<number>(targetQueryKey);
  const hasCache = Boolean(nodesKey) && cachedData !== undefined;

  const [debouncedPayloadKey, setDebouncedPayloadKey] = useState('');
  useEffect(() => {
    if (!nodesKey) {
      setDebouncedPayloadKey('');
      abortControllerRef.current?.abort();
      return;
    }
    if (hasCache) {
      abortControllerRef.current?.abort();
      setDebouncedPayloadKey(nodesKey);
      return;
    }
    const timer = window.setTimeout(() => setDebouncedPayloadKey(nodesKey), GROUP_COST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [nodesKey, hasCache]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const waitingForStableSelection = !hasCache && nodesKey !== debouncedPayloadKey;
  const activePayloadKey = hasCache ? nodesKey : debouncedPayloadKey;

  const { data, isFetching } = useQuery({
    queryKey: ['groupCost', canvasId, activePayloadKey, runningNodeId],
    queryFn: async ({ signal }) => {
      if (!nodesKey) throw new Error('预估赛点消耗失败，请稍后重试');

      // 如果再次触发计算，且已有请求正在计算中，先 abort 掉它
      abortControllerRef.current?.abort();
      const currentController = new AbortController();
      abortControllerRef.current = currentController;

      const onSignalAbort = () => {
        currentController.abort();
      };
      signal?.addEventListener('abort', onSignalAbort);

      try {
        const costNodes = nodes.filter(node => !node.type?.includes('Tool'));
        const selectedEdges = getEdgesByNodes(costNodes, edges);
        const { sourceNodes, relateEdges } = getSourceNodesAndEdges(allNodes, costNodes, edges);

        const payload = {
          canvasId,
          workflowData: {
            nodes: costNodes.concat(sourceNodes),
            edges: selectedEdges.concat(relateEdges),
          },
          executeStrategy: 'total',
          ...(runningNodeId ? { runningNodeIds: [runningNodeId] } : {}),
        };
        // TODO: prompt 为空时，接口无法返回有效的 cost。临时为空 prompt 增加一个字符，以保证 cost 正常返回
        payload.workflowData.nodes = payload.workflowData.nodes.map((node: any) => {
          if (node.data?.params?.prompt === '') {
            return {
              ...node,
              data: { ...node.data, params: { ...node.data.params, prompt: ' ' } },
            };
          }
          return node;
        });
        const res: any = await calculateWorkflowCost(payload, currentController.signal);
        return Number(res.data.discount_applied ? res.data.discounted_points : res.data.original_points);
      } catch (error: any) {
        if (currentController.signal.aborted) {
          throw error;
        }
        throw new Error('预估赛点消耗失败，请稍后重试');
      } finally {
        signal?.removeEventListener('abort', onSignalAbort);
        if (abortControllerRef.current === currentController) {
          abortControllerRef.current = null;
        }
      }
    },
    enabled: Boolean(nodesKey) && !waitingForStableSelection,
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { point: waitingForStableSelection ? 0 : (data ?? 0), loading: waitingForStableSelection || isFetching };
};

// 计算按钮缩放比例
const useButtonScale = () => {
  const zoom = useFlowStore(state => state.zoom);
  const buttonScale = useMemo(() => {
    // 计算按钮缩放比例，基于zoom值
    const baseScale = 1;
    const adjustedScale = baseScale / zoom;
    const maxScale = baseScale * 1.5; // 最大放大到原始大小的2倍
    const minScale = baseScale * 1; // 最小缩小到原始大小的一半
    if (adjustedScale > maxScale) {
      return maxScale;
    } else if (adjustedScale < minScale) {
      return minScale;
    } else {
      return adjustedScale;
    }
  }, [zoom]);

  return buttonScale;
};

/** 工具节点是否因权限不可执行（不可见或置灰） */
const useToolPermissionDisabled = (toolType: string) => {
  const toolNodePermission = useFlowStore(s => s.toolNodePermission);
  return useMemo(() => !isToolUsable(toolNodePermission, toolType), [toolNodePermission, toolType]);
};

// 添加处理发送逻辑的hook
const useHandleSend = (id: string, setIsSingleExcute?: (singleExcute: boolean) => void) => {
  const [isExcute, setIsExcute] = useState(false);

  const { excuteSingle, updateNodeStatus } = useFlowStore(state => state.actions);
  const { updateUserPoint, setNeedPoint } = usePointStore(state => state.actions);

  const handleSend = async (serverPoint?: number) => {
    setIsExcute(true);
    setIsSingleExcute?.(true);
    try {
      const res = await excuteSingle(id);
      setNeedPoint(serverPoint ?? 0);

      if (res.type === 'warning') toast.warning(res.content);
      if (res.type === 'success') {
        toast.success(res.content);
        updateNodeStatus(id, 'running');
        updateUserPoint();
      }
    } catch {
      toast.error('执行失败，请重试');
    } finally {
      setIsExcute(false);
    }
  };

  return {
    isExcute,
    handleSend,
  };
};

// 获取节点输入物
const useGetNodeInput = (id: string, nodes: Node[], edges: Edge[]) => {
  const [textMap, setTextMap] = useState<TextInputItem[]>([]);
  const [imageMap, setImageMap] = useState<ImageMapItem[]>([]);
  const [videoMap, setVideoMap] = useState<ImageMapItem[]>([]);
  const [audioMap, setAudioMap] = useState<ImageMapItem[]>([]);
  const [mediaInputs, setMediaInputs] = useState<MediaInputItem[]>([]);
  useEffect(() => {
    const { texts, images, videos, audios, mediaInputs: media } = getSourceMap(nodes, edges, id);
    setTextMap(texts);
    setImageMap(images);
    setVideoMap(videos);
    setAudioMap(audios);
    setMediaInputs(media);
  }, [edges, nodes, id]);
  return {
    textMap,
    imageMap,
    videoMap,
    audioMap,
    mediaInputs,
  };
};

const useCanvasReadOnly = () => {
  const readOnly = useFlowStore(state => state.readOnly);
  return {
    readOnly,
    isPromptViewOnly: readOnly,
    canEditCanvas: !readOnly,
  };
};

/** 顶部 NodeOperation / 组工具栏显隐：只读预览时不展示 */
const useTopNodeToolbarVisible = (baseVisible: boolean) => {
  const readOnly = useFlowStore(state => state.readOnly);
  return !readOnly && baseVisible;
};

export default {
  useDeleteSelection, // 选中项删除（快捷键/工具栏共用）
  useCanvasReadOnly, // 只读画布能力统一读取
  useTopNodeToolbarVisible, // 顶部操作栏显隐（只读时隐藏）
  useKeyboardShortcuts, // 处理键盘事件
  useSelectionLogic, // 处理选择事件
  useHoverWithDelay, // 处理悬浮事件
  useImageNodeDimensions, // 处理图片节点尺寸
  useVideoNodeDimensions, // 处理视频节点尺寸
  usePolling, // 处理轮询逻辑
  useNodeResizeObserver, // 处理节点尺寸变化
  useConfirmDialog, // 处理确认对话框逻辑
  useNodeOperations, // 处理节点操作事件
  useToolOutputChildNodes, // 工具节点输出子节点（预创建/挂载/回写）
  useDragAndDrop, // 拖拽功能
  useStoryboardNodeDrop, // 画布节点拖入分镜表格单元格
  useSinglePointCaculate,
  useNodeCostQuery,
  useGroupPointCaculate, // 计算成批节点赛点
  usePromptModelCommon, // prompt 面板通用逻辑
  useButtonScale, // 计算按钮缩放比例
  useToolPermissionDisabled, // 工具节点权限置灰/隐藏
  useHandleSend, // 处理发送逻辑
  useGetNodeInput, // 获取节点输入物
  useHelperLines, // 拖拽对齐辅助线吸附
  useAutoLayoutMenu, // 一键排列菜单开合与触发布局
};
