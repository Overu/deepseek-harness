import { createCanvasIntentBudget } from '../src/host/canvas-intent-budget.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { registerCanvasProcessTools } from '../src/host/canvas-process-tools.ts'
import { registerCanvasRunTools } from '../src/host/canvas-run-tools.ts'
import { parseCanvasOperationResult, assertCanvasResultMatches } from '../src/shared/canvas-agent-protocol.ts'

function fixture(t,{decline=false,fast=false}={}){
  const tools=new Map(),handlers=[],effects=[],jobs=[],calls=[],listeners=new Map(),recorded=[]
  const session={id:'owner',header:{createdAt:1}},agent={id:'owner',session}
  const ctx={tools:{register:tool=>tools.set(tool.name,tool)},on:(_name,handler)=>handlers.push(handler),effect:fn=>effects.push(fn()),logger:{warn:()=>{}},get:name=>name==='jobs'?{start:spec=>{const id='job-'+(jobs.length+1),hooks=spec.run({id,updateProgress:()=>{}});jobs.push({id,hooks});return id}}:name==='userQuestions'?{ask:async()=>{calls.push('confirm');return{answers:[{id:'canvas-generation-volume',selected:[decline?'暂不生成':'确认生成']}]}}}:undefined}
  const target={canvasId:'2873',sessionId:'owner',connectionId:'client',contextId:'context',readiness:{version:'1',phase:'ready',capabilities:{read:true,edit:true,run:true}}}
  const state=request=>({requestId:request,canvasId:'2873',nodeId:'processor',operationId:request,sequence:1,phase:'completed',version:'4',generation:{images:1,videos:0},outputs:['https://assets.example/new.png'],products:[{nodeId:'output',url:'https://assets.example/new.png'}]})
  const bridge={ensureContext:async()=>target,subscribeRun:(_target,request,fn)=>{listeners.set(request,fn);return()=>listeners.delete(request)},dispatch:async(_target,request,op)=>{
    calls.push(op.action)
    if(op.action==='node.preflight')return{status:'preflight',canvasId:'2873',version:'1',nodeId:op.nodeId,generation:{images:30,videos:0},quote:{points:1,originalPoints:null}}
    if(op.action==='node.run')return{status:'submitted',canvasId:'2873',version:'2',nodeId:op.nodeId,taskId:'native-task',generation:op.approvedGeneration}
    if(op.action==='process.preflight')return{status:'process_ready',canvasId:'2873',version:'2',planId:'plan',nodeId:'processor',outputNodeIds:['output'],generation:{images:1,videos:0},quote:{points:1,originalPoints:null}}
    assert.equal(op.action,'process.run');if(fast)listeners.get(request)?.(state(request));return{status:'process_submitted',canvasId:'2873',version:'3',nodeId:'processor',outputNodeIds:['output'],operationId:request,generation:{images:1,videos:0}}
  }}
  const budget=createCanvasIntentBudget();registerCanvasRunTools(ctx,bridge,{budget});registerCanvasProcessTools(ctx,bridge,{record:async(binding,state)=>recorded.push({binding,state})},undefined,budget)
  t.after(()=>effects.reverse().forEach(fn=>fn?.()))
  const event=value=>handlers.forEach(handler=>handler(session,value));event({type:'user/message',seq:1,data:{source:{kind:'user'}}})
  return{tools,calls,recorded,jobs,async invoke(name,input,id=name){event({type:'tool/call',seq:2,data:{callId:id,turn:1}});return JSON.parse(await tools.get(name).execute(input,{agent,callId:id,rootCallId:id,signal:new AbortController().signal}))}}
}
test('processing shares the real user-intent volume with canvas_run, so changing tools cannot bypass confirmation',async t=>{
  const f=fixture(t,{decline:true});assert.equal((await f.invoke('canvas_run',{canvasId:'2873',expectedVersion:'1',nodeIds:['ordinary']})).status,'submitted')
  const processed=await f.invoke('canvas_process',{canvasId:'2873',expectedVersion:'2',kind:'image_upscale',sourceNodeId:'source'})
  assert.equal(processed.error.code,'CONFIRMATION_DECLINED');assert.equal(f.calls.filter(x=>x==='confirm').length,1);assert(!f.calls.includes('process.run'))
})
test('processing captures fast terminal output before submission receipt and records the actual output node',async t=>{
  const f=fixture(t,{fast:true}),input={canvasId:'2873',expectedVersion:'2',kind:'auto_matting',sourceNodeId:'source'}
  const value=await f.invoke('canvas_process',input,'same');assert.equal(value.status,'process_submitted');assert.equal(f.recorded.length,1);assert.equal(f.recorded[0].state.nodeId,'output');assert.equal(f.recorded[0].state.products,undefined)
  await f.jobs[0].hooks.done;assert.equal(f.calls.filter(x=>x==='process.run').length,1)
  assert.equal((await f.invoke('canvas_process',input,'same')).status,'process_submitted');assert.equal(f.calls.filter(x=>x==='process.run').length,1)
  assert.equal((await f.invoke('canvas_process',{...input,sourceNodeId:'different'},'same')).error.code,'DUPLICATE_REQUEST_MISMATCH')
})
test('operation families do not accept substituted receipts or invalid canvas identities',()=>{
  assert.throws(()=>parseCanvasOperationResult({status:'opened',canvasId:'invalid',version:null,content:'loading',focus:'not_requested'}))
  const ordinary={action:'node.run',nodeId:'ordinary',expectedVersion:'1',approvedGeneration:{images:1,videos:0}}
  assert.throws(()=>assertCanvasResultMatches(ordinary,{status:'process_submitted',canvasId:'2873',nodeId:'ordinary',version:'2',operationId:'run',outputNodeIds:['out'],generation:{images:1,videos:0}}))
})
