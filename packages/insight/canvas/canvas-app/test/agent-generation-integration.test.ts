// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { Node } from '@xyflow/react';
const api = vi.hoisted(() => ({ graph: vi.fn(), models: vi.fn(), permission: vi.fn(), tools: vi.fn(), update: vi.fn(), invoke: vi.fn(), capacity: vi.fn(), balance: vi.fn(), cost: vi.fn(), voice: vi.fn() }));
vi.mock('../legacy/src/api/tone', () => ({ fetchToneDetailByVoiceId: api.voice }));
vi.mock('@/api/workflow', () => ({ getFlowData: api.graph, getModelParams: api.models, listModelNodeSetting: api.permission, listToolNodeSetting: api.tools, updateCanvas: api.update, saveFlow: vi.fn(), excuteWorkFlow: api.invoke, fetchTone: vi.fn(), getAllRule: vi.fn() }));
vi.mock('@/api/asset', () => ({ getAvailableCapacity: api.capacity }));
vi.mock('@/api/order', () => ({ accountBalance: api.balance, calculateWorkflowCost: api.cost }));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader', () => ({ loadIntrinsicMediaDimensions: vi.fn().mockResolvedValue(null) }));
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }));
import util from '../legacy/src/components/canvasFlow/utils/util';
import { createCanvasServiceRuntime } from '../src/canvas-service';
import { createCanvasHostBridge } from '../../src/host/canvas-bridge';
import { createCanvasCommandEndpoint } from '../../src/client/canvas-command-endpoint';
import { registerCanvasProcessTools } from '../../src/host/canvas-process-tools';
import { registerCanvasRunTools } from '../../src/host/canvas-run-tools';
const success = (data: unknown) => ({ code: 'SUCCESS', data });
const model = { model_name: 'fixture', parameters: { gen_count: { default: 1, choices: [{ value: 1, label: '1' }] } }, senoir_parameters: {} };
const mode = (name: string) => ({ name, models: { fixture: model } });
const makeNode = (type: string, id: string, modelType: string): Node => ({ id, type, position: { x: 0, y: 0 }, width: 320, height: 320, data: { title: id, params: { model: 'fixture', modelType, gen_count: 1, prompt: '保持产品外观' }, taskInfo: { status: 'success' }, value: '', product: [] } });
const row = (nodes: Node[], edges: any[] = [], version = '18', status = 'FINISHED') => success({ name: '生成验收', data: JSON.stringify({ nodes, edges }), versionNumber: version, taskStatus: status });
const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('BroadcastChannel', undefined);
  api.models.mockResolvedValue(success([{ config: JSON.stringify({ image: { text_to_image: mode('文生图'), reference_image_to_image: mode('参考图') }, video: { image_to_video: mode('图生视频') }, audio: { tts: mode('配音'), text_to_audio: mode('音乐'), audio_to_audio: mode('音乐参考') }, text: { fixture: model } }) }]));
  api.voice.mockResolvedValue(success({ voiceType: 'PUBLIC_VOICE', publicVoice: { voiceId: 'fixture-voice', name: '测试音色', onSale: 1 } }));
  api.permission.mockResolvedValue(success([])); api.tools.mockResolvedValue(success([])); api.update.mockResolvedValue(success({ versionNumber: '19' }));
  api.cost.mockResolvedValue(success(1)); api.capacity.mockResolvedValue(success({ usedCapacity: 0, limitCapacity: 100 })); api.balance.mockResolvedValue(success({ rechargeBalance: 5 }));
  api.invoke.mockResolvedValue(success({ versionNumber: '19', taskId: 'workflow-accepted' }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([
  ['image', 'text_to_image', false, 'png'],
  ['image', 'reference_image_to_image', true, 'png'],
  ['video', 'image_to_video', true, 'mp4'],
  ['audio', 'tts', false, 'mp3'],
  ['audio', 'text_to_audio', false, 'mp3'],
  ['audio', 'audio_to_audio', true, 'mp3'],
])('dialogue %s/%s traverses native no-iframe execution and delivers only its new media through Jobs', async (type, modelType, withReference, extension) => {
  const target = makeNode(String(type), 'target', String(modelType));
  if (type === 'audio') Object.assign(target.data.params as object, { ...(modelType === 'tts' ? { voiceId: 'fixture-voice' } : {}), seniorParams: {} });
  const referenceType = modelType === 'audio_to_audio' ? 'audio' : 'image';
  const reference = makeNode(referenceType, 'reference', 'text_to_image'); reference.data.type = 'upload'; reference.data.value = `https://assets.example/reference.${referenceType === 'audio' ? 'mp3' : 'png'}`;
  if (referenceType === 'audio') Object.assign(reference.data.params as object, { seniorParams: {} });
  const caption = makeNode('text', 'caption', 'fixture'); caption.data.value = '通勤轻负担，音乐随身听';
  const nodes = withReference ? [reference, caption, target] : [caption, target];
  const edges = [{ id: 'caption-target', source: caption.id, target: target.id, sourceHandle: 'text_source', targetHandle: 'text_target' },
    ...(withReference ? [{ id: 'reference-target', source: reference.id, target: target.id, sourceHandle: `${referenceType}_source`, targetHandle: `${referenceType}_target` }] : [])];
  api.graph.mockResolvedValue(row(nodes, edges));
  const runtime = createCanvasServiceRuntime(), bridge = createCanvasHostBridge(); cleanups.push(() => runtime.dispose(), () => bridge.dispose());
  const origin = 'http://localhost', registration = bridge.attachClient(origin, 'generation-client', 'web-locks-v1');
  const send = (event: any) => bridge.acceptClientEvent(registration.bridgeKey, origin, event);
  send({ type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['generation-owner'] });
  let bound = true;
  const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => runtime, isSessionBound: () => bound, send });
  cleanups.push(() => endpoint.dispose(), bridge.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); }));
  const agent = { id: 'generation-owner', session: {} };
  let onSessionEvent!: (session: any, event: any) => void, definition: any, jobHooks: any, jobResult: any;
  const jobProgress: string[] = [];
  const ctx = {
    on: (_name: string, callback: any) => { onSessionEvent = callback; return () => undefined; },
    get: (name: string) => name === 'jobs' ? { start: (spec: any) => {
      expect(spec.owner).toBe(agent.id); expect(api.invoke).not.toHaveBeenCalled();
      jobHooks = spec.run({ id: 'canvas-1', updateProgress: (value: string) => jobProgress.push(value) });
      void jobHooks.done.then((value: any) => { jobResult = value; }); return 'canvas-1';
    } } : undefined,
    effect: (fn: any) => { const dispose = fn(); if (dispose) cleanups.push(dispose); },
    tools: { register: (tool: any) => { definition = tool; } },
  };
  registerCanvasRunTools(ctx as any, bridge);
  onSessionEvent(agent.session, { type: 'user/message', seq: 1, data: { source: { kind: 'user' } } });
  const result = JSON.parse(await definition.execute({ canvasId: '2873', nodeIds: ['target'], expectedVersion: '18' }, { agent, callId: 'generate-once', signal: new AbortController().signal, deferContext: vi.fn() }));
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'submitted', results: [{ taskId: 'workflow-accepted', jobId: 'canvas-1' }] });
  expect(api.invoke).toHaveBeenCalledTimes(1);
  expect(api.invoke.mock.calls[0][0]).toMatchObject({ executeStrategy: 'single', runningNodeIds: ['target'] });
  const actualGraph = api.invoke.mock.calls[0][0].workflowData;
  expect(actualGraph.edges).toHaveLength(withReference ? 2 : 1);
  const inputs = util.getSourceMap(actualGraph.nodes, actualGraph.edges, target.id);
  expect(inputs.texts).toEqual([expect.objectContaining({ value: caption.data.value })]);
  expect(inputs.images).toHaveLength(withReference && referenceType === 'image' ? 1 : 0);
  expect(inputs.audios).toHaveLength(withReference && referenceType === 'audio' ? 1 : 0);
  if (withReference) expect((referenceType === 'audio' ? inputs.audios : inputs.images)[0].value).toBe(reference.data.value);
  if (type === 'audio' && modelType !== 'tts') expect(api.voice).not.toHaveBeenCalled();
  expect(document.querySelectorAll('iframe')).toHaveLength(0);
  // Changing the visible chat releases UI listeners, not this run's observer.
  bound = false; endpoint.releaseSession('generation-owner');
  send({ type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 2, sessionIds: [] });
  const generated = structuredClone(target); generated.data.taskInfo = { status: 'success', taskId: 'node-task-distinct-from-workflow' };
  generated.data.value = `https://assets.example/new.${extension}`; generated.data.product = [{ value: generated.data.value }];
  api.graph.mockResolvedValue(row(nodes.map(node => node.id === target.id ? generated : node), edges, '20', 'SUCCESS'));
  await vi.advanceTimersByTimeAsync(250);
  expect(jobResult?.status).toBe('completed');
  expect(JSON.parse(jobResult.result)).toMatchObject({
    status: 'completed', nodeIds: ['target'], actualOutputCount: 1, requestedOutputCount: 1, partial: false,
    results: [{ nodeId: 'target', phase: 'completed', workflowTaskId: 'workflow-accepted', nodeTaskId: 'node-task-distinct-from-workflow', outputs: [generated.data.value] }],
  });
  const reread = await runtime.execute({ canvasId: '2873', operation: { action: 'canvas.read', nodeIds: ['target'] } });
  expect(reread).toMatchObject({ status: 'read', version: '20', nodes: [{ status: 'success', outputs: [generated.data.value] }] });
  expect(api.invoke).toHaveBeenCalledTimes(1); expect(jobProgress.length).toBeGreaterThan(0);
});

