import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const api=vi.hoisted(()=>({update:vi.fn(),save:vi.fn(),invoke:vi.fn(),request:vi.fn(),capacity:vi.fn(),points:vi.fn()}));
vi.mock('@/api/workflow',()=>({updateCanvas:api.update,saveFlow:api.save,excuteWorkFlow:api.invoke}));
vi.mock('../src/request',()=>({request:api.request}));
vi.mock('@/components/canvasFlow/utils/mediaDimensionLoader',()=>({loadIntrinsicMediaDimensions:vi.fn().mockResolvedValue(null)}));
vi.mock('@/components/common/storageLimitManager',()=>({openStorageLimitDialog:vi.fn()}));
vi.mock('@/api/asset',()=>({getAvailableCapacity:api.capacity}));
vi.mock('@/utils',()=>({isSvgImageUrl:()=>false,compressImage:vi.fn()}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),warning:vi.fn(),info:vi.fn()}}));
import { createFlowStoreApi } from '../legacy/src/store/flowStoreCore';
import { createAgentEditGuard } from '../src/agent-edit-guard';
import { createCanvasVersionBarrier } from '../legacy/src/lib/canvasVersionBarrier';
import { createCanvasRunTracker } from '../src/canvas-run-tracker';
import { preflightProcess, startProcess, readProcessCapabilities } from '../src/canvas-process';
import { createCanvasAgentAdapter } from '../src/agent-adapter';
import { parseCanvasOperationResult } from '../../src/shared/canvas-agent-protocol';
import { processOwnedBy } from '../src/process-ownership';
import { PROCESS_KINDS } from '../../src/shared/canvas-process-protocol';

