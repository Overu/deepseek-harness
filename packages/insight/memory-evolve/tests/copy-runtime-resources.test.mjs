import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { copyRuntimeResources } from '../scripts/copy-runtime-resources.mjs'

test('copies the Host module tree without replacing the bundled entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-evolve-copy-'))
  try {
    const host = join(root, 'src', 'host')
    await mkdir(join(host, 'coi'), { recursive: true })
    await mkdir(join(host, 'sync'), { recursive: true })
    await mkdir(join(root, 'lib', 'host'), { recursive: true })
    await mkdir(join(root, 'lib'), { recursive: true })
    await mkdir(join(root, 'scripts'), { recursive: true })
    await mkdir(join(root, 'skills'), { recursive: true })
    await mkdir(join(root, 'vendor'), { recursive: true })
    await writeFile(join(host, 'index.js'), 'source entry')
    await writeFile(join(host, 'prompts-seed.json'), '{"prompts":[]}')
    await writeFile(join(host, 'sync', 'worker.js'), 'export const worker = true')
    await writeFile(join(root, 'scripts', 'sync-worker.mjs'), 'export {}')
    await writeFile(join(root, 'skills', 'SKILL.md'), '# skill')
    await writeFile(join(root, 'vendor', 'mermaid.min.js'), 'export {}')
    await writeFile(join(root, 'lib', 'index.js'), 'bundled entry')
    await writeFile(join(root, 'lib', 'host', 'removed-upstream-module.js'), 'stale')

    await copyRuntimeResources(root)

    assert.equal(await readFile(join(root, 'lib', 'index.js'), 'utf8'), 'bundled entry')
    assert.equal(await readFile(join(root, 'lib', 'host', 'index.js'), 'utf8'), 'source entry')
    assert.equal(await readFile(join(root, 'lib', 'host', 'prompts-seed.json'), 'utf8'), '{"prompts":[]}')
    assert.equal(await readFile(join(root, 'lib', 'host', 'sync', 'worker.js'), 'utf8'), 'export const worker = true')
    await assert.rejects(readFile(join(root, 'lib', 'host', 'removed-upstream-module.js')))
    assert.equal(fileURLToPath(new URL('../../../skills/', pathToFileURL(join(root, 'lib', 'host', 'coi', 'index.js')))), `${join(root, 'skills')}/`)
    assert.equal(fileURLToPath(new URL('../../vendor/mermaid.min.js', pathToFileURL(join(root, 'lib', 'host', 'mermaid.js')))), join(root, 'vendor', 'mermaid.min.js'))
    assert.equal(fileURLToPath(new URL('../../../scripts/sync-worker.mjs', pathToFileURL(join(root, 'lib', 'host', 'sync', 'index.js')))), join(root, 'scripts', 'sync-worker.mjs'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolves the copied sync worker module graph without running a sync', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-evolve-worker-'))
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  try {
    await cp(join(packageRoot, 'src', 'host'), join(root, 'src', 'host'), { recursive: true })
    await mkdir(join(root, 'scripts'), { recursive: true })
    await cp(join(packageRoot, 'scripts', 'sync-worker.mjs'), join(root, 'scripts', 'sync-worker.mjs'))
    await copyRuntimeResources(root)

    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, 'scripts', 'sync-worker.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
      child.once('error', reject)
      child.once('close', code => resolve({ code, stdout, stderr }))
    })
    assert.equal(result.code, 1)
    assert.match(result.stdout, /用法：sync-worker\.mjs/)
    assert.equal(result.stderr, '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
