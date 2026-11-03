import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const workflow = yaml.load(await readFile(resolve(root, '.github/workflows/insight-package.yml'), 'utf8')) as {
  name: string
  permissions: { contents: string }
  on: { workflow_dispatch: { inputs: {
    target: { options: string[] }
    create_release: { type: string; default: boolean; required: boolean }
  } } }
  jobs: Record<'arm64' | 'x64' | 'windows' | 'finalize-release', {
    if: string
    permissions?: { contents?: string }
    steps: Array<{
      id?: string
      name?: string
      uses?: string
      run?: string
      env?: Record<string, string>
      with?: Record<string, string>
    }>
  }>
}

it('keeps verified platform artifacts when Release creation is disabled', () => {
  expect(workflow.permissions).toEqual({ contents: 'read' })
  expect(workflow.on.workflow_dispatch.inputs.create_release).toMatchObject({
    type: 'boolean', default: true, required: true,
  })
  expect(workflow.jobs['finalize-release'].if).toMatch(/^inputs\.create_release && always\(\) && /u)
  expect(workflow.jobs['finalize-release'].permissions).toEqual({ contents: 'write' })
  expect(workflow.jobs['finalize-release'].steps.filter(step => step.env?.INSIGHT_RELEASE_MODE === 'finalize')).toHaveLength(1)
  for (const target of ['arm64', 'x64', 'windows'] as const) {
    const job = workflow.jobs[target]
    expect(job.if).not.toContain('create_release')
    expect(job.permissions?.contents).not.toBe('write')
    expect(job.steps.some(step => step.env?.INSIGHT_RELEASE_MODE === 'finalize')).toBe(false)
    expect(job.steps.find(step => step.id === 'collected')).toBeDefined()
    expect(job.steps.some(step => step.uses?.startsWith('actions/upload-artifact@'))).toBe(true)
  }
})

it('uses the isolated runtime when creating an Insight GitHub Release', () => {
  expect(workflow.name).toBe('Package Insight desktop')
  expect(workflow.on.workflow_dispatch.inputs.target.options).toEqual(['all', 'arm64', 'x64', 'windows'])
  const steps = workflow.jobs['finalize-release'].steps
  expect(steps.some(step => step.uses?.startsWith('pnpm/action-setup@'))).toBe(false)
  expect(steps.some(step => step.run === 'pnpm install --frozen-lockfile')).toBe(false)
  expect(steps.find(step => step.uses?.startsWith('actions/setup-node@'))?.with).toMatchObject({
    'cache': 'npm',
    'cache-dependency-path': 'scripts/insight-release/runtime/package-lock.json',
  })
  expect(steps.find(step => step.name === 'Install isolated release runtime')?.run)
    .toBe('npm ci --prefix scripts/insight-release/runtime --ignore-scripts --no-audit --no-fund')
  expect(steps.find(step => step.name === 'Prepare immutable Release helper')?.run)
    .toBe('node scripts/insight-release/runtime/prepare-github-release-runtime.mjs')
  for (const name of ['Write package-run buildRunRecord', 'Finalize immutable GitHub Release']) {
    expect(steps.find(step => step.name === name)?.run)
      .toBe('node --import "${{ steps.runtime.outputs.loader }}" "${{ steps.runtime.outputs.entry }}"')
  }
})
it('passes every configured platform artifact directory to the collector', () => {
  for (const [jobName, target] of [['arm64', 'darwin-arm64'], ['x64', 'darwin-x64'], ['windows', 'win32-x64']] as const) {
    const steps = workflow.jobs[jobName].steps
    expect(steps.find(step => step.id === 'configuration')).toBeDefined()
    expect(steps.find(step => step.id === 'collected')?.env).toMatchObject({
      INSIGHT_RELEASE_TARGET: target,
      INSIGHT_ARTIFACT_DIRECTORY: '${{ steps.configuration.outputs.artifact_directory }}',
    })
  }
  expect(workflow.jobs.windows.steps.find(step => step.id === 'configuration')?.run)
    .toContain('artifact_directory=$artifacts')
})
