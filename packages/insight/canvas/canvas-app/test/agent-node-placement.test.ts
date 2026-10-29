// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
import { getAgentNodeGeometry, placeAgentNodes } from '../src/agent-node-placement';
import { describeAgentNode } from '../src/agent-node-policy';
import { parseCanvasOperationResult } from '../../src/shared/canvas-agent-protocol';

const node = (id: string, x = 0, y = 0, extra: Partial<Node> = {}): Node => ({ id, type: 'text', position: { x, y }, data: { title: id }, ...extra });
const auto = { mode: 'auto' as const };
const gap = 120;

describe('Agent node geometry', () => {
  it('uses the native complete measured pair before explicit dimensions', () => {
    expect(getAgentNodeGeometry(node('image', 5, -8, { type: 'image', width: 400, height: 400, measured: { width: 933, height: 400 } })))
      .toEqual({ position: { x: 5, y: -8 }, size: { width: 933, height: 400 }, parentId: null });
  });
  it('uses an explicit dimension pair and native defaults for invalid or incomplete dimensions', () => {
    expect(getAgentNodeGeometry(node('long', 0, 0, { width: 400, height: 933, measured: { width: Number.NaN, height: 400 } })).size).toEqual({ width: 400, height: 933 });
    expect(getAgentNodeGeometry(node('invalid', 0, 0, { width: Infinity, height: -1, measured: { width: 300 } })).size).toEqual({ width: 400, height: 400 });
  });
  it('uses numeric group style rather than stale measured dimensions', () => {
    expect(getAgentNodeGeometry(node('group', 10, 20, { type: 'group', style: { width: 1600, height: 1000 }, measured: { width: 400, height: 400 } })).size)
      .toEqual({ width: 1600, height: 1000 });
    expect(getAgentNodeGeometry(node('group', 0, 0, { type: 'group', style: { width: '100%', height: 'auto' } })).size)
      .toEqual({ width: 400, height: 400 });
  });
  it('exposes local coordinates and parent identity without pretending they are world coordinates', () => {
    expect(getAgentNodeGeometry(node('child', -20, 40, { parentId: 'group' })))
      .toEqual({ position: { x: -20, y: 40 }, size: { width: 400, height: 400 }, parentId: 'group' });
  });
  it('normalizes native copied or ungrouped root nodes for the real read-receipt parser', () => {
    const copied = node('copied', 50, 80, { parentId: '' });
    const detail = describeAgentNode({ nodes: [copied], edges: [], modelsMap: {}, modelNodePermission: null }, copied);
    const receipt = { status: 'read', canvasId: '2873', version: '1', consistency: 'confirmed', nodeCount: 1, nodes: [detail], missingNodeIds: [] };
    expect(parseCanvasOperationResult(receipt)).toMatchObject({ nodes: [{ id: 'copied', parentId: null, position: { x: 50, y: 80 } }] });
    expect(copied.parentId).toBe('');
  });
  it('rejects non-finite positions', () => {
    expect(() => getAgentNodeGeometry(node('bad', NaN, 0))).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('Agent-only automatic placement', () => {
  it('places the first node at the origin', () => {
    expect(placeAgentNodes([node('new', 91, 72)], [], auto)[0].position).toEqual({ x: 0, y: 0 });
  });
  it('appends after true occupied width and aligns the occupied top', () => {
    const existing = [node('wide', -500, -80, { width: 933, height: 400 }), node('long', 600, 100, { width: 400, height: 933 })];
    expect(placeAgentNodes([node('new')], existing, auto)[0].position).toEqual({ x: 1000 + gap, y: -80 });
  });
  it('accounts for groups, nested parent coordinates and children extending beyond the group box', () => {
    const existing = [
      node('outer', 100, 50, { type: 'group', style: { width: 700, height: 500 } }),
      node('inner', 600, 30, { type: 'group', parentId: 'outer', style: { width: 500, height: 500 } }),
      node('child', 450, -120, { parentId: 'inner', width: 933, height: 400 }),
    ];
    expect(placeAgentNodes([node('new')], existing, auto)[0].position).toEqual({ x: 2083 + gap, y: -40 });
  });
  it('uses native grid for a new batch, with actual sizes, and moves no existing content', () => {
    const existing = [node('old', -100, -50, { width: 700, height: 400 })];
    const drafts = [node('wide', 500, 10, { width: 933, height: 400 }), node('long', -40, 900, { width: 400, height: 933 }), node('plain', 0, 0)];
    const before = JSON.parse(JSON.stringify({ existing, drafts }));
    const result = placeAgentNodes(drafts, existing, auto);
    expect(result.map(item => item.position)).toEqual([{ x: 720, y: -50 }, { x: 1773, y: -50 }, { x: 720, y: 963 }]);
    expect({ existing, drafts }).toEqual(before);
    expect(result[0]).toMatchObject({ id: 'wide', width: 933, height: 400, data: { title: 'wide' } });
  });
  it('preserves explicit origin and translates a batch without rewriting its relative layout', () => {
    const drafts = [node('a', 90, -20), node('b', 570, 100)];
    const result = placeAgentNodes(drafts, [node('old')], { mode: 'absolute', position: { x: 0, y: 0 } });
    expect(result.map(item => item.position)).toEqual([{ x: 0, y: 0 }, { x: 480, y: 120 }]);
    expect(placeAgentNodes([node('a')], [], { mode: 'absolute', position: { x: -20, y: 35 } })[0].position).toEqual({ x: -20, y: 35 });
  });
  it('extends near an anchor even when unrelated content already occupies the nearby location', () => {
    const existing = [node('anchor', 40, 80, { width: 933, height: 400 }), node('occupied', 1093, 80), node('far', 5000, 900)];
    expect(placeAgentNodes([node('new')], existing, { mode: 'after', anchorNodeId: 'anchor' })[0].position).toEqual({ x: 1093, y: 80 });
    expect(existing[1].position).toEqual({ x: 1093, y: 80 });
  });
  it('extends from the world position of a nested anchor', () => {
    const existing = [node('group', -100, 200, { type: 'group', style: { width: 1200, height: 800 } }), node('anchor', 500, 30, { parentId: 'group', width: 933, height: 400 })];
    expect(placeAgentNodes([node('new')], existing, { mode: 'after', anchorNodeId: 'anchor' })[0].position).toEqual({ x: 1453, y: 230 });
  });
  it('rejects a missing anchor, malformed ancestry and coordinate overflow', () => {
    expect(() => placeAgentNodes([node('new')], [], { mode: 'after', anchorNodeId: 'missing' })).toThrow(expect.objectContaining({ code: 'NODE_NOT_FOUND' }));
    expect(() => placeAgentNodes([node('new')], [node('a', 0, 0, { parentId: 'b' }), node('b', 0, 0, { parentId: 'a' })], auto)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => placeAgentNodes([node('new')], [node('orphan', 0, 0, { parentId: 'missing' })], auto)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => placeAgentNodes([node('new')], [node('huge', Number.MAX_VALUE, 0, { width: Number.MAX_VALUE, height: 400 })], auto)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
  it('does not implement new group insertion and returns an empty batch without edits', () => {
    expect(() => placeAgentNodes([node('child', 0, 0, { parentId: 'group' })], [], auto)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(placeAgentNodes([], [node('old')], auto)).toEqual([]);
  });
});
