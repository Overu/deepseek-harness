import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import toolUtil from './toolUtil';

const { defaultWidth, defaultHeight, getNodesRange } = toolUtil;

export const AUTO_LAYOUT_GAP_X = 120;
export const AUTO_LAYOUT_GAP_Y = 80;
/** 组内排版留白（与 creatGroupNode 一致） */
const GROUP_INNER_PADDING = 50;
const GROUP_OUTER_PADDING = 50;

export type LayoutPositionUpdate = {
  id: string;
  position?: { x: number; y: number };
  style?: { width?: number; height?: number };
};

export type LayoutMode = 'grid' | 'vertical' | 'horizontal';

type LayoutPartition = {
  groupId: string | null;
  nodes: Node[];
};

const getNodeSize = (node: Node) => ({
  width: node.measured?.width ?? node.width ?? defaultWidth,
  height: node.measured?.height ?? node.height ?? defaultHeight,
});

/** 选中组内任一子节点时，扩展为同组全部子节点 */
export const expandSelectionForLayout = (selectedNodes: Node[], allNodes: Node[]): Node[] => {
  const byId = new Map<string, Node>();

  const addNode = (node: Node) => {
    const latest = allNodes.find(item => item.id === node.id) || node;
    if (latest.type === 'group') return;
    byId.set(latest.id, latest);
  };

  for (const node of selectedNodes) {
    const latest = allNodes.find(item => item.id === node.id) || node;
    if (latest.type === 'group') {
      allNodes.filter(item => item.parentId === latest.id).forEach(addNode);
      continue;
    }
    if (latest.parentId) {
      allNodes.filter(item => item.parentId === latest.parentId).forEach(addNode);
      continue;
    }
    addNode(latest);
  }

  return [...byId.values()];
};

const getLayoutPartitions = (expandedNodes: Node[]): LayoutPartition[] => {
  const topLevel: Node[] = [];
  const groupMap = new Map<string, Node[]>();

  for (const node of expandedNodes) {
    if (node.parentId) {
      if (!groupMap.has(node.parentId)) groupMap.set(node.parentId, []);
      groupMap.get(node.parentId)!.push(node);
    } else {
      topLevel.push(node);
    }
  }

  const partitions: LayoutPartition[] = [];
  if (topLevel.length >= 2) partitions.push({ groupId: null, nodes: topLevel });
  for (const [groupId, nodes] of groupMap) {
    if (nodes.length >= 2) partitions.push({ groupId, nodes });
  }
  return partitions;
};

const applyAnchorShift = (updates: LayoutPositionUpdate[], nodes: Node[], anchorX: number, anchorY: number) => {
  if (updates.length === 0) return updates;

  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const positionedNodes = updates
    .filter(item => item.position)
    .map(item => ({
      ...(nodeById.get(item.id) || { id: item.id }),
      position: item.position!,
    })) as Node[];

  const range = getNodesRange(positionedNodes);
  const dx = anchorX - range.minX;
  const dy = anchorY - range.minY;

  return updates.map(item => ({
    ...item,
    position: item.position
      ? {
          x: item.position.x + dx,
          y: item.position.y + dy,
        }
      : undefined,
  }));
};

const sortNodesByCanvasOrder = (nodes: Node[], allNodes: Node[]) => {
  const indexMap = new Map(allNodes.map((node, index) => [node.id, index]));
  return [...nodes].sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));
};

const getRelevantEdges = (nodes: Node[], edges: Edge[]) => {
  const ids = new Set(nodes.map(node => node.id));
  return edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);
};

const layoutGridNodeSet = (nodes: Node[]): LayoutPositionUpdate[] => {
  if (nodes.length < 2) return [];

  const columns = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);

  nodes.forEach((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const { width, height } = getNodeSize(node);
    columnWidths[col] = Math.max(columnWidths[col], width);
    rowHeights[row] = Math.max(rowHeights[row], height);
  });

  const columnStartX: number[] = [];
  const rowStartY: number[] = [];
  let currentX = 0;
  let currentY = 0;

  columnWidths.forEach(width => {
    columnStartX.push(currentX);
    currentX += width + AUTO_LAYOUT_GAP_X;
  });
  rowHeights.forEach(height => {
    rowStartY.push(currentY);
    currentY += height + AUTO_LAYOUT_GAP_Y;
  });

  return nodes.map((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: node.id,
      position: {
        x: columnStartX[col],
        y: rowStartY[row],
      },
    };
  });
};

