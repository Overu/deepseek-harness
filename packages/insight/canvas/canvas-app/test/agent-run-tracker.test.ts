import { describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { createCanvasRunTracker } from '../src/canvas-run-tracker';
import { parseCanvasRunState } from '../../src/shared/canvas-run-protocol';
const oldUrl = 'https://assets.example/old.png';
const newUrl = 'https://assets.example/new.png';
const node = (status = 'success', taskId?: string, value = oldUrl): Node => ({ id: 'n1', type: 'image', position: { x: 0, y: 0 },
  data: { value, product: [], taskInfo: { status, ...(taskId ? { taskId } : {}) } } });
const observation = (n: Node, version = '20') => ({ version, taskStatus: 'SUCCESS', nodes: [n] });
const start = (baseline = node('success', 'old-task')) => { const tracker = createCanvasRunTracker('2873'); tracker.begin('request', baseline, { images: 1, videos: 0 }); tracker.submitted('request', 'workflow', '19'); return tracker; };

describe('Client run identity and authoritative observations', () => {
  it('registers before begin, replays caches and avoids duplicate notifications', () => {
    const tracker = createCanvasRunTracker('2873'); const listener = vi.fn(); tracker.subscribe('request', listener);
    tracker.begin('request', node(), { images: 1, videos: 0 }); expect(listener).not.toHaveBeenCalled();
    tracker.submitted('request', 'workflow', '19'); const replay = vi.fn(); tracker.subscribe('request', replay);
    expect(listener).toHaveBeenCalledTimes(1); expect(replay).toHaveBeenCalledTimes(1);
    tracker.observe(observation(node('running', 'new-task', ''))); tracker.observe(observation(node('running', 'new-task', '')));
    expect(listener).toHaveBeenCalledTimes(2); expect(tracker.get('request')).toMatchObject({ phase: 'running', sequence: 2, workflowTaskId: 'workflow', nodeTaskId: 'new-task' });
  });
  it('never returns old terminal status or old outputs as the new run', () => {
    const tracker = start(); tracker.observe(observation(node('success', 'old-task')));
    expect(tracker.get('request')).toMatchObject({ phase: 'monitoring_unknown', outputs: [] });
    tracker.observe(observation(node('success', 'new-task')));
    expect(tracker.get('request')).toMatchObject({ phase: 'monitoring_unknown', outputs: [] });
  });
  it('publishes only new outputs after an associated task succeeds, including immediate completion', () => {
    const tracker = start(); const result = node('success', 'node-new', newUrl); result.data.product = [{ value: oldUrl }, { value: newUrl }];
    tracker.observe(observation(result)); expect(tracker.get('request')).toMatchObject({ phase: 'completed', workflowTaskId: 'workflow', nodeTaskId: 'node-new', outputs: [newUrl] });
    expect(tracker.get('request')).not.toHaveProperty('error');
  });
  it('replays a fast authoritative completion observed before submitted is registered', () => {
    const tracker = createCanvasRunTracker('2873'); tracker.begin('request', node('success', 'old-task'), { images: 1, videos: 0 });
    tracker.observe(observation(node('success', 'new-task', newUrl))); expect(tracker.get('request')).toBeNull();
    tracker.submitted('request', 'workflow', '19'); expect(tracker.get('request')).toMatchObject({ phase: 'completed', sequence: 2, outputs: [newUrl] });
  });
  it('only a changed URL without task identity or authoritative running is not completion', () => {
    const tracker = start(node('success')); tracker.observe(observation(node('success', undefined, newUrl)));
    expect(tracker.get('request')).toMatchObject({ phase: 'monitoring_unknown', outputs: [] });
  });
  it('no task ID path needs authoritative running and new output', () => {
    const tracker = start(node('success')); tracker.observe(observation(node('running'))); tracker.observe(observation(node('success')));
    expect(tracker.get('request')).toMatchObject({ phase: 'monitoring_unknown', outputs: [] });
    tracker.observe(observation(node('success', undefined, newUrl), '21'));
    expect(tracker.get('request')).toMatchObject({ phase: 'completed', outputs: [newUrl] });
  });
  it('ignores observations before the accepted version, including Long values', () => {
    const tracker = createCanvasRunTracker('2873'); tracker.begin('request', node(), { images: 1, videos: 0 }); tracker.submitted('request', 'workflow', '90071992547409932');
    tracker.observe(observation(node('success', 'new-task', newUrl), '90071992547409931'));
    expect(tracker.get('request')?.phase).toBe('submitted');
    tracker.observe(observation(node('success', 'new-task', newUrl), '90071992547409933'));
    expect(tracker.get('request')?.phase).toBe('completed');
  });
  it('detects a later different task instead of claiming its result', () => {
    const tracker = start(); tracker.observe(observation(node('running', 'node-new'))); tracker.observe(observation(node('success', 'other-task', newUrl), '21'));
    expect(tracker.get('request')).toMatchObject({ phase: 'monitoring_unknown', outputs: [], error: { retry: 'never_auto' } });
  });
  it('monitoring errors differ from backend failure and can recover', () => {
    const tracker = start(); tracker.monitoringUnknown({ code: 'READ_TIMEOUT', message: 'offline', retry: 'never_auto' });
    expect(tracker.get('request')?.phase).toBe('monitoring_unknown');
    tracker.observe(observation(node('success', 'new-task', newUrl)));
    expect(tracker.get('request')).toMatchObject({ phase: 'completed' }); expect(tracker.get('request')).not.toHaveProperty('error');
    const failed = start(); failed.observe(observation(node('failure', 'new-task', '')));
    expect(failed.get('request')).toMatchObject({ phase: 'failed', error: { code: 'RUN_REJECTED', retry: 'user_decision' } });
  });
  it('unknown is never retried and only authoritative new identity restores a result', () => {
    const tracker = createCanvasRunTracker('2873'); tracker.begin('request', node('success', 'old-task'), { images: 1, videos: 0 }); tracker.unknown('request', '18');
    expect(tracker.get('request')).toMatchObject({ phase: 'submission_unknown' });
    tracker.observe({ ...observation(node('success', 'old-task')), taskStatus: 'RUNNING' }); expect(tracker.get('request')?.phase).toBe('submission_unknown');
    tracker.observe(observation(node('success', 'new-task', newUrl))); expect(tracker.get('request')?.phase).toBe('completed');
    expect(() => tracker.begin('request', node(), { images: 1, videos: 0 })).toThrow('生成请求已存在');
  });
  it('retains the newest fast snapshot instead of replaying an older snapshot', () => {
    const tracker = createCanvasRunTracker('2873'); tracker.begin('request', node('success', 'old-task'), { images: 1, videos: 0 });
    tracker.observe(observation(node('success', 'new-task', newUrl), '21'));
    tracker.observe(observation(node('running', 'old-task', ''), '20'));
    tracker.submitted('request', 'workflow', '19'); expect(tracker.get('request')).toMatchObject({ phase: 'completed', version: '21', outputs: [newUrl] });
  });
  it('a failed multi-output task retains partial new artifacts and excludes historical ones', () => {
    const tracker = createCanvasRunTracker('2873'); tracker.begin('request', node('success', 'old-task'), { images: 2, videos: 0 }); tracker.submitted('request', 'workflow', '19');
    const failed = node('failure', 'new-task', newUrl); failed.data.product = [{ value: oldUrl }, { value: newUrl }]; tracker.observe(observation(failed));
    expect(tracker.get('request')).toMatchObject({ phase: 'failed', generation: { images: 2, videos: 0 }, outputs: [newUrl] });
  });
  it('blocks another call ID while monitoring is unknown, and authoritative completion releases the node fence', () => {
    const tracker = start(); tracker.monitoringUnknown({ code: 'READ_TIMEOUT', message: 'offline', retry: 'never_auto' });
    expect(() => tracker.assertNodeAvailable('n1')).toThrow('前一次生成结果尚未确认');
    expect(() => tracker.begin('another-request', node(), { images: 1, videos: 0 })).toThrow('前一次生成结果尚未确认');
    tracker.observe(observation(node('success', 'new-task', newUrl))); expect(() => tracker.assertNodeAvailable('n1')).not.toThrow();
    expect(() => tracker.begin('another-request', node('success', 'new-task', newUrl), { images: 1, videos: 0 })).not.toThrow();
  });
  it('begins a batch atomically with separate state for every node', () => {
    const tracker = createCanvasRunTracker('2873'); const first = node('success', 'old-a'); const second = { ...node('success', 'old-b'), id: 'n2' };
    tracker.beginMany([
      { requestId: 'child-a', node: first, generation: { images: 1, videos: 0 } },
      { requestId: 'child-b', node: second, generation: { images: 0, videos: 1 } },
    ]);
    tracker.submitted('child-a', 'batch-task', '19'); tracker.submitted('child-b', 'batch-task', '19');
    const completed = { ...second, data: { ...second.data, value: newUrl, taskInfo: { status: 'success', taskId: 'new-b' } } };
    tracker.observe({ version: '20', taskStatus: 'SUCCESS', nodes: [first, completed] });
    expect(tracker.get('child-a')).toMatchObject({ phase: 'monitoring_unknown', generation: { images: 1, videos: 0 } });
    expect(tracker.get('child-b')).toMatchObject({ phase: 'completed', generation: { images: 0, videos: 1 }, outputs: [newUrl] });
    expect(() => tracker.assertNodeAvailable('n1')).toThrow('尚未确认');
    expect(() => tracker.assertNodeAvailable('n2')).not.toThrow();
  });
  it('does not leave partial batch entries when one target is already tracked', () => {
    const tracker = start(); const second = { ...node(), id: 'n2' };
    expect(() => tracker.beginMany([
      { requestId: 'new-a', node: node(), generation: { images: 1, videos: 0 } },
      { requestId: 'new-b', node: second, generation: { images: 1, videos: 0 } },
    ])).toThrow('待完成');
    expect(tracker.get('new-a')).toBeNull(); expect(tracker.get('new-b')).toBeNull();
  });
  it('dispose publishes monitoring unknown and releases subscriptions', () => {
    const tracker = start(); const listener = vi.fn(); tracker.subscribe('request', listener); tracker.dispose();
    expect(listener.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'monitoring_unknown', error: { code: 'CONTEXT_GONE' } });
    expect(tracker.get('request')).toBeNull();
  });
  it('shared parser rejects undeclared, unsafe URL and invalid counts/sequence fields', () => {
    const state = start().get('request')!; expect(parseCanvasRunState(state)).toEqual(state);
    for (const patch of [{ extra: true }, { sequence: -1 }, { generation: { images: NaN, videos: 0 } }, { outputs: ['file:///tmp/x'] }, { outputs: ['https://example.com/x?token=secret'] }]) expect(() => parseCanvasRunState({ ...state, ...patch })).toThrow();
  });
});
