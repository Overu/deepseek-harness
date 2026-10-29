// 基础工具方法，不涉及画布逻辑改动
import { getAvailableCapacity } from '@/api/asset';
import { excuteWorkFlow, updateCanvas, saveFlow } from '@/api/workflow';
import type { WorkFlowExcute, CanvasRequestOptions } from '@/api/workflow';
import type { Node, Edge } from '@xyflow/react';
import type { Position, PositionRange } from './util';
import { calcVideoDurationBasedPoints, isVideoDurationPricingModel, normalizeVideoResolution } from '../customNode/video/videoDurationPricing';
import type { VideoPricingContext } from '@/utils/mediaDuration';
import { AudioModelType } from '../customNode/audio/types';
import { loadIntrinsicMediaDimensions } from './mediaDimensionLoader';
import { calculateMediaNodeDimensions, shouldUpdateMediaNodeDimensions } from './mediaDimensions';
import type { MediaDimensionType, MediaNodeMeasuredSize } from './mediaDimensions';
import type { CanvasVersionNumber } from '@/api/workflow';
import { isVersionConflict } from '@/lib/canvasVersionBarrier';
import setting from '../settings/setting';
import type { DownloadZipFileItem } from '@/utils';
import { isCanvasReadOnly } from './canvasReadOnly';

export type { MediaNodeMeasuredSize } from './mediaDimensions';

const { getImageNodeType, getVideoNodeType, getAudioNodeType } = setting;
const DOWNLOADABLE_MEDIA_TYPES = new Set([...getImageNodeType, ...getVideoNodeType, ...getAudioNodeType]);

const defaultWidth = 400; // 节点默认宽度
const defaultHeight = 400; // 节点默认高度
const minHeight = defaultWidth / 2.5; // 根据最大比例 21：9换算
const minWidth = defaultHeight / 2.5; // 根据最大比例 21：9换算

export interface ParamsContent {
  updateNodes?: Array<any>;
  addNodes?: Node[];
  deleteNodeIds?: string[];
  allEdges?: Edge[];
}

interface Params {
  [key: string]: string;
}

const getNodeDataTitle = (node: any) => (typeof node?.data?.title === 'string' ? node.data.title.trim() : '');

const warnDuplicateTitlesInPartialBatch = (updateNodes?: Array<any>, addNodes?: Node[]) => {
  if (!import.meta.env.DEV) return;

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  [...(addNodes || []), ...(updateNodes || [])].forEach(node => {
    const title = getNodeDataTitle(node);
    if (!title) return;
    if (seen.has(title)) {
      duplicates.add(title);
      return;
    }
    seen.add(title);
  });

  if (duplicates.size) {
    console.warn('[canvasFlow] partialUpdate received duplicate node titles in one batch:', Array.from(duplicates));
  }
};

/** 按各类 @ 引用最大序号清理 prompt（如 {{@图片1}}、{{@视频2}}、{{@音频1}}） */
const clearMentionTemplatesByCounts = (input: string, counts: Partial<Record<'图片' | '视频' | '音频', number>>) => {
  if (typeof input !== 'string') {
    return input;
  }

  let result = input;
  (Object.entries(counts) as [string, number | undefined][]).forEach(([labelPrefix, max]) => {
    if (typeof max !== 'number' || max < 0) return;
    const regex = new RegExp(`\\{\\{@${labelPrefix}(\\d+)\\}\\}`, 'g');
    result = result.replace(regex, (match, numStr: string) => {
      const num = Number(numStr);
      return isNaN(num) || num > max ? '' : match;
    });
  });
  return result;
};

// 清除prompt中不支持@的图片（兼容旧调用方：只传图片数量）
const clearTemplatesByValue = (input: string, minValue: number) => {
  if (typeof input !== 'string' || typeof minValue !== 'number') {
    return input;
  }
  return clearMentionTemplatesByCounts(input, { 图片: minValue });
};

// 生成随机的偏移坐标量
const createOffsetPosition = (): Position => {
  const offset = 200; // 偏移范围
  const randomOffset = {
    x: Math.random() * offset * 2 - offset, // -offset 到 +offset 的随机数
    y: Math.random() * offset * 2 - offset,
  };
  return randomOffset;
};

