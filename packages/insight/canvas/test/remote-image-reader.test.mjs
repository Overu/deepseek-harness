import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { downloadRemoteImage, isPublicAddress } from '../src/host/remote-image-reader.ts'
const png = Buffer.from('89504e470d0a1a0a00000000','hex')
function fixture({status=200,type='image/png',data=png,addresses=[{address:'93.184.216.34',family:4}],headers={}}={}) {
 let calls=0,lookups=0
 const deps={ lookup:async()=>{lookups++;return addresses},request:(url,options,callback)=>{
  calls++; assert.deepEqual(options.headers,{accept:'image/png,image/jpeg,image/webp,image/gif'});assert.equal(options.agent,false)
  options.lookup(url.hostname,{},(err,address,family)=>{assert.equal(err,null);assert.equal(address,'93.184.216.34');assert.equal(family,4)})
  const req=new EventEmitter();req.destroy=()=>req;req.end=()=>{const res=Readable.from([data]);res.statusCode=status;res.headers={'content-type':type,...headers};queueMicrotask(()=>callback(res))};return req
 }}
 return {deps,calls:()=>calls,lookups:()=>lookups}
}
test('blocks loopback, private, reserved, mapped, multicast and metadata addresses',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.0.1','172.31.1.1','198.18.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'])assert.equal(isPublicAddress(ip),false,ip)
 for(const ip of ['93.184.216.34','8.8.8.8','2606:4700:4700::1111'])assert.equal(isPublicAddress(ip),true,ip)
})
test('pins verified DNS address for request and returns sniffed image bytes, without account headers',async()=>{
 const f=fixture();const image=await downloadRemoteImage('https://media.example.com/image',new AbortController().signal,f.deps)
 assert.equal(image.mediaType,'image/png');assert.deepEqual(image.data,png);assert.equal(f.calls(),1);assert.equal(f.lookups(),1)
})
test('rejects unsafe URLs and any private DNS answer before opening a connection',async()=>{
 for(const url of ['file:///private/file','http://127.0.0.1/image','https://user:password@media.example.com/img','https://media.example.com:8080/img','https://media.example.com/img#secret']){
  const f=fixture();await assert.rejects(downloadRemoteImage(url,new AbortController().signal,f.deps));assert.equal(f.calls(),0)
 }
 const f=fixture({addresses:[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]});await assert.rejects(downloadRemoteImage('https://media.example.com/img',new AbortController().signal,f.deps));assert.equal(f.calls(),0)
})
test('never follows redirects, rejects expired/error pages, forged content, and oversized responses',async()=>{
 for(const options of [{status:302,headers:{location:'http://127.0.0.1/secret'}},{status:403},{type:'text/html',data:Buffer.from('<html>expired</html>')},{data:Buffer.from('not an image')},{headers:{'content-length':String(20*1024*1024)}}]){
  const f=fixture(options);await assert.rejects(downloadRemoteImage('https://media.example.com/img',new AbortController().signal,f.deps));assert.equal(f.calls(),1)
 }
 const f=fixture();await assert.rejects(downloadRemoteImage('https://media.example.com/img',new AbortController().signal,{...f.deps,maxBytes:png.length}))
})
test('pre-cancellation never resolves DNS or connects, errors do not echo signed URL',async()=>{
 const f=fixture(),c=new AbortController();c.abort();await assert.rejects(downloadRemoteImage('https://media.example.com/img',c.signal,f.deps),{code:'CANCELLED_BEFORE_DISPATCH'});assert.equal(f.lookups(),0)
 const bad=fixture({status:403});await assert.rejects(downloadRemoteImage('https://media.example.com/img?Signature=private',new AbortController().signal,bad.deps),e=>!e.message.includes('private')&&!e.message.includes('media.example'))
})

test('Fake-IP-only DNS is independently resolved and only verified public IP reaches the image request',async()=>{
 const f=fixture({addresses:[{address:'198.18.0.119',family:4}]});let resolutions=0
 const image=await downloadRemoteImage('https://media.example.com/image?Signature=private',new AbortController().signal,{
  ...f.deps,resolvePublic:async(host,signal)=>{resolutions++;assert.equal(host,'media.example.com');assert.equal(signal.aborted,false);return [{address:'93.184.216.34',family:4}]}
 })
 assert.equal(image.mediaType,'image/png');assert.equal(resolutions,1);assert.equal(f.calls(),1)
})
test('public DNS, literal Fake-IP, other private and mixed answers never use independent resolution',async()=>{
 for(const addresses of [[{address:'10.0.0.1',family:4}],[{address:'198.18.0.119',family:4},{address:'10.0.0.1',family:4}],[{address:'198.18.0.119',family:4},{address:'93.184.216.34',family:4}]]){
  const f=fixture({addresses});await assert.rejects(downloadRemoteImage('https://media.example.com/image',new AbortController().signal,{...f.deps,resolvePublic:async()=>{throw Error('must not resolve')}}));assert.equal(f.calls(),0)
 }
 const literal=fixture();await assert.rejects(downloadRemoteImage('https://198.18.0.119/image',new AbortController().signal,{...literal.deps,resolvePublic:async()=>{throw Error('must not resolve')}}));assert.equal(literal.calls(),0)
 const normal=fixture();await downloadRemoteImage('https://media.example.com/image',new AbortController().signal,{...normal.deps,resolvePublic:async()=>{throw Error('must not resolve')}});assert.equal(normal.calls(),1)
})
test('independent DNS cannot authorize private, empty, mixed, or failed answers; read errors identify the phase',async()=>{
 for(const result of [[],[{address:'127.0.0.1',family:4}],[{address:'93.184.216.34',family:4},{address:'198.18.0.3',family:4}]]){
  const f=fixture({addresses:[{address:'198.18.0.119',family:4}]});await assert.rejects(downloadRemoteImage('https://media.example.com/img?Signature=private',new AbortController().signal,{...f.deps,resolvePublic:async()=>result}),e=>e.code==='ASSET_NOT_FOUND'&&e.message.includes('[dns]')&&!e.message.includes('private'));assert.equal(f.calls(),0)
 }
 const f=fixture({addresses:[{address:'198.18.0.119',family:4}]});await assert.rejects(downloadRemoteImage('https://media.example.com/img',new AbortController().signal,{...f.deps,resolvePublic:async()=>{throw Error('secret resolver failure')}}),e=>e.message.includes('[dns]')&&!e.message.includes('secret'));assert.equal(f.calls(),0)
 const expired=fixture({status:403});await assert.rejects(downloadRemoteImage('https://media.example.com/img',new AbortController().signal,expired.deps),e=>e.message.includes('[http]'))
})