/** dagre 有向排版：纵向 TB / 横向 LR，仅 rankdir 不同 */
const layoutDirectedNodeSet = (nodes: Node[], edges: Edge[], rankdir: 'TB' | 'LR'): LayoutPositionUpdate[] => {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [
      {
        id: nodes[0].id,
        position: { x: 0, y: 0 },
      },
    ];
  }

  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir });

  const relevantEdges = getRelevantEdges(nodes, edges);
  nodes.forEach(node => {
    const { width, height } = getNodeSize(node);
    graph.setNode(node.id, { width, height });
  });
  relevantEdges.forEach(edge => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return nodes.map(node => {
    const dagreNode = graph.node(node.id);
    const { width, height } = getNodeSize(node);
    return {
      id: node.id,
      position: {
        x: dagreNode.x - width / 2,
        y: dagreNode.y - height / 2,
      },
    };
  });
};

const layoutNodeSetByMode = (nodes: Node[], edges: Edge[], anchorX: number, anchorY: number, mode: LayoutMode): LayoutPositionUpdate[] => {
  if (nodes.length < 2) return [];

  if (mode === 'grid') {
    return applyAnchorShift(layoutGridNodeSet(nodes), nodes, anchorX, anchorY);
  }

  const rankdir = mode === 'vertical' ? 'TB' : 'LR';
  return applyAnchorShift(layoutDirectedNodeSet(nodes, edges, rankdir), nodes, anchorX, anchorY);
};

const normalizeGroupChildUpdates = (updates: LayoutPositionUpdate[]): LayoutPositionUpdate[] => {
  if (updates.length === 0) return updates;

  let minX = Infinity;
  let minY = Infinity;

  for (const item of updates) {
    if (!item.position) continue;
    minX = Math.min(minX, item.position.x);
    minY = Math.min(minY, item.position.y);
  }

  const shiftX = GROUP_INNER_PADDING - minX;
  const shiftY = GROUP_INNER_PADDING - minY;

  return updates.map(item => ({
    ...item,
    position: item.position
      ? {
          x: item.position.x + shiftX,
          y: item.position.y + shiftY,
        }
      : undefined,
  }));
};

const buildGroupStyleUpdate = (groupId: string, childUpdates: LayoutPositionUpdate[], nodes: Node[]): LayoutPositionUpdate | null => {
  if (childUpdates.length === 0) return null;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const positionedNodes = childUpdates
    .filter(item => item.position)
    .map(item => ({
      ...(nodeById.get(item.id) || { id: item.id }),
      position: item.position!,
    })) as Node[];
  const range = getNodesRange(positionedNodes);

  return {
    id: groupId,
    style: {
      width: range.maxX - range.minX + GROUP_OUTER_PADDING * 2,
      height: range.maxY - range.minY + GROUP_OUTER_PADDING * 2,
    },
  };
};

/** React Flow 要求父节点在子节点之前 */
export const sortNodesParentFirst = (nodes: Node[]): Node[] => {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const added = new Set<string>();
  const result: Node[] = [];

  const append = (node: Node) => {
    if (added.has(node.id)) return;
    if (node.parentId && byId.has(node.parentId)) append(byId.get(node.parentId)!);
    added.add(node.id);
    result.push(node);
  };

  nodes.forEach(append);
  return result;
};

/**
 * 多选节点一键排版：宫格 / 纵向 / 横向 三种业务规则。
 * 支持组内相对坐标排版并自动更新组宽高。
 */
export const layoutSelectedNodes = (selectedNodes: Node[], edges: Edge[], allNodes: Node[], mode: LayoutMode): LayoutPositionUpdate[] => {
  const expanded = sortNodesByCanvasOrder(expandSelectionForLayout(selectedNodes, allNodes), allNodes);
  const partitions = getLayoutPartitions(expanded);
  if (partitions.length === 0) return [];

  const allUpdates: LayoutPositionUpdate[] = [];

  for (const partition of partitions) {
    if (partition.groupId) {
      const orderedChildren = sortNodesByCanvasOrder(partition.nodes, allNodes);
      const childUpdates = layoutNodeSetByMode(orderedChildren, edges, 0, 0, mode);
      const normalizedChildren = normalizeGroupChildUpdates(childUpdates);
      allUpdates.push(...normalizedChildren);

      const groupStyleUpdate = buildGroupStyleUpdate(partition.groupId, normalizedChildren, partition.nodes);
      if (groupStyleUpdate) allUpdates.push(groupStyleUpdate);
      continue;
    }

    const orderedNodes = sortNodesByCanvasOrder(partition.nodes, allNodes);
    const range = getNodesRange(orderedNodes);
    allUpdates.push(...layoutNodeSetByMode(orderedNodes, edges, range.minX, range.minY, mode));
  }

  return allUpdates;
};
