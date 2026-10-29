import type { Node, NodePositionChange } from '@xyflow/react';
import toolUtil from './toolUtil';

const { defaultWidth, defaultHeight } = toolUtil;

/** 对齐吸附阈值（px） */
export const HELPER_LINE_SNAP_THRESHOLD = 20;

export type HelperLinesState = {
  horizontal?: number;
  vertical?: number;
};

export type HelperLinesResult = HelperLinesState & {
  snapPosition: { x?: number; y?: number };
};

type NodeBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

const getNodeSize = (node: Node) => ({
  width: node.measured?.width ?? node.width ?? defaultWidth,
  height: node.measured?.height ?? node.height ?? defaultHeight,
});

const toBounds = (position: { x: number; y: number }, width: number, height: number): NodeBounds => ({
  left: position.x,
  right: position.x + width,
  top: position.y,
  bottom: position.y + height,
  centerX: position.x + width / 2,
  centerY: position.y + height / 2,
  width,
  height,
});

const sameParent = (a: Node, b: Node) => (a.parentId || '') === (b.parentId || '');

/**
 * 单节点拖拽时计算对齐辅助线与吸附位置。
 * 仅与同 parentId 的可见节点比较（避免组内相对坐标与画布绝对坐标混比）。
 */
export const getHelperLines = (
  change: Pick<NodePositionChange, 'id' | 'position'>,
  nodes: Node[],
  distance = HELPER_LINE_SNAP_THRESHOLD
): HelperLinesResult => {
  const result: HelperLinesResult = { snapPosition: {} };
  if (!change.position) return result;

  const dragging = nodes.find(n => n.id === change.id);
  if (!dragging) return result;

  const { width, height } = getNodeSize(dragging);
  const A = toBounds(change.position, width, height);

  let bestVerticalDist = distance;
  let bestHorizontalDist = distance;

  for (const other of nodes) {
    if (other.id === change.id) continue;
    if (other.hidden) continue;
    if (!sameParent(dragging, other)) continue;

    const size = getNodeSize(other);
    const B = toBounds(other.position, size.width, size.height);

    // 垂直辅助线（水平基准：左 / 中 / 右对齐）
    const verticalCandidates: Array<{ dist: number; lineX: number; snapX: number }> = [
      { dist: Math.abs(A.left - B.left), lineX: B.left, snapX: B.left },
      { dist: Math.abs(A.centerX - B.centerX), lineX: B.centerX, snapX: B.centerX - A.width / 2 },
      { dist: Math.abs(A.right - B.right), lineX: B.right, snapX: B.right - A.width },
    ];
    for (const c of verticalCandidates) {
      if (c.dist < bestVerticalDist) {
        bestVerticalDist = c.dist;
        result.vertical = c.lineX;
        result.snapPosition.x = c.snapX;
      }
    }

    // 水平辅助线（垂直基准：上 / 中 / 下对齐）
    const horizontalCandidates: Array<{ dist: number; lineY: number; snapY: number }> = [
      { dist: Math.abs(A.top - B.top), lineY: B.top, snapY: B.top },
      { dist: Math.abs(A.centerY - B.centerY), lineY: B.centerY, snapY: B.centerY - A.height / 2 },
      { dist: Math.abs(A.bottom - B.bottom), lineY: B.bottom, snapY: B.bottom - A.height },
    ];
    for (const c of horizontalCandidates) {
      if (c.dist < bestHorizontalDist) {
        bestHorizontalDist = c.dist;
        result.horizontal = c.lineY;
        result.snapPosition.y = c.snapY;
      }
    }
  }

  return result;
};

/** 比较辅助线状态是否变化（避免无意义 setState） */
export const helperLinesEqual = (a: HelperLinesState, b: HelperLinesState) => a.horizontal === b.horizontal && a.vertical === b.vertical;
