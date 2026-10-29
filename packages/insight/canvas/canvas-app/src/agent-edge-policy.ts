import type { Edge, Node } from '@xyflow/react';
import { v4 as uuidv4 } from 'uuid';
import setting from '../legacy/src/components/canvasFlow/settings/setting';
import util from '../legacy/src/components/canvasFlow/utils/util';
import { getHandleLimit } from '../legacy/src/components/canvasFlow/utils/multiConnect';
import { CanvasAgentError, STANDARD_NODE_TYPES, type EdgeConnection, type EdgeEditOperation, type GraphPort } from '../../src/shared/canvas-agent-protocol';

type GraphState = { nodes: Node[]; edges: Edge[] };
export interface AgentEdgeChange {
  edges: Edge[];
  affectedNodeIds: string[];
  affectedEdgeIds: string[];
  unchanged: boolean;
}

function invalid(message: string): never { throw new CanvasAgentError('INVALID_CONNECTION', message); }
function standard(node: Node): boolean { return STANDARD_NODE_TYPES.some(type => type === node.type); }

/** Native registration is the source of truth, including tool port capacities. */
export function getAgentNodePorts(node: Node): GraphPort[] {
  const handlers = setting.handlersMap[String(node.type) as keyof typeof setting.handlersMap] ?? [];
  return handlers.map(handle => ({ id: handle.id, type: handle.type,
    mediaType: handle.id.split('_')[0], limit: 'limit' in handle && typeof handle.limit === 'number' ? handle.limit : null }));
}

export function getAgentAllowedInputTypes(node: Node): string[] {
  const ports = getAgentNodePorts(node).filter(port => port.type === 'target');
  const mode = String((node.data.params as { mode?: unknown } | undefined)?.mode ?? 'custom');
  const allowed = node.type === 'storyboardTool' && mode === 'gen_script' ? ['text']
    : node.type === 'storyboardTool' && mode === 'video_understand' ? ['video']
    : setting.targetTypeMap[String(node.type) as keyof typeof setting.targetTypeMap] ?? [];
  return [...new Set(allowed)].filter(type => ports.some(port => port.mediaType === type));
}

function nodeOf(state: GraphState, id: string, role: 'source' | 'target'): Node {
  const node = state.nodes.find(item => item.id === id);
  if (!node) throw new CanvasAgentError('NODE_NOT_FOUND', '连线节点不存在：' + id);
  if (role === 'source' ? !standard(node) : !getAgentNodePorts(node).some(port => port.type === 'target')) throw new CanvasAgentError('UNSUPPORTED_NODE', '本期不编辑工具输出管理边或无输入端口的节点');
  return node;
}

function hasPath(edges: Edge[], start: string, end: string): boolean {
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === end) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of edges) if (edge.source === id) pending.push(edge.target);
  }
  return false;
}

function resolveConnection(state: GraphState, connection: EdgeConnection, id: string, workingEdges: Edge[]): Edge {
  const source = nodeOf(state, connection.sourceNodeId, 'source');
  const target = nodeOf(state, connection.targetNodeId, 'target');
  if (source.id === target.id) invalid('节点不能连接自身');
  const sourcePorts = getAgentNodePorts(source).filter(port => port.type === 'source');
  const sourceHandle = connection.sourceHandle ?? sourcePorts[0]?.id;
  const sourcePort = sourcePorts.find(port => port.id === sourceHandle);
  if (!sourcePort) invalid('源节点没有指定的输出端口');
  const targetPorts = getAgentNodePorts(target).filter(port => port.type === 'target');
  const targetHandle = connection.targetHandle ?? targetPorts.find(port => port.mediaType === sourcePort.mediaType)?.id;
  const targetPort = targetPorts.find(port => port.id === targetHandle);
  if (!targetPort) invalid('目标节点没有兼容的输入端口');
  // Do not silently turn an explicitly selected port into a different input slot.
  if (sourcePort.mediaType !== targetPort.mediaType || !getAgentAllowedInputTypes(target).includes(sourcePort.mediaType)) invalid('连线输入输出类型不兼容');
  const edge: Edge = { id, source: source.id, target: target.id, sourceHandle, targetHandle };
  if (!util.validateConnection(edge, state.nodes)) invalid('连线未通过原生校验');
  // Native getSourceMap resolves each source once; a second port cannot safely represent a second input.
  if (workingEdges.some(item => item.source === edge.source && item.target === edge.target)) invalid('这两个节点之间已存在连线');
  const limit = getHandleLimit(target.type, targetHandle);
  if (limit !== undefined && workingEdges.filter(item => item.target === target.id && item.targetHandle === targetHandle).length >= limit) invalid('目标输入端口已达到连线数量上限');
  if (hasPath(workingEdges, target.id, source.id)) invalid('此连线会产生循环依赖');
  return util.dealEdge(edge);
}