// 根据字段值对对象数组去重
const uniqueByField = (objectArray: Array<any>, fieldName: string) => {
  const seen = new Set();
  return objectArray.filter((object: any) => {
    const value = object[fieldName];
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
};

// 判断日期是否在指定日期之前
const isBeforeDate = (dateStr: string | number, targetDateStr: string): boolean => {
  let actualTime = String(dateStr);
  if (actualTime && actualTime.includes('_')) {
    actualTime = actualTime.split('_')[0];
  }
  const inputDate = new Date(Number(actualTime));
  const targetDate = new Date(targetDateStr);

  return inputDate < targetDate;
};

// 判断是否应该更新节点尺寸
const shouldUpdateNodeDimensions = (currentWidth: number, currentHeight: number, newWidth: number, newHeight: number, threshold: number = 0.01) => {
  return shouldUpdateMediaNodeDimensions(currentWidth, currentHeight, newWidth, newHeight, threshold);
};

// 计算单节点赛点
const calcStringCharCount = (input?: string) => {
  if (!input || typeof input !== 'string') return 0;
  // “字数”按字符计数，严格使用 JS 字符串长度口径
  return input.length;
};

const isParamValueEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return false;
};

const caculateSingleNodePoint = (pointList: Array<any>, params: Params, audioInputTexts?: string[], nodeType?: string, videoPricingContext?: VideoPricingContext) => {
  const modelId = String(params.model || '');
  if (isVideoDurationPricingModel(modelId)) {
    const outputSec = Number(params.duration) || 0;
    if (!outputSec) return 0;
    const resolution = normalizeVideoResolution(params.resolution);
    const { totalInputVideoSec, hasVideoInput } = videoPricingContext ?? { totalInputVideoSec: 0, hasVideoInput: false };
    return calcVideoDurationBasedPoints(modelId, resolution, outputSec, totalInputVideoSec, hasVideoInput);
  }

  const filterParams = ['seniorParams', 'gen_count', 'prompt', 'model', 'modelType'];
  let cost = 0;
  pointList.forEach(point => {
    if (!cost && isParamValueEqual(point.modelId, params.model)) {
      let isMatch = true;
      for (const key in params) {
        if (filterParams.includes(key)) continue;
        if (point[key] && !isParamValueEqual(point[key], params[key])) {
          isMatch = false;
        }
      }
      if (isMatch) {
        cost = point.costPoint;
      }
    }
  });

  const genCount = Number(params.gen_count || 1);
  // 大模型TTS节点单独计费：根据“输入文本字数 + 自身 prompt 字数”，按每满 50 字计费（向上取整）
  if (params?.modelType === AudioModelType.TTS && nodeType === 'audio' && Array.isArray(audioInputTexts)) {
    const inputTextChars = audioInputTexts.reduce((sum, t) => sum + calcStringCharCount(t), 0);
    const promptChars = calcStringCharCount(params.prompt);
    const totalChars = inputTextChars + promptChars;
    const unitCount = totalChars > 0 ? Math.ceil(totalChars / 50) : 0;
    return cost * unitCount * genCount;
  }

  return cost * genCount;
};

// 聚焦到指定节点
const focusOnNodes = (reactFlowInstance: any, nodesToFocus: Node[]) => {
  if (!reactFlowInstance.current || !nodesToFocus.length) return;

  // 计算所有目标节点的边界框
  const nodesBounds = nodesToFocus.reduce(
    (acc, node) => {
      const nodeWidth = node.measured?.width || defaultWidth;
      const nodeHeight = node.measured?.height || defaultHeight;

      acc.minX = Math.min(acc.minX, node.position.x);
      acc.minY = Math.min(acc.minY, node.position.y);
      acc.maxX = Math.max(acc.maxX, node.position.x + nodeWidth);
      acc.maxY = Math.max(acc.maxY, node.position.y + nodeHeight);

      return acc;
    },
    {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    }
  );

  // 计算中心点
  const centerX = (nodesBounds.minX + nodesBounds.maxX) / 2;
  const centerY = (nodesBounds.minY + nodesBounds.maxY) / 2;

  // 计算缩放比例，确保所有节点都可见
  const padding = 0.5; // 与原fitView选项保持一致
  const containerWidth = reactFlowInstance.current.getViewport().width || window.innerWidth;
  const containerHeight = reactFlowInstance.current.getViewport().height || window.innerHeight;

  const contentWidth = nodesBounds.maxX - nodesBounds.minX;
  const contentHeight = nodesBounds.maxY - nodesBounds.minY;

  const scaleX = containerWidth / (contentWidth * (1 + padding));
  const scaleY = containerHeight / (contentHeight * (1 + padding));
  const zoom = Math.min(scaleX, scaleY, 1); // 最大缩放不超过1

  // 设置新的视图位置和缩放
  reactFlowInstance.current.setCenter(centerX, centerY, { zoom, duration: 500 });
};

// 计算节点宽高（maxSize 为较长边上限，默认 defaultWidth）
const caculateNodeMeasured = (width: number, height: number, maxSize: number = defaultWidth) => {
  const dimensions = calculateMediaNodeDimensions({ width, height }, maxSize);
  return {
    newWidth: dimensions?.width ?? maxSize,
    newHeight: dimensions?.height ?? maxSize,
  };
};

const measureMediaNodeSize = async (type: string, url: string): Promise<MediaNodeMeasuredSize | null> => {
  if (type !== 'image' && type !== 'video') return null;

  const intrinsic = await loadIntrinsicMediaDimensions(type as MediaDimensionType, url);
  return intrinsic ? calculateMediaNodeDimensions(intrinsic, defaultWidth) : null;
};

// 计算节点中心位置
const caculateNodesCenter = (parentPositionMap: Record<string, Position>, nodes: Node[]) => {
  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;

  nodes.forEach((item: Node) => {
    let positionX = item.position.x;
    let positionY = item.position.y;
    // 判断是否根据组节点校准位置
    const parentPosition = parentPositionMap[item.id];
    if (parentPosition) {
      positionX = positionX + parentPosition.x;
      positionY = positionY + parentPosition.y;
    }
    minX = Math.min(minX, positionX);
    minY = Math.min(minY, positionY);
    maxX = Math.max(maxX, positionX + (item.measured?.width || defaultWidth));
    maxY = Math.max(maxY, positionY + (item.measured?.height || defaultHeight));
  });

  const nodesCenterX = (minX + maxX) / 2;
  const nodesCenterY = (minY + maxY) / 2;
  return {
    x: nodesCenterX,
    y: nodesCenterY,
  };
};

// 获取节点中x坐标的最大值
const getMaxX = (nodes: Node[]) => {
  if (nodes.length == 0) return 0;
  const maxX = Math.max(...nodes.map(n => n.position.x + (n.measured?.width || defaultWidth)));
  return maxX;
};

// 获取节点中x坐标的最小值
const getMinX = (nodes: Node[]) => {
  if (nodes.length == 0) return 0;
  const minX = Math.min(...nodes.map(n => n.position.x));
  return minX;
};

// 获取节点中y坐标的最大值
const getMaxY = (nodes: Node[]) => {
  if (nodes.length == 0) return 0;
  const maxX = Math.max(...nodes.map(n => n.position.y + (n.measured?.height || defaultHeight)));
  return maxX;
};

// 获取节点中y坐标的最小值
const getMinY = (nodes: Node[]) => {
  if (nodes.length == 0) return 0;
  const minX = Math.min(...nodes.map(n => n.position.y));
  return minX;
};

// 获取当前节点与它父节点的位置映射
const getParentPositionMap = (nodes: Node[], allNodes: Node[]) => {
  const parentPositionMap: Record<string, Position> = {};
  nodes.forEach(node => {
    if (node.parentId && !parentPositionMap[node.id]) {
      allNodes.forEach(item => {
        if (item.id == node.parentId) {
          parentPositionMap[node.id] = item.position;
        }
      });
    }
  });
  return parentPositionMap;
};

// 获取画布中心位置
const getCenterPosition = (instance: any, isOffset: boolean) => {
  // 获取屏幕中心点坐标
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const centerPoint = {
    x: screenWidth / 2,
    y: screenHeight / 2,
  };

  // 转换为画布坐标
  const canvasPosition = instance.screenToFlowPosition(centerPoint);
  if (isOffset) {
    const randomOffset = createOffsetPosition();
    canvasPosition.x = canvasPosition.x + randomOffset.x;
    canvasPosition.y = canvasPosition.y + randomOffset.y;
  }
  return canvasPosition;
};

// 获取多节点形成区域各坐标范围（无 measured 时用默认宽高，避免刚批量添加后立即打组时组宽高为 0 导致组很窄）
const getNodesRange = (selectedNodes: Node[]): PositionRange => {
  const minX = Math.min(...selectedNodes.map(n => n.position.x));
  const minY = Math.min(...selectedNodes.map(n => n.position.y));
  const maxX = Math.max(...selectedNodes.map(n => n.position.x + (n.measured?.width ?? defaultWidth)));
  const maxY = Math.max(...selectedNodes.map(n => n.position.y + (n.measured?.height ?? defaultHeight)));
  return {
    minX,
    minY,
    maxX,
    maxY,
  };
};

// 根据上下文菜单位置或画布中心位置获取节点位置
const getNodePosition = (reactFlowInstance: any, contextMenu?: any) => {
  let canvasPosition = {
    x: 0,
    y: 0,
  };
  if (contextMenu) {
    const position = {
      x: contextMenu.x,
      y: contextMenu.y,
    };
    canvasPosition = reactFlowInstance.current.screenToFlowPosition(position);
  } else {
    canvasPosition = getCenterPosition(reactFlowInstance.current, true);
  }
  return canvasPosition;
};

// 保存画布数据
const saveCanvas = async (canvasId: string, nodes: Node[], edges: Edge[], versionNumber?: CanvasVersionNumber, options?: CanvasRequestOptions, readOnly = isCanvasReadOnly()) => {
  if (readOnly) {
    if (options?.receiptMode === 'agent') throw Object.assign(new Error('画布不可编辑'), { code: 'READ_ONLY', requestPhase: 'not_sent' });
    return Promise.resolve();
  }
  const data = {
    nodes,
    edges,
  };
  if (canvasId) {
    const params = {
      id: canvasId,
      data: JSON.stringify(data),
      version: 'comfyui',
      versionNumber,
    };
    return await saveFlow(params, { silentError: true, ...options });
  }
};

// 单点更新画布
const partialUpdate = (canvasId: string, { updateNodes, addNodes, deleteNodeIds, allEdges }: ParamsContent, versionNumber?: CanvasVersionNumber, options?: CanvasRequestOptions, readOnly = isCanvasReadOnly()) => {
  if (readOnly) {
    if (options?.receiptMode === 'agent') throw Object.assign(new Error('画布不可编辑'), { code: 'READ_ONLY', requestPhase: 'not_sent' });
    return Promise.resolve();
  }
  warnDuplicateTitlesInPartialBatch(updateNodes, addNodes);
  const params: any = {
    id: canvasId,
    updateNodes: updateNodes ? updateNodes.map(node => JSON.stringify(node)) : [],
    addNodes: addNodes ? addNodes.map(node => JSON.stringify(node)) : [],
    deleteNodeIds: deleteNodeIds ? deleteNodeIds : [],
    versionNumber,
  };
  if (allEdges) params.edges = allEdges;
  return updateCanvas(params, { silentError: true, ...options });
};

// 云空间判定
export const showStorageCapacityLimit = async () => {
  const { openStorageLimitDialog } = await import('@/components/common/storageLimitManager');
  openStorageLimitDialog();
};

const isAllowCapacity = async (showCapacityLimit: () => void | Promise<void> = showStorageCapacityLimit, options?: CanvasRequestOptions) => {
  let isAllow = false;
  const res: any = await getAvailableCapacity(options);
  if (res.code === 'SUCCESS') {
    const { usedCapacity, limitCapacity } = res.data;
    if (usedCapacity < limitCapacity) {
      isAllow = true;
    }
  }
  if (!isAllow) {
    await showCapacityLimit();
  }
  return isAllow;
};

// 执行工作流
const excute = async (params: WorkFlowExcute, options?: CanvasRequestOptions) => {
  try {
    const res: any = await excuteWorkFlow(params, options);
    if (res.code === 'SUCCESS') {
      if (options?.receiptMode === 'agent' && (!res.data || typeof res.data !== 'object')) {
        throw Object.assign(new Error('执行接受响应不完整'), { requestPhase: 'sent_unknown', raw: res });
      }
      return {
        type: 'success',
        content: '工作流开始执行，请稍等',
        taskId: res.data.taskId,
        versionNumber: res.data.versionNumber,
      };
    } else {
      return {
        type: 'info',
        content: res.msg,
      };
    }
  } catch (e: any) {
    if (options?.receiptMode === 'agent') throw e;
    if (isVersionConflict(e)) throw e;
    return {
      type: 'info',
      content: e.msg,
    };
  }
};

// 获取与节点完全关联的所有连线
const getEdgesByNodes = (nodes: Node[], edges: Edge[]) => {
  const nodeIds = nodes.map((item: Node) => item.id);
  const relativeEdges: Edge[] = [];
  edges.forEach((item: Edge) => {
    if (nodeIds.includes(item.source) && nodeIds.includes(item.target)) {
      relativeEdges.push(item);
    }
  });
  return relativeEdges;
};

// 获取与节点部分关联的连线
const getRelativeEdgesByNodes = (nodes: Node[], edges: Edge[]) => {
  const nodeIds = nodes.map(item => item.id);
  const relativeEdges: Edge[] = [];
  edges.forEach((item: Edge) => {
    if (nodeIds.includes(item.target) || nodeIds.includes(item.source)) {
      relativeEdges.push(item);
    }
  });
  return relativeEdges;
};

// 获取所有以当前节点作为目标节点的连线
const getInputEdgesByNodes = (nodes: Node[], edges: Edge[]) => {
  const nodeIds = nodes.map(item => item.id);
  const relativeEdges: Edge[] = [];
  edges.forEach((item: Edge) => {
    if (nodeIds.includes(item.target)) {
      relativeEdges.push(item);
    }
  });
  return relativeEdges;
};

// 获取所有以当前节点为目标节点的节点
const getAllSourceNodeIds = (edges: Edge[], nodeId: string): string[] => {
  const sourceNodeIds: string[] = [];
  edges.forEach((item: Edge) => {
    if (item.target === nodeId) sourceNodeIds.push(item.source);
  });
  return sourceNodeIds;
};

// 获取所有以当前节点为起始节点的节点
const getAllTargetNodeIds = (edges: Edge[], nodeId: string): string[] => {
  const targetNodeIds: string[] = [];
  edges.forEach((item: Edge) => {
    if (item.source === nodeId) targetNodeIds.push(item.target);
  });
  return targetNodeIds;
};

// 获取所有节点id对应的节点
const getAllNodeByNodeIds = (nodes: Node[], nodeIds: Array<string>) => {
  const targetNodes: Node[] = [];
  nodes.forEach(item => {
    if (nodeIds.includes(item.id)) {
      targetNodes.push(item);
    }
  });
  return targetNodes;
};

// 获取组内全部子节点
const getGroupAllChild = (nodes: Node[], groupId: string) => {
  const child: Node[] = [];
  nodes.forEach((item: Node) => {
    if (item.parentId == groupId) {
      child.push(item);
    }
  });
  return child;
};

/** 从节点列表收集可下载的图片/视频/音频（data.value 非空） */
const collectDownloadableMediaNodes = (nodes: Node[]): DownloadZipFileItem[] => {
  const result: DownloadZipFileItem[] = [];
  nodes.forEach(node => {
    const nodeType = node.type ?? '';
    if (!DOWNLOADABLE_MEDIA_TYPES.has(nodeType)) return;
    const rawValue = (node.data as { value?: unknown } | undefined)?.value;
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) return;
    const filename = value.split('/')?.pop()?.split('?')[0] || 'download';
    result.push({ url: value, filename });
  });
  return result;
};

