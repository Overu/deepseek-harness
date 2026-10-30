import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const workflow = yaml.load(await readFile(resolve(root, '.github/workflows/insight-package.yml'), 'utf8')) as {
  name: string
  on: { workflow_dispatch: { inputs: { target: { options: string[] } } } }
  jobs: { 'finalize-release': { steps: Array<{ name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, string> }> } }
}

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
