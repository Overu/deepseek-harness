import { describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
vi.mock('@/api/workflow', () => ({ updateCanvas: vi.fn(), saveFlow: vi.fn(), excuteWorkFlow: vi.fn() }));
vi.mock('@/api/asset', () => ({ getAvailableCapacity: vi.fn() }));
vi.mock('@/components/common/storageLimitManager', () => ({ openStorageLimitDialog: vi.fn() }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
import { getAgentNodePorts, getAgentAllowedInputTypes, resolveAgentEdgeChange } from '../src/agent-edge-policy';

const node = (id: string, type = 'image', data: Record<string, unknown> = {}): Node => ({ id, type, position: { x: 0, y: 0 }, data });
const edge = (id: string, source: string, target: string, type = 'image'): Edge => ({ id, source, target, sourceHandle: type + '_source', targetHandle: type + '_target' });
const add = (sourceNodeId: string, targetNodeId: string, handles = {}) => ({ action: 'edge.add' as const, expectedVersion: '18', connection: { sourceNodeId, targetNodeId, ...handles } });

describe('native Agent edge policy', () => {
  it('reads registered ordinary/upload ports and native capacities without model guesses', () => {
    expect(getAgentNodePorts(node('i', 'image', { type: 'upload' }))).toEqual([
      { id: 'text_target', type: 'target', mediaType: 'text', limit: null },
      { id: 'image_target', type: 'target', mediaType: 'image', limit: null },
      { id: 'image_source', type: 'source', mediaType: 'image', limit: null },
    ]);
    expect(getAgentNodePorts(node('tool', 'highDefinitionTool'))[0]).toMatchObject({ id: 'image_target', limit: 1 });
    expect(getAgentNodePorts(node('group', 'group'))).toEqual([]);
  });
  it('reports current storyboard mode input restrictions', () => {
    expect(getAgentAllowedInputTypes(node('s', 'storyboardTool', { params: { mode: 'gen_script' } }))).toEqual(['text']);
    expect(getAgentAllowedInputTypes(node('s', 'storyboardTool', { params: { mode: 'video_understand' } }))).toEqual(['video']);
    expect(getAgentAllowedInputTypes(node('s', 'storyboardTool', { params: { mode: 'custom' } }))).toEqual(['text', 'image', 'video']);
  });
  it('infers native handles and creates a complete delta without moving or modifying nodes', () => {
    const nodes = [node('copy', 'text', { value: '文案' }), node('target')]; const original = structuredClone(nodes);
    const result = resolveAgentEdgeChange({ nodes, edges: [] }, add('copy', 'target'));
    expect(result.edges).toHaveLength(1); expect(result.edges[0]).toMatchObject({ source: 'copy', target: 'target', sourceHandle: 'text_source', targetHandle: 'text_target', className: 'text_source' });
    expect(result.affectedNodeIds).toEqual(['copy', 'target']); expect(result.affectedEdgeIds).toEqual([result.edges[0].id]); expect(nodes).toEqual(original);
  });
  it('allows an uploaded image or ordinary tool result to feed an existing native tool', () => {
    for (const type of ['upload', 'tool']) {
      const result = resolveAgentEdgeChange({ nodes: [node('asset', 'image', { type }), node('target', 'highDefinitionTool')], edges: [] }, add('asset', 'target'));
      expect(result.edges[0].targetHandle).toBe('image_target');
    }
  });
  it('enforces native target capacity before a second tool input', () => {
    const state = { nodes: [node('a'), node('b'), node('tool', 'highDefinitionTool')], edges: [edge('existing', 'a', 'tool')] };
    expect(() => resolveAgentEdgeChange(state, add('b', 'tool'))).toThrow('数量上限');
  });
  it('honors the native storyboard input mode while retaining its registered port discovery', () => {
    const state = { nodes: [node('asset'), node('copy', 'text'), node('story', 'storyboardTool', { params: { mode: 'gen_script' } })], edges: [] };
    expect(getAgentNodePorts(state.nodes[2]).some(port => port.id === 'image_target')).toBe(true);
    expect(() => resolveAgentEdgeChange(state, add('asset', 'story'))).toThrow('不兼容');
    expect(resolveAgentEdgeChange(state, add('copy', 'story')).edges[0].targetHandle).toBe('text_target');
  });
  it.each([
    { sourceHandle: 'video_source', targetHandle: 'video_target' },
    { sourceHandle: 'fake_source', targetHandle: 'fake_target' },
    { sourceHandle: 'image_source', targetHandle: 'text_target' },
  ])('rejects unregistered or incompatible handles: %j', handles => {
    const state = { nodes: [node('asset'), node('target')], edges: [] };
    expect(() => resolveAgentEdgeChange(state, add('asset', 'target', handles))).toThrow(); expect(state.edges).toEqual([]);
  });
  it('rejects incompatible native input types, self loops and missing nodes', () => {
    const state = { nodes: [node('audio', 'audio'), node('target')], edges: [] };
    expect(() => resolveAgentEdgeChange(state, add('audio', 'target'))).toThrow('兼容');
    expect(() => resolveAgentEdgeChange(state, add('target', 'target'))).toThrow('自身');
    expect(() => resolveAgentEdgeChange(state, add('missing', 'target'))).toThrow('不存在');
  });
  it('does not allow a second reference to the same source-target through a different registered target port', () => {
    const state = { nodes: [node('asset'), node('target')], edges: [{ ...edge('old', 'asset', 'target'), targetHandle: 'text_target' }] };
    expect(() => resolveAgentEdgeChange(state, add('asset', 'target'))).toThrow('已存在');
  });
  it('rejects only a newly introduced cycle, without rewriting an unrelated legacy cycle', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
    expect(() => resolveAgentEdgeChange({ nodes, edges: [edge('ab', 'a', 'b')] }, add('b', 'a'))).toThrow('循环');
    const existing = [edge('ab', 'a', 'b'), edge('ba', 'b', 'a')];
    expect(resolveAgentEdgeChange({ nodes, edges: existing }, add('c', 'd')).edges.slice(0, 2)).toEqual(existing);
  });
  it('reconnects an existing edge in its slot with the same ID and preserves native metadata', () => {
    const state = { nodes: [node('a'), node('b'), node('c')], edges: [{ ...edge('same', 'a', 'b'), data: { label: 'native' }, style: { opacity: 0.5 } }] };
    const result = resolveAgentEdgeChange(state, { action: 'edge.reconnect', expectedVersion: '18', edgeId: 'same', connection: { sourceNodeId: 'a', targetNodeId: 'c' } });
    expect(result.edges[0]).toMatchObject({ id: 'same', target: 'c', data: { label: 'native' }, style: { opacity: 0.5 } });
    expect(result.affectedNodeIds).toEqual(['a', 'b', 'c']);
    expect(resolveAgentEdgeChange(state, { action: 'edge.reconnect', expectedVersion: '18', edgeId: 'same', connection: { sourceNodeId: 'a', targetNodeId: 'b' } }).unchanged).toBe(true);
  });
  it('refuses changes to native tool output-management edges', () => {
    const nodes = [node('tool', 'highDefinitionTool'), node('result', 'image', { type: 'tool' }), node('target')];
    const state = { nodes, edges: [edge('managed', 'tool', 'result')] };
    expect(() => resolveAgentEdgeChange(state, add('tool', 'target'))).toThrow('管理边');
    expect(() => resolveAgentEdgeChange(state, { action: 'edge.delete', expectedVersion: '18', edgeIds: ['managed'] })).toThrow('管理边');
    expect(() => resolveAgentEdgeChange(state, { action: 'edge.reconnect', expectedVersion: '18', edgeId: 'managed', connection: { sourceNodeId: 'result', targetNodeId: 'target' } })).toThrow('管理边');
    expect(() => resolveAgentEdgeChange(state, { action: 'edge.reorder', expectedVersion: '18', targetNodeId: 'result', edgeIds: ['managed'] })).toThrow('管理边');
  });
  it('reorders complete target inputs only, retaining unrelated slots and edge metadata', () => {
    const nodes = ['a', 'b', 'c', 'target', 'other'].map(id => node(id));
    const state = { nodes, edges: [edge('a', 'a', 'target'), edge('outside', 'c', 'other'), edge('b', 'b', 'target')] };
    const result = resolveAgentEdgeChange(state, { action: 'edge.reorder', expectedVersion: '18', targetNodeId: 'target', edgeIds: ['b', 'a'] });
    expect(result.edges.map(edge => edge.id)).toEqual(['b', 'outside', 'a']); expect(result.edges[1]).toBe(state.edges[1]);
    expect(result.affectedEdgeIds).toEqual(['b', 'a']);
  });
  it('refuses incomplete, duplicate or cross-target ordering', () => {
    const nodes = ['a', 'b', 'c', 'target', 'other'].map(id => node(id));
    const state = { nodes, edges: [edge('a', 'a', 'target'), edge('outside', 'c', 'other'), edge('b', 'b', 'target')] };
    for (const edgeIds of [['a'], ['a', 'a'], ['a', 'outside']]) expect(() => resolveAgentEdgeChange(state, { action: 'edge.reorder', expectedVersion: '18', targetNodeId: 'target', edgeIds })).toThrow('全部入边');
  });
  it('deletes only requested real edge IDs and rejects missing IDs', () => {
    const state = { nodes: [node('a'), node('tool', 'highDefinitionTool')], edges: [edge('e', 'a', 'tool')] };
    const result = resolveAgentEdgeChange(state, { action: 'edge.delete', expectedVersion: '18', edgeIds: ['e'] });
    expect(result.edges).toEqual([]); expect(result.affectedNodeIds).toEqual(['a', 'tool']);
    expect(() => resolveAgentEdgeChange(state, { action: 'edge.delete', expectedVersion: '18', edgeIds: ['absent'] })).toThrow('不存在');
  });
});