/** 删除指定节点后，parent 组内已无子节点时，返回需一并删除的 group id */
const getEmptyGroupIdsAfterDelete = (nodes: Node[], deleteIds: string[]): string[] => {
  const deleteSet = new Set(deleteIds);
  const affectedParentIds = new Set<string>();

  nodes.forEach(node => {
    if (deleteSet.has(node.id) && node.parentId) {
      affectedParentIds.add(node.parentId);
    }
  });

  const emptyGroupIds: string[] = [];
  affectedParentIds.forEach(parentId => {
    const parent = nodes.find(n => n.id === parentId);
    if (!parent || parent.type !== 'group') return;

    const hasRemainingChild = nodes.some(n => n.parentId === parentId && !deleteSet.has(n.id));
    if (!hasRemainingChild) {
      emptyGroupIds.push(parentId);
    }
  });

  return emptyGroupIds;
};

// 获取连线中对应的起始于目标节点
const getNodesByEdge = (nodes: Node[], edge: Edge) => {
  const { source, target } = edge;
  const targetNodeIndex = nodes.findIndex(item => item.id === target);
  const sourceNodeIndex = nodes.findIndex(item => item.id === source);
  const targetNode = nodes[targetNodeIndex];
  const sourceNode = nodes[sourceNodeIndex];
  return {
    targetNode,
    sourceNode,
  };
};

