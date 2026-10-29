import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerCanvasGuidance } from '../src/host/canvas-guidance.ts'
const root=fileURLToPath(new URL('../guidance/desktop-canvas-workflow/',import.meta.url))
function fixture(){const skills=[],sections=[],disposals=[];let removed=0
 const ctx={skills:{register:s=>{skills.push(s);return()=>removed++}},systemPrompt:{section:s=>{sections.push(s);return()=>removed++}},effect:fn=>disposals.push(fn())}
 return{ctx,skills,sections,close:()=>disposals.reverse().forEach(fn=>fn()),removed:()=>removed}}
test('registers one compact index and a single routing hint; chapters are loaded only when read',()=>{
 const f=fixture();registerCanvasGuidance(f.ctx,root);assert.equal(f.skills.length,1);assert.equal(f.skills[0].name,'desktop-canvas-workflow')
 assert.equal(f.skills[0].resourceBase.kind,'directory');assert.equal(f.skills[0].resourceBase.path,root.replace(/\/$/,''))
 assert(f.skills[0].content.length<1400);assert(!f.skills[0].content.includes('转存完成但节点未保存'))
 assert.equal(f.sections.length,1);assert(f.sections[0].text.length<110);f.close();assert.equal(f.removed(),2)
})
test('release guidance files all exist and metadata does not allow paths outside the package',async()=>{
 const meta=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'))
 for(const path of meta.references)assert((await readFile(join(root,path),'utf8')).length>0)
 const temp=await mkdtemp(join(tmpdir(),'canvas-guidance-'));try{await cp(root,temp,{recursive:true});await rm(join(temp,meta.references[0]));assert.throws(()=>registerCanvasGuidance(fixture().ctx,temp))}finally{await rm(temp,{recursive:true,force:true})}
})
test('partial registration failure rolls back the skill instead of leaving a stale catalog',()=>{
 const f=fixture();f.ctx.systemPrompt.section=()=>{throw Error('failed')};assert.throws(()=>registerCanvasGuidance(f.ctx,root));assert.equal(f.removed(),1)
})
