import { v4 as uuidv4 } from 'uuid';
import type { Edge, Node } from '@xyflow/react';
import setting from '../settings/setting';
import util from './util';

const { handlersMap, handlerColorMap } = setting;
const { validateConnection, isAllowHandler, calibrateEdge, dealEdge } = util;

/** 与画布 ReactFlow `connectionRadius` 对齐 */
export const MULTI_CONNECT_SNAP_RADIUS = 100;

export type SnappedTarget = {
  nodeId: string;
  handleId: string;
  clientX: number;
  clientY: number;
  element: Element;
};

export type SourceHandleAnchor = {
  nodeId: string;
  handleId: string;
  x: number;
  y: number;
  color: string;
};

export type PreparedEdgeResult = {
  edges: Edge[];
  failed: Edge[];
};

/** 取节点默认 source 句柄 id（右侧输出） */
export const getDefaultSourceHandle = (node: Node): string | undefined => {
  const type = String(node.type || '');
  const handlers = handlersMap[type as keyof typeof handlersMap] as Array<{ type: string; id: string }> | undefined;
  const source = handlers?.find(h => h.type === 'source');
  if (source?.id) return source.id;
  if (['text', 'image', 'video', 'audio'].includes(type)) return `${type}_source`;
  return undefined;
};

/** 句柄 limit（undefined 表示无限制） */
export const getHandleLimit = (nodeType: string | undefined, handleId: string | null | undefined): number | undefined => {
  if (!nodeType || !handleId) return undefined;
  const handlers = handlersMap[nodeType as keyof typeof handlersMap] as Array<{ id: string; limit?: number }> | undefined;
  return handlers?.find(h => h.id === handleId)?.limit;
};

/** 屏幕坐标下最近的 target 句柄（不做类型过滤） */
export const findClosestTargetHandle = (clientX: number, clientY: number, radius: number, excludeNodeIds: Set<string>): SnappedTarget | null => {
  const handles = document.querySelectorAll('.react-flow__handle.target, .react-flow__handle-left.target, .react-flow__handle[data-handlepos="left"]');
  let best: SnappedTarget | null = null;
  let bestDist = radius;

  handles.forEach(el => {
    const htmlEl = el as HTMLElement;
    // 仅 target 句柄
    if (!htmlEl.classList.contains('target') && htmlEl.dataset.handlepos !== 'left') return;
    if (htmlEl.classList.contains('source')) return;

    const nodeId = htmlEl.getAttribute('data-nodeid') || htmlEl.dataset.nodeid || '';
    const handleId = htmlEl.getAttribute('data-handleid') || htmlEl.dataset.handleid || '';
    if (!nodeId || !handleId) return;
    if (excludeNodeIds.has(nodeId)) return;

    const rect = htmlEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(cx - clientX, cy - clientY);
    if (dist <= bestDist) {
      bestDist = dist;
      best = { nodeId, handleId, clientX: cx, clientY: cy, element: el };
    }
  });

  return best;
};

/** 屏幕点下的节点 id（排除选中源） */
export const findNodeAtPoint = (clientX: number, clientY: number, excludeNodeIds: Set<string>): string | null => {
  const els = document.elementsFromPoint(clientX, clientY);
  for (const el of els) {
    const nodeEl = (el as HTMLElement).closest?.('.react-flow__node') as HTMLElement | null;
    if (!nodeEl) continue;
    const nodeId = nodeEl.getAttribute('data-id') || nodeEl.dataset.id || '';
    if (!nodeId || excludeNodeIds.has(nodeId)) continue;
    if (nodeEl.classList.contains('react-flow__node-group')) continue;
    return nodeId;
  }
  return null;
};

