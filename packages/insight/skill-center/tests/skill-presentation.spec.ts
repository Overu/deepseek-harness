import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readSkillPresentation, writeSkillPresentation } from '../src/host/skill-presentation.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

async function fixture(): Promise<{ skill: string; sidecar: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-skill-labels-'))
  directories.push(directory)
  return { skill: join(directory, 'SKILL.md'), sidecar: join(directory, 'ui.json') }
}

describe('installed skill presentation', () => {
  it('saves single-line catalogue labels within the Unicode limits accepted by discovery', async () => {
    const { skill } = await fixture()
    await writeSkillPresentation(dirname(skill), {
      displayName: `  ${'😀'.repeat(61)} `,
      shortDescription: `\n简介\u0000\t\u007f\u0085\u2028\u2029${'😀'.repeat(161)}`,
    })
    await expect(readSkillPresentation(skill, new AbortController().signal)).resolves.toEqual({
      displayName: '😀'.repeat(60), shortDescription: `简介${' '.repeat(6)}${'😀'.repeat(152)}`,
    })
  })

  it('keeps an explicitly empty catalogue summary instead of falling back to routing instructions', async () => {
    const { skill } = await fixture()
    await writeSkillPresentation(dirname(skill), { displayName: '专家', shortDescription: ' \n ' })
    await expect(readSkillPresentation(skill, new AbortController().signal)).resolves.toEqual({ displayName: '专家', shortDescription: '' })
  })

  it('reads UI labels without requiring or reading the instruction file', async () => {
    const { skill, sidecar } = await fixture()
    await writeFile(sidecar, JSON.stringify({ displayName: '  创意专家 ', shortDescription: '生成创意方向', name: 'must-not-replace-invocation' }))
    await expect(readSkillPresentation(skill, new AbortController().signal)).resolves.toEqual({ displayName: '创意专家', shortDescription: '生成创意方向' })
  })

  it('keeps native labels usable when optional presentation is missing, malformed or oversized', async () => {
    const { skill, sidecar } = await fixture()
    const signal = new AbortController().signal
    await expect(readSkillPresentation(skill, signal)).resolves.toEqual({})
    for (const text of ['{', '[]', JSON.stringify({ shortDescription: 42 }), JSON.stringify({ displayName: 'x'.repeat(61), shortDescription: 'bad\nlabel' }), JSON.stringify({ displayName: 'Valid', padding: 'x'.repeat(8192) })]) {
      await writeFile(sidecar, text)
      await expect(readSkillPresentation(skill, signal)).resolves.toEqual({})
    }
  })

  it('propagates caller cancellation rather than treating it as absent labels', async () => {
    const { skill } = await fixture()
    const controller = new AbortController()
    const reason = new Error('inventory closed')
    controller.abort(reason)
    await expect(readSkillPresentation(skill, controller.signal)).rejects.toBe(reason)
  })

  it.skipIf(process.platform === 'win32')('rejects special files and sidecar symlinks without waiting for a writer', async () => {
    const { skill, sidecar } = await fixture()
    const fifo = `${sidecar}.fifo`
    execFileSync('mkfifo', [fifo])
    await symlink(fifo, sidecar)
    const source = new URL('../src/host/skill-presentation.ts', import.meta.url).href
    const script = `import { readSkillPresentation } from ${JSON.stringify(source)};
      console.log(JSON.stringify(await readSkillPresentation(${JSON.stringify(skill)}, new AbortController().signal)));`
    const run = () => spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', script], {
      encoding: 'utf8', timeout: 5000,
    })
    let result = run()
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('{}')
    await rm(sidecar)
    execFileSync('mkfifo', [sidecar])
    result = run()
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('{}')
  })
})
