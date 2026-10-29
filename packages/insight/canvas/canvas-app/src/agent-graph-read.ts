import type { GraphReadReceipt, CanvasOperation } from '../../src/shared/canvas-agent-protocol';
import { MAX_NODE_IDS, MAX_TITLE_LENGTH } from '../../src/shared/canvas-agent-protocol';
import type { AgentNodeState } from './agent-node-policy';
import { getAgentNodeGeometry } from './agent-node-placement';
import { getAgentNodePorts, getAgentAllowedInputTypes } from './agent-edge-policy';
import { canConfigureAgentGeneration } from './agent-generation-policy';

type GraphQuery = Extract<CanvasOperation, { action: 'canvas.graph.read' }>;
type GraphSnapshot = Omit<GraphReadReceipt, 'status' | 'canvasId' | 'version' | 'consistency'>;

/** Bounded graph metadata. Contents and media URLs remain in the existing node-detail query. */
export function readAgentGraph(state: AgentNodeState, query: GraphQuery): GraphSnapshot {
  const nodeOffset = query.nodeOffset ?? 0;
  const edgeOffset = query.edgeOffset ?? 0;
  const limit = query.limit ?? MAX_NODE_IDS;
  return {
    nodeCount: state.nodes.length, edgeCount: state.edges.length,
    nodeOffset, edgeOffset,
    nextNodeOffset: nodeOffset + limit < state.nodes.length ? nodeOffset + limit : null,
    nextEdgeOffset: edgeOffset + limit < state.edges.length ? edgeOffset + limit : null,
    nodes: state.nodes.slice(nodeOffset, nodeOffset + limit).map(node => ({
      id: node.id, type: node.type ?? '',
      title: (typeof node.data.title === 'string' ? node.data.title : '').slice(0, MAX_TITLE_LENGTH),
      ...getAgentNodeGeometry(node), ports: getAgentNodePorts(node),
      allowedInputTypes: getAgentAllowedInputTypes(node),
      canConfigureGeneration: canConfigureAgentGeneration(node),
    })),
    // Preserve native array order; it is the material order consumed by getSourceMap.
    edges: state.edges.slice(edgeOffset, edgeOffset + limit).map(edge => ({
      id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null,
    })),
  };
}
