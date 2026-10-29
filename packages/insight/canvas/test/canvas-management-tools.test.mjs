import assert from 'node:assert/strict'
import test from 'node:test'
import { registerCanvasManagementTools, parseCanvasList } from '../src/host/canvas-management-tools.ts'
import { parseCanvasOperation, parseCanvasOperationResult } from '../src/shared/canvas-agent-protocol.ts'
import { parseProcessInput } from '../src/shared/canvas-process-protocol.ts'
import { createCanvasOpener } from '../src/client/canvas-open.ts'
import { canvasIdAnswer } from '../src/shared/canvas-message-links.ts'

const canvasId='103334'
test('canvas list validates identity, pagination and Long IDs without guessing broken data is empty',()=>{
  assert.deepEqual(parseCanvasList({code:'SUCCESS',data:{records:[{id:'90071992547409931',name:'耳机'}],total:2}},1,1),{status:'listed',canvases:[{canvasId:'90071992547409931',name:'耳机',address:'dsh-resource://canvas/90071992547409931'}],page:1,limit:1,total:2,nextPage:2})
  for(const body of [{code:'SUCCESS',data:{}},{code:'FAILURE',data:[]},{code:'SUCCESS',data:[{id:90071992547409930,name:'bad'}]}])assert.throws(()=>parseCanvasList(body,1,20))
})
test('management tools use read-only navigation/capability paths and strict writes for layout',async()=>{
  const tools=new Map(),calls=[]
  const bridge={ensureContext:async(...args)=>{calls.push(['prepare',...args]);return{contextId:'ctx'}},dispatch:async(_target,_request,op)=>{calls.push(op);return op.action==='canvas.layout'?{status:'saved',canvasId,version:'2',affectedNodeIds:['n'],unchanged:false}:{status:'opened',canvasId,version:null,content:'loading',focus:'not_requested'}}}
  registerCanvasManagementTools({tools:{register:tool=>tools.set(tool.name,tool)}},bridge,async(op,args)=>{calls.push([op,args]);return{code:'SUCCESS',data:[]}})
  const exec={agent:{id:'session'},callId:'one',signal:new AbortController().signal}
  const invoke=async(name,input)=>JSON.parse(await tools.get(name).execute(input,exec))
  assert.equal((await invoke('canvas_open',{canvasId})).status,'opened');assert.equal(calls[0][3],'read')
  assert.equal((await invoke('canvas_layout',{canvasId,expectedVersion:'1',nodeIds:['n'],mode:'grid'})).status,'saved');assert.equal(calls[2][3],'edit')
  const count=calls.length
  for(const input of [{canvasId,sessionId:'forged'},{canvasId,url:'https://x.test'},{canvasId,nodeId:'x'.repeat(101)}])assert.equal((await invoke('canvas_open',input)).status,'rejected')
  assert.equal(calls.length,count)
  assert.equal((await invoke('canvas_list',{name:'耳机'})).status,'listed')
})
test('processing contracts reject arbitrary URLs, forged permission fields and mismatched kind parameters',()=>{
  for(const input of [{kind:'auto_matting',sourceNodeId:'n',params:{resolution:'4K'}},{kind:'image_upscale',sourceNodeId:'n',params:{model:'x'}},{kind:'image_layering',sourceNodeId:'n',params:{num_layers:0}},{kind:'video_upscale',sourceNodeId:'n',url:'https://x.test'},{kind:'image_upscale',sourceNodeId:'n',outputIndex:20}])assert.throws(()=>parseProcessInput(input))
  const op=parseCanvasOperation({action:'process.preflight',expectedVersion:'2',kind:'image_upscale',sourceNodeId:'n',params:{resolution:'4K'}});assert.equal(op.kind,'image_upscale')
  assert.throws(()=>parseCanvasOperation({...op,approvedGeneration:{images:1,videos:0}}))
  assert.throws(()=>parseCanvasOperationResult({status:'process_submitted',canvasId,version:'1',nodeId:'n',operationId:'op',outputNodeIds:['out'],generation:{images:1,videos:0},secret:'x'}))
})
test('opening only acknowledges navigation; focus waits for the actual view result and refuses foreign sessions',async()=>{
  let session='s',opened
  const opener=createCanvasOpener({currentSession:()=>session,open:(...args)=>{opened=args},timeoutMs:20})
  assert.deepEqual(await opener.open('s',canvasId),{status:'opened',canvasId,version:null,content:'loading',focus:'not_requested'})
  const focused=opener.open('s',canvasId,'node');const token=opened[2]
  opener.settled('foreign','focused');opener.settled(token,'focused');assert.equal((await focused).focus,'focused')
  session='other';await assert.rejects(()=>opener.open('s',canvasId),{code:'CONTEXT_INACTIVE'})
  session='s';const pending=opener.open('s',canvasId,'missing');opener.settled(opened[2],'node_missing');assert.equal((await pending).focus,'node_missing')
  const timeout=opener.open('s',canvasId,'slow');assert.equal((await timeout).focus,'view_unavailable');opener.dispose()
})
test('concise canvas ID answer accepts a verified canonical matching link and leaves code/ordinary replies native',()=>{
  const original='当前画布 ID：[103334](dsh-resource://canvas/103334)。'
  assert.deepEqual(canvasIdAnswer(original),{id:'103334',address:'dsh-resource://canvas/103334'})
  for(const text of ['`'+original+'`','```markdown\n'+original+'\n```','[网站](https://example.com)','![图](dsh-resource://canvas/103334)','当前画布 ID：[103334](dsh-resource://canvas/103335)。',original+'名称：耳机'])assert.equal(canvasIdAnswer(text),undefined)
})
