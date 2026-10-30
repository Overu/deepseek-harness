import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { expect, it, type TestContext } from 'vitest'

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

it('observes Intel Office helpers without replacing the package command', () => {
  const build = workflow.jobs.x64.steps.find(step => step.name === 'Build signed Insight installers')?.run
  expect(build).toContain('node --import tsx scripts/insight-release/office-process-observer.ts "$$" &')
  expect(build).toContain('trap stop_office_observer EXIT')
  expect(build).toContain('local package_status=$?')
  expect(build).toContain('kill -TERM "$observer_pid"')
  expect(build).toContain('wait "$observer_pid"')
  expect(build).toContain('exit "$package_status"')
  expect(build).toContain('if [[ "$INSIGHT_SKIP_NOTARIZATION" = true ]]; then pnpm run package:desktop:mac:x64 --skip-notarization; else pnpm run package:desktop:mac:x64; fi')
  expect(workflow.jobs.arm64.steps.find(step => step.name === 'Build signed Insight installers')?.run)
    .not.toContain('office-process-observer')
})

async function expectObserverTrapExit(packageStatus: number, context: TestContext): Promise<void> {
  const build = workflow.jobs.x64.steps.find(step => step.name === 'Build signed Insight installers')?.run
  expect(build).toBeDefined()
  const directory = await mkdtemp(join(tmpdir(), 'insight-office-observer-shell-'))
  const fixture = join(directory, 'observer.mjs')
  const ready = join(directory, 'ready')
  const stopped = join(directory, 'stopped')
  const pidFile = join(directory, 'pid')
  await writeFile(fixture, `
import { writeFileSync } from 'node:fs'
const [ready, stopped, pidFile] = process.argv.slice(2)
writeFileSync(pidFile, String(process.pid))
process.once('SIGTERM', () => { writeFileSync(stopped, 'stopped'); process.exit(0) })
writeFileSync(ready, 'ready')
setInterval(() => {}, 1000)
`)
  const shell = build!
    .replace('node --import tsx scripts/insight-release/office-process-observer.ts "$$" &',
      `"${process.execPath}" "${fixture}" "${ready}" "${stopped}" "${pidFile}" &`)
    .replace('if [[ "$INSIGHT_SKIP_NOTARIZATION" = true ]]; then pnpm run package:desktop:mac:x64 --skip-notarization; else pnpm run package:desktop:mac:x64; fi',
      'until [[ -f "$OBSERVER_READY" ]]; do sleep 0.01; done\nexit "$PACKAGE_STATUS"')
  let closed = false
  const completion = Promise.withResolvers<number>()
  const child = execFile('/bin/bash', ['-euo', 'pipefail', '-c', shell], {
    env: { OBSERVER_READY: ready, PACKAGE_STATUS: String(packageStatus), PATH: process.env.PATH ?? '' },
    timeout: context.task.timeout, killSignal: 'SIGTERM', maxBuffer: 1024 * 1024,
  }, (error) => {
    if (error === null) completion.resolve(0)
    else if (typeof error.code === 'number') completion.resolve(error.code)
    else completion.reject(error)
  })
  const abort = (): void => { child.kill('SIGTERM') }
  context.signal.addEventListener('abort', abort, { once: true })
  child.once('close', () => { closed = true; context.signal.removeEventListener('abort', abort) })
  context.onTestFinished(async () => {
    if (!closed) child.kill('SIGTERM')
    await completion.promise.catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  expect(await completion.promise).toBe(packageStatus)
  expect(await readFile(stopped, 'utf8')).toBe('stopped')
  const observerPid = Number(await readFile(pidFile, 'utf8'))
  expect(() => { process.kill(observerPid, 0) }).toThrow(expect.objectContaining({ code: 'ESRCH' }))
}

it.skipIf(process.platform === 'win32')('the Intel observer trap preserves package success after observer cleanup', async (context) => {
  await expectObserverTrapExit(0, context)
})

it.skipIf(process.platform === 'win32')('the Intel observer trap preserves package failure after observer cleanup', async (context) => {
  await expectObserverTrapExit(37, context)
})

it('qualifies the current-user Windows upgrade after collection and before uploading the release artifact', () => {
  const steps = workflow.jobs.windows.steps
  const collection = steps.findIndex(step => step.name === 'Collect verified release attachments')
  const qualification = steps.findIndex(step => step.name === 'Qualify current-user Insight upgrade')
  const upload = steps.findIndex(step => step.name === 'Upload internal package artifact')
  expect(collection).toBeGreaterThan(-1)
  expect(qualification).toBeGreaterThan(collection)
  expect(qualification).toBeLessThan(upload)
  expect(steps[qualification]).toMatchObject({
    if: 'success()',
    'timeout-minutes': 25,
    run: 'node --import tsx scripts/insight-release/qualify-windows-upgrade.ts',
    env: { INSIGHT_RELEASE_DIRECTORY: '${{ steps.collected.outputs.release_directory }}' },
  })
})

it('checks the real Windows registry reader before dependency installation or native packaging', () => {
  const steps = workflow.jobs.windows.steps
  const smoke = steps.findIndex(step => step.name === 'Check Windows registry qualification')
  const setup = steps.findIndex(step => step.uses?.startsWith('pnpm/action-setup@'))
  expect(smoke).toBeGreaterThan(0)
  expect(smoke).toBeLessThan(setup)
  expect(steps[smoke]).toMatchObject({
    'timeout-minutes': 2,
    run: 'pwsh.exe -NoProfile -NonInteractive -File scripts/insight-release/qualify-windows-registry.smoke.ps1',
  })
})
