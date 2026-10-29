import type { Edge, Node } from '@xyflow/react';
import setting from '../settings/setting';

const { nodeTitleMap } = setting;

export type NodeTitleAssignMode = 'auto' | 'copy' | 'template' | 'none';

export type NodeTitleValidationResult = { ok: true; title: string } | { ok: false; reason: 'empty' | 'duplicate' | 'missing' };

type NodeWithTitleAssignment = Node & {
  titleAssignment?: 'preserve';
};

type AssignNodeTitlesParams = {
  existingNodes: Node[];
  existingEdges?: Edge[];
  nodesToAdd: Node[];
  edgesToAdd?: Edge[];
  mode: NodeTitleAssignMode;
};

const isToolNode = (node?: Node) => Boolean(node?.type?.includes('Tool'));

const shouldManageTitle = (node: Node) => node.type !== 'group';

const normalizeTitle = (title: unknown) => (typeof title === 'string' ? title.trim() : '');

const getNodeTitle = (node?: Node) => normalizeTitle(node?.data?.title);

const getDefaultTitle = (type?: string) => {
  if (type && Object.prototype.hasOwnProperty.call(nodeTitleMap, type)) {
    return nodeTitleMap[type as keyof typeof nodeTitleMap];
  }
  return '未命名';
};

const buildOccupiedTitles = (nodes: Node[], excludeNodeIds: Set<string>) => {
  const occupiedTitles = new Set<string>();
  nodes.forEach(node => {
    if (excludeNodeIds.has(node.id)) return;
    const title = getNodeTitle(node);
    if (title) occupiedTitles.add(title);
  });
  return occupiedTitles;
};

const buildTypeCounts = (nodes: Node[]) => {
  const typeCounts = new Map<string, number>();
  nodes.forEach(node => {
    if (!node.type || node.type === 'group') return;
    typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
  });
  return typeCounts;
};

const buildToolChildCounts = (nodes: Node[], edges: Edge[]) => {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const counts = new Map<string, number>();

  edges.forEach(edge => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!isToolNode(sourceNode) || !targetNode?.type || targetNode.type === 'group') return;
    const key = getToolChildKey(edge.source, targetNode.type);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return counts;
};

const getToolChildKey = (sourceNodeId: string, childType: string) => `${sourceNodeId}:${childType}`;

const resolveUniqueTitle = (base: string, start: number, occupiedTitles: Set<string>) => {
  let index = Math.max(start, 1);
  let candidate = `${base}${index}`;

  while (occupiedTitles.has(candidate)) {
    index += 1;
    candidate = `${base}${index}`;
  }

  occupiedTitles.add(candidate);
  return candidate;
};

const resolveCopyTitle = (base: string, occupiedTitles: Set<string>) => {
  let index = 1;
  let candidate = base;

  while (occupiedTitles.has(candidate)) {
    index += 1;
    candidate = `${base}${index}`;
  }

  occupiedTitles.add(candidate);
  return candidate;
};

/** 保留自定义 title；冲突时追加 -2、-3…（与宫格裁切一致） */
const resolvePreservedTitle = (base: string, occupiedTitles: Set<string>) => {
  let index = 1;
  let candidate = base;

  while (occupiedTitles.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}`;
  }

  occupiedTitles.add(candidate);
  return candidate;
};

/** 标记节点在 assignNodeTitles(auto) 时保留 data.title，避免被工具子节点 auto 命名覆盖 */
export const preserveNodeTitle = <T extends Node>(node: T): T => ({
  ...node,
  titleAssignment: 'preserve',
});

export const assignNodeTitles = ({ existingNodes, existingEdges = [], nodesToAdd, edgesToAdd = [], mode }: AssignNodeTitlesParams) => {
  if (mode === 'template' || mode === 'none') {
    return nodesToAdd.map(input => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { titleAssignment, ...rest } = input as NodeWithTitleAssignment;
      const node = rest as Node;
      return { ...node, data: node.data ? { ...node.data } : node.data };
    });
  }

  const addNodeIds = new Set(nodesToAdd.map(node => node.id));
  const occupiedTitles = buildOccupiedTitles(existingNodes, addNodeIds);
  const typeCounts = buildTypeCounts(existingNodes);
  const allNodes = [...existingNodes, ...nodesToAdd];
  const nodeMap = new Map(allNodes.map(node => [node.id, node]));
  const edgeByTarget = new Map(edgesToAdd.map(edge => [edge.target, edge]));
  const toolChildCounts = buildToolChildCounts(existingNodes, existingEdges);

  return nodesToAdd.map(input => {
    const { titleAssignment, ...rest } = input as NodeWithTitleAssignment;
    const node = rest as Node;

    if (!shouldManageTitle(node)) return { ...node, data: node.data ? { ...node.data } : node.data };

    if (titleAssignment === 'preserve') {
      const title = resolvePreservedTitle(getNodeTitle(node) || getDefaultTitle(node.type), occupiedTitles);
      return { ...node, data: { ...node.data, title } };
    }

    if (mode === 'copy') {
      const originTitle = getNodeTitle(node) || getDefaultTitle(node.type);
      const title = resolveCopyTitle(`${originTitle}-副本`, occupiedTitles);
      return {
        ...node,
        data: {
          ...node.data,
          title,
        },
      };
    }

    const sourceEdge = edgeByTarget.get(node.id);
    const sourceNode = sourceEdge ? nodeMap.get(sourceEdge.source) : undefined;

    if (sourceEdge && isToolNode(sourceNode) && node.type) {
      const key = getToolChildKey(sourceEdge.source, node.type);
      const nextIndex = (toolChildCounts.get(key) || 0) + 1;
      toolChildCounts.set(key, nextIndex);
      return {
        ...node,
        data: {
          ...node.data,
          title: `${getNodeTitle(sourceNode) || getDefaultTitle(sourceNode?.type)}-${getDefaultTitle(node.type)}${nextIndex}`,
        },
      };
    }

    const baseTitle = getDefaultTitle(node.type);
    const nextIndex = (typeCounts.get(node.type || '') || 0) + 1;
    typeCounts.set(node.type || '', nextIndex);
    const title = resolveUniqueTitle(baseTitle, nextIndex, occupiedTitles);

    return {
      ...node,
      data: {
        ...node.data,
        title,
      },
    };
  });
};

export const validateNodeTitle = ({ existingNodes, nodeId, nextTitle }: { existingNodes: Node[]; nodeId: string; nextTitle: string }): NodeTitleValidationResult => {
  const title = normalizeTitle(nextTitle);

  if (!title) {
    return { ok: false, reason: 'empty' };
  }

  const currentNode = existingNodes.find(node => node.id === nodeId);
  if (!currentNode) {
    return { ok: false, reason: 'missing' };
  }

  const isDuplicate = existingNodes.some(node => node.id !== nodeId && normalizeTitle(node.data?.title) === title);
  if (isDuplicate) {
    return { ok: false, reason: 'duplicate' };
  }

  return { ok: true, title };
};