// 获取框选节点的所有入参节点与连线
const getSourceNodesAndEdges = (allNodes: Node[], seletedNodes: Node[], allEdges: Edge[]) => {
  const seletedNodeIds = seletedNodes.map((item: Node) => item.id);
  const sourceNodeIds: string[] = [];
  const sourceNodes: any[] = [];
  const relateEdges: Edge[] = [];
  allEdges.forEach((item: Edge) => {
    if (!seletedNodeIds.includes(item.source) && seletedNodeIds.includes(item.target)) {
      sourceNodeIds.push(item.source);
      relateEdges.push(item);
    }
  });
  allNodes.forEach((item: Node) => {
    if (sourceNodeIds.includes(item.id)) {
      sourceNodes.push({
        ...item,
        isInput: true,
      });
    }
  });
  return {
    sourceNodes,
    relateEdges,
  };
};

/** 焦点在可编辑控件内（input / textarea / contentEditable 等） */
const isEditableShortcutTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  let el: HTMLElement | null = target;
  while (el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
};

/** 页面上存在用户划选的文字（含普通 div 等只读展示文本） */
const hasActiveTextSelection = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  return selection.toString().length > 0;
};

/** 应交给浏览器处理文字选区/输入相关快捷键，不拦截画布快捷键 */
const shouldUseNativeTextInput = (target: EventTarget | null) => isEditableShortcutTarget(target) || hasActiveTextSelection();

