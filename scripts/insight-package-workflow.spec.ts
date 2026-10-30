import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const workflow = yaml.load(await readFile(resolve(root, '.github/workflows/insight-package.yml'), 'utf8')) as {
  name: string
  on: { workflow_dispatch: { inputs: { target: { options: string[] } } } }
  jobs: Record<'arm64' | 'x64' | 'windows' | 'finalize-release', {
    steps: Array<{
      id?: string
      name?: string
      uses?: string
      run?: string
      if?: string
      'continue-on-error'?: boolean
      'timeout-minutes'?: number
      env?: Record<string, string>
      with?: Record<string, string>
    }>
  }>
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

it('runs the Intel Office diagnostic only after a failed package and before signing cleanup', () => {
  const steps = workflow.jobs.x64.steps
  const diagnostic = steps.findIndex(step => step.name === 'Diagnose failed Insight Office conversion')
  const cleanup = steps.findIndex(step => step.name === 'Remove private signing configuration')
  expect(diagnostic).toBeGreaterThan(-1)
  expect(diagnostic).toBeLessThan(cleanup)
  expect(steps[diagnostic]?.if).toBe("failure() && steps.configuration.outcome == 'success'")
  expect(steps[diagnostic]?.['continue-on-error']).toBe(true)
  expect(steps[diagnostic]?.['timeout-minutes']).toBe(15)
  expect(steps[diagnostic]?.env).toMatchObject({
    INSIGHT_OFFICE_DIAGNOSTIC_ARTIFACTS: '${{ steps.configuration.outputs.artifact_directory }}',
  })
})
