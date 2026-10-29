import { cloneSerializable } from '@/utils';
import type { Edge, Node } from '@xyflow/react';
import { v4 as uuidv4 } from 'uuid';
export type PersonalWorkflowCoverCandidate = { kind: 'image' | 'video'; url: string } | { kind: 'text' | 'audio' } | { kind: 'default' };

const getNodeCreateTime = (node: Node) => {
  const rawTime = node.data?.time;
  const lastPart = String(rawTime ?? '')
    .split('_')
    .at(-1);
  const timestamp = Number(lastPart);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
};

const getAbsolutePosition = (node: Node, nodeMap: Map<string, Node>) => {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  const visited = new Set<string>();

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodeMap.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  return { x, y };
};

const sortParentsBeforeChildren = (nodes: Node[]) => {
  const nodeIds = new Set(nodes.map(node => node.id));
  const depthCache = new Map<string, number>();
  const getDepth = (node: Node): number => {
    const cached = depthCache.get(node.id);
    if (cached !== undefined) return cached;
    const parent = node.parentId ? nodes.find(item => item.id === node.parentId) : undefined;
    const depth = parent && nodeIds.has(parent.id) ? getDepth(parent) + 1 : 0;
    depthCache.set(node.id, depth);
    return depth;
  };

  return [...nodes].sort((a, b) => getDepth(a) - getDepth(b));
};

const getNodeSize = (node: Node) => {
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : Number.parseFloat(String(node.style?.width || ''));
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : Number.parseFloat(String(node.style?.height || ''));
  return {
    width: node.measured?.width ?? node.width ?? (Number.isFinite(styleWidth) ? styleWidth : 400),
    height: node.measured?.height ?? node.height ?? (Number.isFinite(styleHeight) ? styleHeight : 400),
  };
};

const ensureSingleTopLevelGroup = (nodes: Node[]) => {
  const topLevelNodes = nodes.filter(node => !node.parentId);
  if (!topLevelNodes.length) return nodes;
  if (topLevelNodes.length === 1 && topLevelNodes[0].type === 'group') {
    const [groupNode] = topLevelNodes;
    groupNode.position = { x: 0, y: 0 };
    return nodes;
  }

  const minX = Math.min(...topLevelNodes.map(node => node.position.x));
  const minY = Math.min(...topLevelNodes.map(node => node.position.y));
  const maxX = Math.max(...topLevelNodes.map(node => node.position.x + getNodeSize(node).width));
  const maxY = Math.max(...topLevelNodes.map(node => node.position.y + getNodeSize(node).height));
  const groupId = uuidv4();
  topLevelNodes.forEach(node => {
    node.parentId = groupId;
    node.extent = 'parent';
    node.position = {
      x: node.position.x - minX + 50,
      y: node.position.y - minY + 50,
    };
  });

  const groupNode: Node = {
    id: groupId,
    type: 'group',
    position: { x: 0, y: 0 },
    style: {
      width: maxX - minX + 100,
      height: maxY - minY + 100,
    },
    data: {
      time: Date.now(),
      title: '组',
      taskInfo: { status: 'success' },
    },
  };

  return [groupNode, ...nodes];
};

export const buildPersonalWorkflowSubgraph = (allNodes: Node[], allEdges: Edge[], rootNodeIds: string[]) => {
  const nodeMap = new Map(allNodes.map(node => [node.id, node]));
  const includedIds = new Set(rootNodeIds.filter(id => nodeMap.has(id)));

  let addedChild = true;
  while (addedChild) {
    addedChild = false;
    allNodes.forEach(node => {
      if (node.parentId && includedIds.has(node.parentId) && !includedIds.has(node.id)) {
        includedIds.add(node.id);
        addedChild = true;
      }
    });
  }

  const selectedNodes = allNodes.filter(node => includedIds.has(node.id));
  const normalizedNodes = selectedNodes.map(node => {
    const nextNode = cloneSerializable(node);
    nextNode.selected = false;
    nextNode.dragging = false;
    nextNode.data = {
      ...nextNode.data,
      taskInfo: {
        status: 'success',
      },
    };

    if (nextNode.parentId && !includedIds.has(nextNode.parentId)) {
      nextNode.position = getAbsolutePosition(node, nodeMap);
      nextNode.parentId = undefined;
      nextNode.extent = undefined;
    }

    return nextNode;
  });

  const groupedNodes = ensureSingleTopLevelGroup(normalizedNodes);

  const edges = allEdges
    .filter(edge => includedIds.has(edge.source) && includedIds.has(edge.target))
    .map(edge => ({
      ...cloneSerializable(edge),
      selected: false,
    }));

  return {
    nodes: sortParentsBeforeChildren(groupedNodes),
    edges,
  };
};

export const getPersonalWorkflowCoverCandidate = (nodes: Node[]): PersonalWorkflowCoverCandidate => {
  const contentNodes = nodes.filter(node => node.type !== 'group').sort((a, b) => getNodeCreateTime(a) - getNodeCreateTime(b));
  const mediaNode = contentNodes.find(node => {
    const value = typeof node.data?.value === 'string' ? node.data.value.trim() : '';
    return (node.type === 'image' || node.type === 'video') && Boolean(value);
  });

  if (mediaNode) {
    return {
      kind: mediaNode.type as 'image' | 'video',
      url: String(mediaNode.data?.value).trim(),
    };
  }

  const fallbackNode = contentNodes.find(node => {
    const value = typeof node.data?.value === 'string' ? node.data.value.trim() : '';
    return (node.type === 'text' || node.type === 'audio') && Boolean(value);
  });

  if (fallbackNode?.type === 'text' || fallbackNode?.type === 'audio') {
    return { kind: fallbackNode.type };
  }

  return { kind: 'default' };
};