const nodes=(type='image')=>[{id:'source',type,position:{x:0,y:0},width:400,height:400,data:{title:'原素材',type:'upload',value:`https://assets.example/source.${type==='video'?'mp4':'png'}`,params:{},taskInfo:{status:'success'}}}];
const cleanups:Array<()=>void>=[];
function fixture(type='image'){
  const guard=createAgentEditGuard(),barrier=createCanvasVersionBarrier(),store=createFlowStoreApi({guard,barrier}),runs=createCanvasRunTracker('2873');let version=18;
  const model={value:'layers',label:'分层',seniorParams:[],params:[{field:'num_layers',label:'层数',default:2,choices:[2,3].map(value=>({label:String(value),value}))},{field:'resolution',label:'分辨率',default:'1K',choices:[{label:'1K',value:'1K'}]}]};
  store.setState({canvasId:'2873',versionNumber:'18',nodes:nodes(type) as any,toolNodePermission:{highDefinitionTool:{visible:true,enabled:true},highDefinitionVideoTool:{visible:true,enabled:true},imageLayoutTool:{visible:true,enabled:true},imageEditorTool:{visible:true,enabled:true}},modelsMap:{imageLayoutTool:[model],image:[],video:[]}});
  api.update.mockImplementation(async()=>({code:'SUCCESS',data:{versionNumber:String(++version)}}));
  const listeners=new Set<any>();
  const context:any={canvasId:'2873',contextId:'context',store,guard,barrier,runs,requestOptions:()=>({}),getInitialization:()=>({models:{status:'ready'},modelPermission:{status:'ready'},toolPermission:{status:'ready'}}),getInfo:()=>({readiness:{capabilities:{read:true,edit:true,run:true}}}),initialize:async()=>{},subscribeReadiness:(fn:any)=>{listeners.add(fn);return()=>listeners.delete(fn)},points:{getState:()=>({actions:{updateUserPoint:api.points}})}};
  cleanups.push(()=>{listeners.forEach(fn=>fn({phase:'disposed'}));runs.dispose();guard.dispose()});
  const plan=async(kind:any,params?:any)=>{await store.getState().actions.awaitMutationsIdle();return preflightProcess(context,{kind,sourceNodeId:'source',...(params?{params}:{})},String(store.getState().versionNumber))};
  const run=async(p:any,id='process-one')=>startProcess(context,p.planId,p.nodeId,p.version,p.generation,id);
  return{context,store,guard,runs,plan,run};
}
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.stubGlobal('crypto',webcrypto);api.capacity.mockResolvedValue({code:'SUCCESS',data:{usedCapacity:0,limitCapacity:100}});api.request.mockImplementation(async(url:string)=>url.includes('/points')||url.includes('/cost/')?{code:'SUCCESS',data:1}:{code:'SUCCESS',data:{taskId:'task-one',versionNumber:'20'}})});
afterEach(()=>{cleanups.splice(0).reverse().forEach(fn=>fn());vi.useRealTimers();vi.unstubAllGlobals()});
it('capability discovery is read-only and follows real tool permissions',()=>{
  const f=fixture();expect(readProcessCapabilities(f.context).processes.map(p=>p.kind)).toEqual(PROCESS_KINDS);expect(api.update).not.toHaveBeenCalled();expect(api.request).not.toHaveBeenCalled();
  f.store.setState({toolNodePermission:{}});expect(readProcessCapabilities(f.context).processes.every(p=>!p.available)).toBe(true);
});
it.each(['image_upscale','video_upscale','image_layering'] as const)('%s creates native linked outputs once and persists new products before publishing completion',async kind=>{
  const f=fixture(kind==='video_upscale'?'video':'image'),p=await f.plan(kind);expect(parseCanvasOperationResult(p)).toEqual(p);expect(api.update).not.toHaveBeenCalled();
  const result=await f.run(p);expect(result.status).toBe('process_submitted');expect(api.request.mock.calls.filter(([u])=>u.endsWith('/external-task'))).toHaveLength(1);expect(api.points).toHaveBeenCalledTimes(1);
  expect(f.store.getState().nodes).toHaveLength(2+p.outputNodeIds.length);expect(f.store.getState().edges).toHaveLength(1+p.outputNodeIds.length);expect(f.store.getState().edges.every(e=>e.className===e.sourceHandle)).toBe(true);expect(f.store.getState().nodes[0].data.value).toContain('/source.');
  const mapping=Object.fromEntries(p.outputNodeIds.map((id:string,i:number)=>[id,`https://assets.example/result-${i}.png`]));
  api.request.mockImplementation(async(url:string)=>{expect(url).toContain('/external-task/result');return{code:'SUCCESS',data:{status:'SUCCESS',versionNumber:'22',childNodeInfo:mapping}}});
  await vi.advanceTimersByTimeAsync(250);const state=f.runs.get('process-one');expect(state?.phase).toBe('completed');expect(state?.products?.map(p=>p.nodeId)).toEqual(p.outputNodeIds);expect(state?.outputs).toHaveLength(p.outputNodeIds.length);
  for(const id of p.outputNodeIds)expect(f.store.getState().nodes.find(n=>n.id===id)?.data.value).toBe(mapping[id]);expect(api.points).toHaveBeenCalledTimes(2);
});
it('automatic matting preserves the original and uses a local operation identity without fabricating a cloud task',async()=>{
  const f=fixture(),p=await f.plan('auto_matting');api.request.mockResolvedValue({code:'SUCCESS',data:{mattingImageUrl:'https://assets.example/transparent.png'}});
  expect((await f.run(p)).status).toBe('process_submitted');expect(f.store.getState().nodes).toHaveLength(2);expect(f.store.getState().edges).toHaveLength(1);
  const state=f.runs.get('process-one');expect(state).toMatchObject({phase:'completed',operationId:'process-one',products:[{nodeId:p.nodeId,url:'https://assets.example/transparent.png'}]});expect(state).not.toHaveProperty('nodeTaskId');expect(f.store.getState().nodes[0].data.value).toContain('source.png');
});
it('keeps the real partial results when some layers are missing',async()=>{
  const f=fixture(),p=await f.plan('image_layering');await f.run(p);
  api.request.mockResolvedValue({code:'SUCCESS',data:{status:'SUCCESS',versionNumber:'22',childNodeInfo:{[p.outputNodeIds[0]]:'https://assets.example/one.png'}}});
  await vi.advanceTimersByTimeAsync(250);expect(f.runs.get('process-one')).toMatchObject({phase:'failed',outputs:['https://assets.example/one.png']});
});
it('unknown task submission stops after one dispatch and preserves saved node identities',async()=>{
  const f=fixture(),p=await f.plan('image_upscale');api.request.mockRejectedValue(Object.assign(new Error('network timeout'),{requestPhase:'sent_unknown'}));
  const result=await f.run(p);expect(result.status).toBe('process_partial');expect(result).toHaveProperty('affectedNodeIds');expect(f.runs.get('process-one')?.phase).toBe('submission_unknown');await vi.advanceTimersByTimeAsync(10000);expect(api.request).toHaveBeenCalledTimes(2);
});
it('rejects changed sources, stale versions, user drafts and unavailable permissions before writing',async()=>{
  const f=fixture(),p=await f.plan('image_upscale');f.store.setState({nodes:f.store.getState().nodes.map(n=>({...n,data:{...n.data,value:'https://assets.example/new.png'}}))});await expect(f.run(p)).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(api.update).not.toHaveBeenCalled();
  f.guard.markEditorBusy('draft',true);await expect(f.plan('image_upscale')).rejects.toMatchObject({code:'EDITOR_BUSY'});f.guard.markEditorBusy('draft',false);
  f.store.setState({toolNodePermission:{}});await expect(f.plan('image_upscale')).rejects.toMatchObject({code:'CONFIGURATION_ERROR'});
});
it('native strict graph delta leaves state unchanged on definite save refusal and fences unknown saves',async()=>{
  const f=fixture();api.update.mockRejectedValueOnce(Object.assign(new Error('refused'),{requestPhase:'rejected'}));
  await expect(f.store.getState().actions.applyAgentDelta(()=>({updateNodes:[{id:'source',position:{x:999,y:0}}]}),{strictReceipt:true,expectedVersion:'18'})).rejects.toThrow('refused');expect(f.store.getState().nodes[0].position.x).toBe(0);
  api.update.mockRejectedValueOnce(Object.assign(new Error('unknown'),{requestPhase:'sent_unknown'}));await expect(f.store.getState().actions.applyAgentDelta(()=>({updateNodes:[{id:'source',position:{x:999,y:0}}]}),{strictReceipt:true,expectedVersion:'18'})).rejects.toThrow('unknown');expect(f.store.getState().agentPersistenceIssue?.code).toBe('SUBMISSION_UNKNOWN');
});
it('layout saves only the native affected positions and never submits generation',async()=>{
  const f=fixture();f.store.setState({nodes:[...nodes(),{...nodes()[0],id:'second',position:{x:5,y:4}},{...nodes()[0],id:'untouched',position:{x:-999,y:1}}] as any});
  const result=await createCanvasAgentAdapter(f.context).execute({action:'canvas.layout',expectedVersion:'18',nodeIds:['source','second'],mode:'horizontal'});expect(result.status).toBe('saved');expect(f.store.getState().nodes[2].position.x).toBe(-999);expect(api.invoke).not.toHaveBeenCalled();expect(api.request).not.toHaveBeenCalled();
});