function edgeOf(state: GraphState, id: string): Edge {
  const found = state.edges.filter(edge => edge.id === id);
  if (found.length !== 1) throw new CanvasAgentError('EDGE_NOT_FOUND', '连线不存在或ID不唯一：' + id);
  nodeOf(state, found[0].source, 'source'); nodeOf(state, found[0].target, 'target');
  return found[0];
}

/** Computes one complete delta; no Store writes, HTTP calls, selection or layout changes. */
export function resolveAgentEdgeChange(state: GraphState, operation: EdgeEditOperation): AgentEdgeChange {
  let edges: Edge[];
  let affectedEdgeIds: string[];
  let affectedNodeIds: string[];
  let unchanged = false;
  if (operation.action === 'edge.add') {
    const edge = resolveConnection(state, operation.connection, uuidv4(), state.edges);
    edges = [...state.edges, edge]; affectedEdgeIds = [edge.id]; affectedNodeIds = [edge.source, edge.target];
  } else if (operation.action === 'edge.delete') {
    const removed = operation.edgeIds.map(id => edgeOf(state, id));
    const ids = new Set(operation.edgeIds);
    edges = state.edges.filter(edge => !ids.has(edge.id)); affectedEdgeIds = [...ids];
    affectedNodeIds = removed.flatMap(edge => [edge.source, edge.target]);
  } else if (operation.action === 'edge.reconnect') {
    const old = edgeOf(state, operation.edgeId);
    const replacement = resolveConnection(state, operation.connection, old.id, state.edges.filter(edge => edge.id !== old.id));
    unchanged = old.source === replacement.source && old.target === replacement.target
      && old.sourceHandle === replacement.sourceHandle && old.targetHandle === replacement.targetHandle;
    edges = unchanged ? state.edges : state.edges.map(edge => edge.id === old.id ? { ...edge, ...replacement } : edge);
    affectedEdgeIds = [old.id]; affectedNodeIds = [old.source, old.target, replacement.source, replacement.target];
  } else {
    nodeOf(state, operation.targetNodeId, 'target');
    const incoming = state.edges.filter(edge => edge.target === operation.targetNodeId);
    if (incoming.length !== operation.edgeIds.length || new Set(operation.edgeIds).size !== operation.edgeIds.length
      || incoming.some(edge => !operation.edgeIds.includes(edge.id))) throw new CanvasAgentError('INVALID_ARGUMENT', '排序必须包含目标节点的全部入边，且不得包含其他连线');
    const byId = new Map(incoming.map(edge => [edge.id, edgeOf(state, edge.id)]));
    let cursor = 0;
    edges = state.edges.map(edge => edge.target === operation.targetNodeId ? byId.get(operation.edgeIds[cursor++])! : edge);
    unchanged = incoming.every((edge, index) => edge.id === operation.edgeIds[index]);
    affectedEdgeIds = [...operation.edgeIds]; affectedNodeIds = [operation.targetNodeId, ...incoming.map(edge => edge.source)];
  }
  return { edges, affectedNodeIds: [...new Set(affectedNodeIds)], affectedEdgeIds, unchanged };
}
