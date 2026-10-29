import type { Node } from '@xyflow/react';
import { CanvasAgentError, type NodePlacement } from '../../src/shared/canvas-agent-protocol';
import { AUTO_LAYOUT_GAP_X, layoutSelectedNodes } from '../legacy/src/components/canvasFlow/utils/autoLayout';
import { getCompleteMediaNodeDimensions } from '../legacy/src/components/canvasFlow/utils/mediaDimensions';
import toolUtil from '../legacy/src/components/canvasFlow/utils/toolUtil';

type Point = { x: number; y: number };
export type AgentNodeGeometry = { position: Point; size: { width: number; height: number }; parentId: string | null };
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
function point(position: Point): Point {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new CanvasAgentError('INVALID_ARGUMENT', '节点坐标必须是有限数值');
  }
  return { x: position.x, y: position.y };
}

/** Local coordinates, with the same measured-pair priority as native media sizing. */
export function getAgentNodeGeometry(node: Node): AgentNodeGeometry {
  const complete = getCompleteMediaNodeDimensions(node);
  const size = { width: complete?.width ?? toolUtil.defaultWidth, height: complete?.height ?? toolUtil.defaultHeight };
  if (node.type === 'group') {
    if (positive(node.style?.width)) size.width = node.style.width;
    if (positive(node.style?.height)) size.height = node.style.height;
  }
  return { position: point(node.position), size, parentId: node.parentId || null };
}

function worldPosition(node: Node, byId: Map<string, Node>): Point {
  let current = node;
  let position = point(current.position);
  const visited = new Set<string>([current.id]);
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent || visited.has(parent.id)) {
      throw new CanvasAgentError('INVALID_ARGUMENT', '节点所属组不存在或组层级包含循环');
    }
    visited.add(parent.id);
    const parentPosition = point(parent.position);
    position = point({ x: position.x + parentPosition.x, y: position.y + parentPosition.y });
    current = parent;
  }
  return position;
}

function automaticOrigin(existingNodes: Node[]): Point {
  if (existingNodes.length === 0) return { x: 0, y: 0 };
  const byId = new Map(existingNodes.map(node => [node.id, node]));
  let right = -Infinity;
  let top = Infinity;
  // Include both group boxes and child boxes, including children beyond the group boundary.
  for (const node of existingNodes) {
    const { size } = getAgentNodeGeometry(node);
    const position = worldPosition(node, byId);
    right = Math.max(right, position.x + size.width);
    top = Math.min(top, position.y);
  }
  return point({ x: right + AUTO_LAYOUT_GAP_X, y: top });
}

function anchorOrigin(existingNodes: Node[], anchorNodeId: string): Point {
  const byId = new Map(existingNodes.map(node => [node.id, node]));
  const anchor = byId.get(anchorNodeId);
  if (!anchor) throw new CanvasAgentError('NODE_NOT_FOUND', '放置锚点节点已不存在');
  const { size } = getAgentNodeGeometry(anchor);
  const position = worldPosition(anchor, byId);
  // Nearby extension intentionally does not move or avoid unrelated existing content.
  return point({ x: position.x + size.width + AUTO_LAYOUT_GAP_X, y: position.y });
}

function gridBatch(nodes: Node[]): Node[] {
  if (nodes.length < 2) return nodes;
  const sized = nodes.map(node => {
    const { size } = getAgentNodeGeometry(node);
    return { ...node, position: { x: 0, y: 0 }, measured: { ...node.measured, ...size } };
  });
  const positions = new Map(layoutSelectedNodes(sized, [], sized, 'grid').map(update => [update.id, update.position]));
  return nodes.map(node => ({ ...node, position: point(positions.get(node.id) ?? node.position) }));
}

/** Agent additions only. Call after native size preparation, within the guarded Agent mutation. */
export function placeAgentNodes(newNodes: Node[], existingNodes: Node[], placement: NodePlacement): Node[] {
  if (newNodes.length === 0) return [];
  for (const node of newNodes) {
    if (node.parentId || node.type === 'group') {
      throw new CanvasAgentError('INVALID_ARGUMENT', '本期自动放置仅支持新增顶层普通节点');
    }
    getAgentNodeGeometry(node);
  }
  const origin = placement.mode === 'absolute' ? point(placement.position)
    : placement.mode === 'after' ? anchorOrigin(existingNodes, placement.anchorNodeId)
    : automaticOrigin(existingNodes);
  // Explicit placement preserves the batch's relative layout; automatic placement uses native grid.
  const arranged = placement.mode === 'absolute' ? newNodes : gridBatch(newNodes);
  const minX = Math.min(...arranged.map(node => node.position.x));
  const minY = Math.min(...arranged.map(node => node.position.y));
  return arranged.map(node => ({
    ...node,
    position: point({ x: origin.x + (node.position.x - minX), y: origin.y + (node.position.y - minY) }),
  }));
}
