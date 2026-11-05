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
  jobs: Record<'validate-input' | 'aggregate-checks' | 'arm64' | 'x64' | 'windows' | 'finalize-release', {
    if?: string
    needs: string | string[]
    'runs-on': string
    permissions?: { contents?: string }
    steps: Array<{
      id?: string
      if?: string
      name?: string
      uses?: string
      run?: string
      env?: Record<string, string>
      with?: Record<string, string>
    }>
  }>
}

it('validates branch and version before any platform package or Release job', () => {
  const validation = workflow.jobs['validate-input']
  expect(validation.if).toBeUndefined()
  expect(validation.steps.find(step => step.uses?.startsWith('actions/checkout@'))?.with?.ref).toBe('${{ github.sha }}')
  const source = validation.steps.find(step => step.name === 'Validate the package source')
  expect(source?.env).toEqual({ INSIGHT_DESKTOP_VERSION: '${{ inputs.version }}' })
  expect(source?.run).toBe('node scripts/insight-release/package-source.ts')
  for (const name of ['aggregate-checks', 'arm64', 'x64', 'windows', 'finalize-release'] as const) {
    const job = workflow.jobs[name]
    expect(job.needs).toContain('validate-input')
    expect(job.if ?? '').not.toContain('refs/heads/insight')
    expect(job.steps.some(step => step.run?.includes('refs/heads/insight'))).toBe(false)
  }
  expect(workflow.jobs['finalize-release'].if).toContain("needs.validate-input.result == 'success'")
  for (const name of ['arm64', 'x64', 'windows', 'finalize-release'] as const) {
    expect(workflow.jobs[name].steps.some(step => step.run?.includes('git rev-parse HEAD'))).toBe(true)
  }
})

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

it('checks the same source once without delaying independent platform builds', () => {
  const checks = workflow.jobs['aggregate-checks']
  expect(checks.needs).toBe('validate-input')
  expect(checks['runs-on']).toBe('ubuntu-24.04')
  expect(checks.steps.find(step => step.uses?.startsWith('actions/checkout@'))?.with?.ref).toBe('${{ github.sha }}')
  expect(checks.steps.filter(step => step.run === 'pnpm run typecheck')).toHaveLength(1)
  for (const target of ['arm64', 'x64', 'windows'] as const) expect(workflow.jobs[target].needs).toBe('validate-input')
  expect(workflow.jobs['finalize-release'].needs).toContain('aggregate-checks')
  expect(workflow.jobs['finalize-release'].if).toContain("needs.aggregate-checks.result == 'success'")
})

it('retains phase summaries separately from installer artifacts after packaging failures', () => {
  for (const target of ['arm64', 'x64', 'windows'] as const) {
    const steps = workflow.jobs[target].steps
    const metrics = steps.find(step => step.id === 'metrics')
    expect(metrics?.if).toBe("always() && steps.dependencies.outcome == 'success'")
    expect(metrics?.run).toContain('scripts/insight-release/collect-packaging-metrics.ts')
    const upload = steps.find(step => step.name === 'Upload packaging metrics')
    expect(upload?.if).toBe("always() && steps.metrics.outcome == 'success'")
    expect(upload?.with?.path).toBe('${{ runner.temp }}/insight-packaging-metrics/*')
  }
})

it('samples macOS memory around packaging and preserves its exit status', () => {
  for (const target of ['arm64', 'x64'] as const) {
    const build = workflow.jobs[target].steps.find(step => step.name === 'Build signed Insight installers')!.run!
    const before = build.indexOf('vm_stat > "$metrics/memory-before.txt"')
    const command = build.indexOf('/usr/bin/time -l -o "$metrics/package-resources.txt"')
    const after = build.indexOf('vm_stat > "$metrics/memory-after.txt"')
    const exit = build.indexOf('exit "$package_status"')
    expect(before).toBeGreaterThanOrEqual(0)
    expect(command).toBeGreaterThan(before)
    expect(after).toBeGreaterThan(command)
    expect(exit).toBeGreaterThan(after)
    expect(build.match(/\|\| package_status=\$\?/gu)).toHaveLength(2)
    expect(workflow.jobs[target].steps.find(step => step.id === 'metrics')?.run).not.toContain('vm_stat')
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
