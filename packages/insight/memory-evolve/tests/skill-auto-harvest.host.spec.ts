/** Skill creation follows saved settings in a running plugin and after restart. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { expect, it } from 'vitest'
import { apply } from '../src/host/index.js'

type SkillTool = {
  name: string
  execute(args: { action: 'create'; name: string; body: string }, exec: object): Promise<{ ok: boolean; message: string }>
}

type ConfigRoute = (request: Readable, response: { writeHead(status: number): void; end(): void }) => Promise<void>

function mount(memoryDir: string, skillDir: string) {
  const tools = new Map<string, SkillTool>()
  const routes = new Map<string, ConfigRoute>()
  const disposers: Array<() => void> = []
  const ctx = {
    effect(setup: () => (() => void) | undefined) {
      const dispose = setup()
      if (dispose !== undefined) disposers.push(dispose)
      return dispose
    },
    on: () => () => {},
    get: (name: string) => name === 'connection' ? { requestRejection: () => undefined } : undefined,
    inject(names: readonly string[], setup: (context: object) => void) {
      if (names.length === 1 && names[0] === 'webServer') setup(ctx)
    },
    webServer: {
      register({ path, handler }: { path: string; handler: ConfigRoute }) {
        routes.set(path, handler)
        return () => { routes.delete(path) }
      },
    },
    tools: {
      register(tool: SkillTool) {
        tools.set(tool.name, tool)
        return () => { tools.delete(tool.name) }
      },
    },
  }
  apply(ctx, { memoryDir, skillDir, injectMemory: false })
  const tool = tools.get('skill_manage')
  const configRoute = routes.get('/memory-evolve')
  if (!tool || !configRoute) throw new Error('Missing skill tool or settings route')
  return {
    async saveSkillAutoHarvest(enabled: boolean) {
      const body = Buffer.from(JSON.stringify({ patch: { skillReviewEnabled: enabled } }))
      const request = Object.assign(Readable.from([body]), { method: 'POST', url: '/memory-evolve/api/config' })
      let status: number | undefined
      await configRoute(request, { writeHead(code) { status = code }, end() {} })
      expect(status).toBe(200)
    },
    async expectSkill(name: string, installed: boolean) {
      const body = `---\nname: ${name}\ndescription: A fixture skill\n---\n\n# Fixture skill\n`
      const result = await tool.execute({ action: 'create', name, body }, {})
      expect(result.ok, result.message).toBe(true)
      expect(existsSync(join(skillDir, name, 'SKILL.md')), result.message).toBe(installed)
      expect(existsSync(join(memoryDir, 'pending-skills', name, 'SKILL.md')), result.message).toBe(!installed)
    },
    dispose() { disposers.reverse().forEach((dispose) => { dispose() }) },
  }
}

it('applies the default, updates when saved, and retains a saved off setting across restart', async ({ onTestFinished }) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skill-auto-harvest-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const memoryDir = join(root, 'memory')
  const skillDir = join(root, 'skills')
  const initial = mount(memoryDir, skillDir)
  try {
    await initial.expectSkill('default-skill', true)
    await initial.saveSkillAutoHarvest(false)
    await initial.expectSkill('queued-skill', false)
    await initial.saveSkillAutoHarvest(true)
    await initial.expectSkill('enabled-skill', true)
    await initial.saveSkillAutoHarvest(false)
  } finally {
    initial.dispose()
  }

  const reopened = mount(memoryDir, skillDir)
  try {
    await reopened.expectSkill('queued-after-restart', false)
  } finally {
    reopened.dispose()
  }
})