it('batch run invokes one workflow and keeps the Job open until both node tasks finish', async () => {
  const first = makeNode('image', 'first', 'text_to_image');
  const second = makeNode('image', 'second', 'text_to_image');
  api.graph.mockResolvedValue(row([first, second]));
  const runtime = createCanvasServiceRuntime(), bridge = createCanvasHostBridge();
  cleanups.push(() => runtime.dispose(), () => bridge.dispose());
  const origin = 'http://localhost', registration = bridge.attachClient(origin, 'batch-client', 'web-locks-v1');
  const send = (event: any) => bridge.acceptClientEvent(registration.bridgeKey, origin, event);
  send({ type: 'session.sync', protocolVersion: 4, connectionId: registration.connectionId, revision: 1, sessionIds: ['batch-owner'] });
  const endpoint = createCanvasCommandEndpoint({ connectionId: registration.connectionId, getRuntime: async () => runtime, isSessionBound: () => true, send });
  cleanups.push(() => endpoint.dispose(), bridge.connectStream(registration.bridgeKey, origin, event => { void endpoint.handle(event); }));
  const agent = { id: 'batch-owner', session: {} };
  let onSessionEvent!: (session: any, event: any) => void, definition: any, jobResult: any;
  const ctx = {
    on: (_name: string, callback: any) => { onSessionEvent = callback; return () => undefined; },
    get: (name: string) => name === 'jobs' ? { start: (spec: any) => {
      const hooks = spec.run({ id: 'batch-job', updateProgress: () => undefined });
      void hooks.done.then((value: any) => { jobResult = value; });
      return 'batch-job';
    } } : undefined,
    effect: (fn: any) => { const dispose = fn(); if (dispose) cleanups.push(dispose); },
    tools: { register: (tool: any) => { definition = tool; } },
  };
  registerCanvasRunTools(ctx as any, bridge);
  onSessionEvent(agent.session, { type: 'user/message', seq: 1, data: { source: { kind: 'user' } } });
  const result = JSON.parse(await definition.execute({ canvasId: '2873', nodeIds: ['first', 'second'], expectedVersion: '18' },
    { agent, callId: 'batch-once', signal: new AbortController().signal, deferContext: vi.fn() }));
  expect(result).toMatchObject({ status: 'submitted', jobId: 'batch-job', results: [{ nodeId: 'first' }, { nodeId: 'second' }] });
  expect(api.invoke).toHaveBeenCalledTimes(1);
  expect(api.invoke.mock.calls[0][0]).toMatchObject({ executeStrategy: 'total' });

  const completedFirst = structuredClone(first);
  completedFirst.data.taskInfo = { status: 'success', taskId: 'first-native-task' };
  completedFirst.data.value = 'https://assets.example/first.png';
  completedFirst.data.product = [{ value: completedFirst.data.value }];
  const runningSecond = structuredClone(second);
  runningSecond.data.taskInfo = { status: 'running', taskId: 'second-native-task' };
  api.graph.mockResolvedValue(row([completedFirst, runningSecond], [], '20', 'RUNNING'));
  await vi.advanceTimersByTimeAsync(250);
  expect(jobResult).toBeUndefined();

  const completedSecond = structuredClone(runningSecond);
  completedSecond.data.taskInfo = { status: 'success', taskId: 'second-native-task' };
  completedSecond.data.value = 'https://assets.example/second.png';
  completedSecond.data.product = [{ value: completedSecond.data.value }];
  api.graph.mockResolvedValue(row([completedFirst, completedSecond], [], '21', 'SUCCESS'));
  await vi.advanceTimersByTimeAsync(10500);
  expect(jobResult?.status).toBe('completed');
  expect(JSON.parse(jobResult.result)).toMatchObject({
    results: [
      { nodeId: 'first', nodeTaskId: 'first-native-task', outputs: ['https://assets.example/first.png'] },
      { nodeId: 'second', nodeTaskId: 'second-native-task', outputs: ['https://assets.example/second.png'] },
    ],
  });
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it.each(['capacity-502', 'capacity-timeout', 'capacity-cancelled'])('batch %s rejects before submission without leaving node or canvas fences', async message => {
  api.graph.mockResolvedValue(row([
    makeNode('image', 'first', 'text_to_image'), makeNode('image', 'second', 'text_to_image'),
  ]));
  const runtime = createCanvasServiceRuntime(); cleanups.push(() => runtime.dispose());
  const info = await runtime.ensureContext({ canvasId: '2873', capability: 'run' });
  const controller = new AbortController();
  api.capacity.mockImplementationOnce(async () => {
    if (message === 'capacity-cancelled') controller.abort();
    throw Object.assign(new Error(message), { requestPhase: 'sent_unknown', ...(message === 'capacity-502' ? { status: 502 } : {}) });
  });
  const result = await runtime.execute({ canvasId: '2873', expectedContextId: info.contextId, signal: controller.signal, operation: {
    action: 'workflow.run', expectedVersion: '18', nodeIds: ['first', 'second'],
    approvedGenerations: { first: { images: 1, videos: 0 }, second: { images: 1, videos: 0 } },
    runRequestIds: { first: 'capacity-first', second: 'capacity-second' },
  } });
  expect(api.invoke).not.toHaveBeenCalled();
  expect(result).toMatchObject({ status: 'rejected', effect: 'none', version: '18', error: { code: message === 'capacity-cancelled' ? 'CANCELLED_BEFORE_DISPATCH' : 'RUN_REJECTED' } });
  if (message !== 'capacity-cancelled') expect(result).toHaveProperty('error.message', message);
  expect(runtime.getContextInfo('2873')?.readiness.capabilities).toMatchObject({ edit: true, run: true });
  for (const nodeId of ['first', 'second']) {
    expect(await runtime.execute({ canvasId: '2873', operation: { action: 'node.preflight', expectedVersion: '18', nodeId } })).toMatchObject({ status: 'preflight', nodeId });
  }
});

it('batch invoke transport uncertainty remains unknown and prevents resubmission', async () => {
  api.graph.mockResolvedValue(row([
    makeNode('image', 'first', 'text_to_image'), makeNode('image', 'second', 'text_to_image'),
  ]));
  const runtime = createCanvasServiceRuntime(); cleanups.push(() => runtime.dispose());
  const info = await runtime.ensureContext({ canvasId: '2873', capability: 'run' });
  const operation = {
    action: 'workflow.run' as const, expectedVersion: '18', nodeIds: ['first', 'second'],
    approvedGenerations: { first: { images: 1, videos: 0 }, second: { images: 1, videos: 0 } },
    runRequestIds: { first: 'uncertain-first', second: 'uncertain-second' },
  };
  api.invoke.mockRejectedValueOnce(Object.assign(new Error('invoke response lost'), { requestPhase: 'sent_unknown' }));
  expect(await runtime.execute({ canvasId: '2873', expectedContextId: info.contextId, operation })).toMatchObject({ status: 'submission_unknown', phase: 'run', affectedNodeIds: ['first', 'second'] });
  expect(api.invoke).toHaveBeenCalledTimes(1);
  expect(runtime.getContextInfo('2873')?.readiness.capabilities).toMatchObject({ edit: false, run: false });
  expect(await runtime.execute({ canvasId: '2873', operation })).toMatchObject({ status: 'rejected', error: { code: 'SUBMISSION_UNKNOWN' } });
  expect(api.invoke).toHaveBeenCalledTimes(1);
});


it.each(['image_upscale', 'video_upscale', 'auto_matting'] as const)('process %s traverses actual Host/SSE/runtime/Store/Jobs without iframe or repeated dispatch', async kind => {
  const isVideo = kind === 'video_upscale';
  const source = makeNode(isVideo ? 'video' : 'image', 'original', isVideo ? 'image_to_video' : 'text_to_image');
  source.data.type = 'upload'; source.data.value = `https://assets.example/original.${isVideo ? 'mp4' : 'png'}`;
  api.graph.mockResolvedValue(row([source]));
  api.tools.mockResolvedValue(success(['highDefinitionTool','highDefinitionVideoTool','imageLayoutTool','imageEditorTool'].map(tool_key=>({tool_key,visible:1,enabled:1}))));
  let version = 18, submissionCount = 0, outputIds: string[] = [];
  api.update.mockImplementation(async () => success({ versionNumber: String(++version) }));
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    let data: any = {};
    if (String(url).includes('/points')) data = 1;
    else if (String(url).endsWith('/desktop/matting')) data = { mattingImageUrl: 'https://assets.example/matted.png' };
    else if (String(url).endsWith('/external-task')) { submissionCount++; outputIds = JSON.parse(String(options?.body)).data.childNodeIds; data = { taskId: 'external-accepted', versionNumber: String(++version) }; }
    else if (String(url).endsWith('/external-task/result')) data = { status:'SUCCESS',versionNumber:String(++version),childNodeInfo:Object.fromEntries(outputIds.map(id=>[id,`https://assets.example/${id}.${isVideo?'mp4':'png'}`])) };
    return { ok:true,status:200,json:async()=>success(data) };
  }));
  const runtime = createCanvasServiceRuntime(), bridge = createCanvasHostBridge(); cleanups.push(()=>runtime.dispose(),()=>bridge.dispose());
  const registration=bridge.attachClient('http://localhost', 'process-client', 'web-locks-v1');
  const send=(event:any)=>bridge.acceptClientEvent(registration.bridgeKey,'http://localhost',event);
  send({type:'session.sync',protocolVersion:4,connectionId:registration.connectionId,revision:1,sessionIds:['process-owner']});
  const endpoint=createCanvasCommandEndpoint({connectionId:registration.connectionId,getRuntime:async()=>runtime,isSessionBound:()=>true,send});
  cleanups.push(()=>endpoint.dispose(),bridge.connectStream(registration.bridgeKey,'http://localhost',event=>{void endpoint.handle(event)}));
  const session={id:'process-owner',header:{createdAt:1}},agent={id:'process-owner',session};let definition:any,outcome:any,eventHandler:any;
  const ctx:any={on:(_name:string,fn:any)=>{eventHandler=fn},effect:(fn:any)=>{const stop=fn();if(stop)cleanups.push(stop)},tools:{register:(tool:any)=>{definition=tool}},logger:{warn:vi.fn()},get:(name:string)=>name==='jobs'?{start:(spec:any)=>{const hooks=spec.run({id:'process-job',updateProgress:vi.fn()});void hooks.done.then((value:any)=>{outcome=value});return'process-job'}}:undefined};
  const captured:any[]=[];registerCanvasProcessTools(ctx,bridge,{record:async(binding:any,state:any)=>{captured.push({binding,state})}} as any);
  eventHandler(session,{type:'user/message',seq:1,data:{source:{kind:'user'}}});eventHandler(session,{type:'tool/call',seq:2,data:{callId:'process-call',turn:1}});
  const result=JSON.parse(await definition.execute({canvasId:'2873',expectedVersion:'18',kind,sourceNodeId:'original'},{agent,callId:'process-call',rootCallId:'process-call',signal:new AbortController().signal}));
  expect(result).toMatchObject({status:'process_submitted',jobId:'process-job'});expect(document.querySelectorAll('iframe')).toHaveLength(0);
  if(kind!=='auto_matting') await vi.advanceTimersByTimeAsync(250);
  expect(outcome?.status).toBe('completed');expect(captured).toHaveLength(1);expect(captured[0].state.nodeId).toBe(result.outputNodeIds[0]);expect(captured[0].state.operationId).toBeTruthy();
  const read=await runtime.execute({canvasId:'2873',operation:{action:'canvas.read',nodeIds:result.outputNodeIds}});expect(read.status).toBe('read');if(read.status==='read')expect(read.nodes[0].outputs).toHaveLength(1);
  expect(submissionCount).toBe(kind==='auto_matting'?0:1);expect(api.invoke).not.toHaveBeenCalled();
});
