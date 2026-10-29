import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mattingHandler, authorizedMattingSource } from '../src/host/matting-route.ts'
const path='/desktop-canvas/api/legacy/game-ai-editor-center/api/desktop/matting'
const source='https://assets.example/product.png',input={canvasId:'103334',sourceNodeId:'source',outputIndex:0,expectedSourceUrl:source}
const envelope={code:'SUCCESS',data:{data:JSON.stringify({nodes:[{id:'source',type:'image',data:{value:source,product:[]}}]})}}
async function fixture(t,options={}){
  const calls=[];const handler=mattingHandler({requestRejection:()=>options.unauthorized?403:undefined},{read:async(...args)=>{calls.push(['read',...args]);return envelope},token:async()=> 'fixture-token',transport:async(url,opts)=>{calls.push(['matting',url,JSON.parse(opts.body)]);if(options.throw)throw Error('timeout');return{ok:true,status:200,text:async()=>JSON.stringify({code:'SUCCESS',data:{mattingImageUrl:'https://assets.example/matted.png'}})}}})
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
  return{calls,request:body=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}
}
test('matting uses a fixed environment destination and only the authorized saved source',async t=>{
  const f=await fixture(t);const response=await f.request(input);assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{mattingImageUrl:'https://assets.example/matted.png'});assert.deepEqual(f.calls.find(c=>c[0]==='matting').slice(1),['https://test-api-upload.idealead.com/image/matting',{inputImageUrl:source,clickCount:1}])
})
test('matting refuses unauthorized clients and changed or injected inputs without upstream processing',async t=>{
  const unauth=await fixture(t,{unauthorized:true});assert.equal((await unauth.request(input)).status,403);assert.equal(unauth.calls.length,0)
  const f=await fixture(t)
  assert.equal((await f.request({...input,url:'https://evil.test'})).status,400)
  assert.equal((await f.request({...input,expectedSourceUrl:'https://assets.example/other.png'})).status,409)
  assert.equal(f.calls.filter(c=>c[0]==='matting').length,0)
  assert.throws(()=>authorizedMattingSource({code:'FAILURE'},'source',0,source))
})
test('matting timeout after submission returns unknown without retrying',async t=>{
  const f=await fixture(t,{throw:true});const response=await f.request(input);assert.equal(response.status,502);assert.equal((await response.json()).code,'SUBMISSION_UNKNOWN');assert.equal(f.calls.filter(c=>c[0]==='matting').length,1)
})

test('matting keeps public output indices stable when an earlier output is unsupported', () => {
  const graph = { code: 'SUCCESS', data: { data: { nodes: [{ id: 'source', type: 'image', data: { value: 'http://assets.example/old.png', product: [{ value: source }] } }] } } }
  assert.throws(() => authorizedMattingSource(graph, 'source', 0, source))
  assert.equal(authorizedMattingSource(graph, 'source', 1, source), source)
})
