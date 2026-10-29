import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** One packaged content source, advertised by the official Skill catalog and loaded on demand. */
export function registerCanvasGuidance(ctx: Context, directory = fileURLToPath(new URL('./guidance/desktop-canvas-workflow/', import.meta.url))): void {
  const root = resolve(directory)
  const metadata = JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')) as { name: string; description: string; routingHint: string; references: string[] }
  if (metadata.name !== 'desktop-canvas-workflow' || typeof metadata.description !== 'string' || metadata.description.length > 100
    || typeof metadata.routingHint !== 'string' || metadata.routingHint.length > 100 || !Array.isArray(metadata.references)
    || metadata.references.some(path => typeof path !== 'string' || !/^references\/[a-z-]+\.md$/u.test(path))) throw new Error('Invalid canvas guidance metadata')
  const content = readFileSync(join(root,'SKILL.md'),'utf8')
  for (const path of metadata.references) if (!readFileSync(join(root,path),'utf8').trim()) throw new Error('Empty canvas guidance chapter')
  ctx.effect(() => {
    const release = ctx.skills.register({ name:metadata.name, description:metadata.description, source:'runtime', content,
      invocation:{ modelInvocable:true,userInvocable:true }, resourceBase:{kind:'directory',path:root} })
    let stop: (() => void)
    try { stop = ctx.systemPrompt.section({name:'desktop-canvas:guidance',order:600,text:metadata.routingHint}) }
    catch (error) { release(); throw error }
    return () => { stop(); release() }
  }, 'desktop-canvas: guidance')
}