/** 选中节点各 source 句柄的屏幕中心 */
export const getSourceHandleScreenAnchors = (nodeIds: string[]): SourceHandleAnchor[] => {
  const anchors: SourceHandleAnchor[] = [];
  nodeIds.forEach(nodeId => {
    const nodeEl = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    if (!nodeEl) return;
    const sourceHandle =
      (nodeEl.querySelector('.react-flow__handle.source') as HTMLElement | null) ||
      (nodeEl.querySelector('.react-flow__handle-right') as HTMLElement | null) ||
      (nodeEl.querySelector('.react-flow__handle[data-handlepos="right"]') as HTMLElement | null);
    if (!sourceHandle) {
      // 无句柄时用节点右侧中点
      const rect = nodeEl.getBoundingClientRect();
      anchors.push({
        nodeId,
        handleId: '',
        x: rect.right,
        y: rect.top + rect.height / 2,
        color: '#b1b1b7',
      });
      return;
    }
    const handleId = sourceHandle.getAttribute('data-handleid') || sourceHandle.dataset.handleid || '';
    const rect = sourceHandle.getBoundingClientRect();
    anchors.push({
      nodeId,
      handleId,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      color: handlerColorMap[handleId as keyof typeof handlerColorMap] || '#b1b1b7',
    });
  });
  return anchors;
};

export const buildBezierPath = (fromX: number, fromY: number, toX: number, toY: number) => {
  const curvature = 0.25;
  const offsetX = Math.abs(toX - fromX) * curvature;
  const offsetY = Math.abs(toY - fromY) * curvature;
  const controlX1 = fromX + offsetX;
  const controlY1 = fromY + offsetY;
  const controlX2 = toX - offsetX;
  const controlY2 = toY - offsetY;
  return `M ${fromX},${fromY} C ${controlX1},${controlY1} ${controlX2},${controlY2} ${toX},${toY}`;
};

const SNAP_CLASS = 'multi-connect-snap';

export const setSnapHandleHighlight = (prev: Element | null, next: Element | null) => {
  if (prev && prev !== next) prev.classList.remove(SNAP_CLASS);
  if (next) next.classList.add(SNAP_CLASS);
  return next;
};

export const clearSnapHandleHighlight = (el: Element | null) => {
  el?.classList.remove(SNAP_CLASS);
};

/** 构造并校验多源 → 共同目标的边（含 limit 递增计数） */
export const prepareMultiConnectEdges = (sourceNodes: Node[], targetId: string, allNodes: Node[], allEdges: Edge[], preferredTargetHandle?: string | null): PreparedEdgeResult => {
  const edges: Edge[] = [];
  const failed: Edge[] = [];
  const workingEdges = [...allEdges];
  const targetNode = allNodes.find(n => n.id === targetId);

  sourceNodes.forEach(sourceNode => {
    const sourceHandle = getDefaultSourceHandle(sourceNode);
    const typePrefix = sourceHandle?.split('_')[0] || String(sourceNode.type || '');
    const draft: Edge = {
      id: uuidv4(),
      source: sourceNode.id,
      target: targetId,
      sourceHandle,
      targetHandle: preferredTargetHandle || (typePrefix ? `${typePrefix}_target` : undefined),
    };

    if (!sourceHandle || !validateConnection(draft, allNodes)) {
      failed.push(draft);
      return;
    }

    const edgeToAdd = { ...draft };
    if (!isAllowHandler(edgeToAdd)) {
      if (!targetNode || !calibrateEdge(targetNode, edgeToAdd)) {
        failed.push(draft);
        return;
      }
    }

    const limit = getHandleLimit(targetNode?.type, edgeToAdd.targetHandle);
    if (limit != null) {
      const used = workingEdges.filter(e => e.target === targetId && e.targetHandle === edgeToAdd.targetHandle).length;
      if (used >= limit) {
        failed.push(draft);
        return;
      }
    }

    // 已存在同 source-target-handles 边则跳过为失败
    const dup = workingEdges.some(
      e => e.source === edgeToAdd.source && e.target === edgeToAdd.target && e.sourceHandle === edgeToAdd.sourceHandle && e.targetHandle === edgeToAdd.targetHandle
    );
    if (dup) {
      failed.push(draft);
      return;
    }

    const finalized = dealEdge(edgeToAdd);
    edges.push(finalized);
    workingEdges.push(finalized);
  });

  return { edges, failed };
};