it('selected non-current output gets an immutable native reference node and downstream uses the chosen product', async () => {
  const f = fixture(); const source = f.store.getState().nodes[0];
  f.store.setState({ nodes: [{ ...source, data: { ...source.data, product: [{ value: 'https://assets.example/selected.png' }] } }] });
  const p = await preflightProcess(f.context, { kind: 'image_upscale', sourceNodeId: 'source', outputIndex: 1 }, '18');
  await f.run(p);
  const snapshot = f.store.getState().nodes.find(n => n.data.value === 'https://assets.example/selected.png')!;
  expect(snapshot).toBeTruthy(); expect(f.store.getState().edges.some(e => e.source === snapshot.id && e.target === p.nodeId)).toBe(true);
  const submit = api.request.mock.calls.find(([url]) => url.endsWith('/external-task'))!;
  expect(submit[1].data.imageUrlList).toEqual(['https://assets.example/selected.png']);
});
it('backend failure is saved on the real nodes rather than leaving an indefinite loading state', async () => {
  const f = fixture(), p = await f.plan('image_upscale'); await f.run(p);
  api.request.mockResolvedValue({ code: 'SUCCESS', data: { status: 'FAILURE', versionNumber: '22', message: 'service refused' } });
  await vi.advanceTimersByTimeAsync(250);
  expect(f.runs.get('process-one')?.phase).toBe('failed');
  expect(f.store.getState().nodes.find(n => n.id === p.outputNodeIds[0])?.data.taskInfo).toMatchObject({ status: 'failure' });
});