/** 解析宽高比字符串，支持 `:` / `：` / `/` */
const parseAspectRatio = (value: string): { w: number; h: number } | null => {
  const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
};

export default {
  defaultWidth, // 节点默认宽度
  defaultHeight, // 节点默认高度
  minHeight, // 节点最小高度
  minWidth, // 节点最小宽度
  // 工具方法
  clearTemplatesByValue, // 清除prompt中不支持@的图片
  clearMentionTemplatesByCounts, // 按图片/视频/音频数量清理 prompt
  createOffsetPosition, // 生成随机的偏移坐标量
  uniqueByField, // 根据字段值对对象数组去重
  isBeforeDate, // 判断日期是否在指定日期之前
  shouldUpdateNodeDimensions, // 判断是否应该更新节点尺寸
  caculateSingleNodePoint, // 计算单节点赛点
  isEditableShortcutTarget, // 焦点是否在可编辑控件内
  hasActiveTextSelection, // 是否存在页面文字选区
  shouldUseNativeTextInput, // 是否应使用浏览器原生文字输入/选区行为
  parseAspectRatio, // 解析宽高比字符串

  // 画布操作
  focusOnNodes, // 聚焦到指定节点

  // 节点位置/宽高方法
  caculateNodeMeasured, // 计算节点宽高
  measureMediaNodeSize, // 计算图片/视频节点展示宽高
  caculateNodesCenter, // 计算节点中心位置
  getMaxX, // 获取节点中x坐标的最大值
  getMinX, // 获取节点中x坐标的最小值
  getMaxY, // 获取节点中y坐标的最大值
  getMinY, // 获取节点中y坐标的最小值
  getParentPositionMap, // 获取当前节点与它父节点的位置映射
  getCenterPosition, // 获取画布中心位置
  getNodesRange, // 获取多节点形成区域各坐标范围
  getNodePosition, // 根据上下文菜单位置或画布中心位置获取节点位置

  // 节点/连线获取方法
  getEdgesByNodes, // 获取与节点完全关联的所有连线
  getRelativeEdgesByNodes, // 获取与节点部分关联的连线
  getInputEdgesByNodes, // 获取所有以当前节点作为目标节点的连线
  getAllSourceNodeIds, // 获取当前节点所有输入节点
  getAllTargetNodeIds, // 获取当前节点所有输出节点
  getAllNodeByNodeIds, // 获取所有节点id对应的节点
  getGroupAllChild, // 获取组内所有子节点
  collectDownloadableMediaNodes, // 收集可下载的图片/视频/音频
  getEmptyGroupIdsAfterDelete, // 删除节点后需连带删除的空组 id
  getNodesByEdge, // 获取连线中对应的节点
  getSourceNodesAndEdges, // 获取框选节点的所有入参节点与连线

  // 接口操作
  partialUpdate, // 单点更新画布
  isAllowCapacity, // 云空间判定
  excute, // 执行工作流
  saveCanvas, // 保存画布数据
};