it('repeating unchanged layout does not write or advance the saved version', async () => {
  const f = fixture();
  f.store.setState({ nodes: [...nodes(), { ...nodes()[0], id: 'second', position: { x: 5, y: 4 } }] as any });
  const adapter = createCanvasAgentAdapter(f.context);
  await adapter.execute({ action: 'canvas.layout', expectedVersion: '18', nodeIds: ['source', 'second'], mode: 'grid' });
  const version = String(f.store.getState().versionNumber), writes = api.update.mock.calls.length;
  const repeated = await adapter.execute({ action: 'canvas.layout', expectedVersion: version, nodeIds: ['source', 'second'], mode: 'grid' });
  expect(repeated).toMatchObject({ status: 'saved', version, unchanged: true, affectedNodeIds: [] });
  expect(api.update).toHaveBeenCalledTimes(writes);
});
it('layout expands native grouped children and reports all actually moved nodes', async () => {
  const f = fixture();
  f.store.setState({ nodes: [
    { id: 'group', type: 'group', position: { x: 100, y: 100 }, style: { width: 900, height: 900 }, data: {} },
    ...nodes().map(n => ({ ...n, parentId: 'group', position: { x: 20, y: 20 } })),
    { ...nodes()[0], id: 'sibling', parentId: 'group', position: { x: 22, y: 22 } },
    { ...nodes()[0], id: 'untouched', position: { x: -1000, y: 1 } },
  ] as any });
  const result = await createCanvasAgentAdapter(f.context).execute({ action: 'canvas.layout', expectedVersion: '18', nodeIds: ['source'], mode: 'horizontal' });
  expect(result).toMatchObject({ status: 'saved' });
  expect((result as any).affectedNodeIds).toContain('sibling');
  expect(f.store.getState().nodes.find(n => n.id === 'untouched')?.position).toEqual({ x: -1000, y: 1 });
});
it('definite processing refusal persists failed prepared nodes without retrying the upstream call', async () => {
  const f = fixture(), p = await f.plan('image_upscale');
  api.request.mockRejectedValue(Object.assign(new Error('permission denied'), { requestPhase: 'rejected' }));
  const result = await f.run(p);
  expect(result).toMatchObject({ status: 'process_partial', error: { code: 'RUN_REJECTED' } });
  expect(f.runs.get('process-one')?.phase).toBe('failed');
  for (const id of [p.nodeId, ...p.outputNodeIds]) expect(f.store.getState().nodes.find(n => n.id === id)?.data.taskInfo).toMatchObject({ status: 'failure' });
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.request.mock.calls.filter(([url]) => url.endsWith('/external-task'))).toHaveLength(1);
});

it('processing uses the exact public output order and never shifts past an unsupported URL', async () => {
  const f = fixture(), source = f.store.getState().nodes[0];
  f.store.setState({ nodes: [{ ...source, data: { ...source.data, value: 'http://assets.example/old.png', product: [{ value: 'https://assets.example/chosen.png' }] } }] });
  await expect(preflightProcess(f.context, { kind: 'image_upscale', sourceNodeId: 'source', outputIndex: 0 }, '18')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  const p = await preflightProcess(f.context, { kind: 'image_upscale', sourceNodeId: 'source', outputIndex: 1 }, '18');
  await f.run(p);
  expect(api.request.mock.calls.find(([url]) => url.endsWith('/external-task'))![1].data.imageUrlList).toEqual(['https://assets.example/chosen.png']);
});

it.each(['rejected', 'sent_unknown'])('accepted upstream task retains its identity when task-binding save is %s', async requestPhase => {
  const f = fixture(), p = await f.plan('image_upscale');
  api.update.mockResolvedValueOnce({ code: 'SUCCESS', data: { versionNumber: '19' } }).mockRejectedValueOnce(Object.assign(new Error('binding save lost'), { requestPhase }));
  const result = await f.run(p);
  expect(result).toMatchObject({ status: 'process_partial', taskId: 'task-one', version: null, error: { code: 'SUBMISSION_UNKNOWN', retry: 'never_auto' } });
  expect(f.runs.get('process-one')).toMatchObject({ phase: 'submission_unknown', nodeTaskId: 'task-one' });
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.request.mock.calls.filter(([url]) => url.endsWith('/external-task'))).toHaveLength(1);
});
it('monitor ownership is scoped to the correct Context Store and released on disposal', async () => {
  const a = fixture(), b = fixture(), p = await a.plan('image_upscale');
  await a.run(p);
  expect(processOwnedBy(a.store, p.nodeId)).toBe(true);
  expect(processOwnedBy(b.store, p.nodeId)).toBe(false);
  cleanups.splice(0).reverse().forEach(fn => fn());
  expect(processOwnedBy(a.store, p.nodeId)).toBe(false);
});
it('an identical result URL in a later process still belongs to its fresh result node', async () => {
  const f = fixture(), p = await f.plan('auto_matting');
  api.request.mockResolvedValue({ code: 'SUCCESS', data: { mattingImageUrl: 'https://assets.example/same.png' } });
  await f.run(p);
  const second = await f.plan('auto_matting');
  await f.run(second, 'process-two');
  expect(second.nodeId).not.toBe(p.nodeId);
  expect(f.runs.get('process-two')).toMatchObject({ phase: 'completed', products: [{ nodeId: second.nodeId, url: 'https://assets.example/same.png' }] });
});

it('balance refresh failure cannot change a completed processing receipt', async () => {
  const f = fixture(), p = await f.plan('auto_matting');
  api.request.mockResolvedValue({ code: 'SUCCESS', data: { mattingImageUrl: 'https://assets.example/transparent.png' } });
  api.points.mockRejectedValueOnce(new Error('balance temporarily unavailable'));
  expect(await f.run(p)).toMatchObject({ status: 'process_submitted' });
  expect(f.runs.get('process-one')?.phase).toBe('completed');
});
