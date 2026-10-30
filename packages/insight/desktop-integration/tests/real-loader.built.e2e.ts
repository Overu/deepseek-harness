/** Built-profile evidence for the complete Insight desktop composition. */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { afterEach, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const cliSource = join(repoRoot, 'apps/cli/src/bin.ts')
const observer = pathToFileURL(fileURLToPath(new URL('./fixtures/real-loader-observer.mjs', import.meta.url))).href
const requiredBundles = [
  ['@insight-ai/desktop-integration', 'packages/insight/desktop-integration'],
  ['@insight-ai/desktop-canvas-plugin', 'packages/insight/canvas'],
  ['dsh-memory-evolve', 'packages/insight/memory-evolve'],
  ['dsh-prompt-enhance', 'packages/insight/prompt-enhance'],
] as const
const requiredBundleNames = requiredBundles.map(([name]) => name)
const requiredBundlesEnvironment = JSON.stringify(requiredBundleNames)
const profileRegistry = 'https://registry.insight.example/'
const builtArtifactsAvailable = requiredBundles.every(([, directory]) =>
  existsSync(join(repoRoot, directory, 'lib/index.js')) && existsSync(join(repoRoot, directory, 'lib/client.js')),
)
const stopGraceMs = 5_000
const stopKillMs = 5_000
const outputLimit = 32 * 1024
const roots: string[] = []
const children: ChildProcess[] = []

interface CompositionObservation {
  readonly bundles: Array<{
    readonly name: string
    readonly readOnlyReason: string | undefined
    readonly enabled: boolean
    readonly topLevelPluginEntryId: string | undefined
    readonly topLevelPluginReadOnlyReason: string | undefined
  }>
  readonly rejectedBundleChanges: Array<{
    readonly name: string
    readonly disable: { readonly application: string; readonly changed: boolean; readonly errorCode: string | undefined }
    readonly remove: { readonly application: string; readonly changed: boolean; readonly errorCode: string | undefined }
    readonly disablePlugin: { readonly application: string; readonly changed: boolean; readonly errorCode: string | undefined }
  }>
  readonly web: { readonly configuredProvider: string | undefined; readonly registeredProvider: boolean }
  readonly registry: string | null
  readonly clientEntries: Array<{ readonly id: string; readonly status: number; readonly contentType: string | null }>
}

afterEach(async () => {
  const stopped = await Promise.allSettled(children.splice(0).map(stop))
  const removed = await Promise.allSettled(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  const failures: Error[] = []
  for (const result of [...stopped, ...removed]) {
    if (result.status === 'rejected') failures.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Insight Loader fixture cleanup failed.')
})

/** Start a built real `dsh` Web profile with every required Insight bundle and an IPC observer profile patch. */
async function launch(): Promise<{
  readonly child: ChildProcess
  readonly active: Promise<undefined>
  readonly composition: Promise<CompositionObservation>
  readonly token: Promise<undefined>
  readonly request: Promise<string>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-insight-real-loader-'))
  roots.push(root)
  const profile = join(root, 'home', 'profiles', 'insight-loader')
  await Promise.all(requiredBundles.map(async ([name, directory]) => {
    const destination = join(profile, 'node_modules', ...name.split('/'))
    await mkdir(join(destination, '..'), { recursive: true })
    await symlink(join(repoRoot, directory), destination, process.platform === 'win32' ? 'junction' : 'dir')
  }))
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'insight-loader-profile', private: true,
    dependencies: Object.fromEntries(requiredBundles.map(([name, directory]) => [name, `file:${join(repoRoot, directory)}`])),
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...requiredBundleNames] } },
  }) + '\n')
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{
    id: 'plugin-manager', config: { registry: profileRegistry },
  }, {
    insert: [{ id: 'insight-loader-observer', name: observer }],
  }]) + '\n')

  const launch = resolveExampleLaunch({
    srcBin: cliSource,
    mode: 'lib',
    configArgs: [
      '--profile', 'insight-loader', '--no-open', '--host', '127.0.0.1', '--port', '0',
    ],
    env: childEnvironment({
      DSH_HOME: join(root, 'home'),
      DSH_AGENTS_HOME: join(root, 'agents'),
      DSH_TELEMETRY_DISABLED: '1',
      DSH_INSIGHT_SERVICE_ENVIRONMENT: 'test',
      DSH_PRODUCT_REQUIRED_BUNDLES: requiredBundlesEnvironment,
      DSH_INSIGHT_SKILL_PROXY_NODE: process.execPath,
    }),
  })
  const child = spawn(launch.command, launch.args, {
    cwd: root,
    env: launch.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.push(child)
  const active = Promise.withResolvers<undefined>()
  const composition = Promise.withResolvers<CompositionObservation>()
  const token = Promise.withResolvers<undefined>()
  const request = Promise.withResolvers<string>()
  let output = ''
  const capture = (stream: 'stdout' | 'stderr') => (chunk: string): void => {
    const line = `${stream}: ${chunk}`
    output = `${output}${line}`.slice(-outputLimit)
  }
  child.stdout?.setEncoding('utf8').on('data', capture('stdout'))
  child.stderr?.setEncoding('utf8').on('data', capture('stderr'))
  child.once('error', (error) => { rejectSignals(error, active, composition, token, request) })
  child.once('close', (code, signal) => {
    rejectSignals(new Error(`Insight Loader child exited before completion (code ${String(code)}, signal ${String(signal)}): ${output}`), active, composition, token, request)
  })
  child.on('message', (message: unknown) => {
    if (!record(message) || typeof message.kind !== 'string') return
    if (message.kind === 'insight-loader-active') active.resolve(undefined)
    if (message.kind === 'insight-loader-composition' && compositionRecord(message.observation)) composition.resolve(message.observation)
    if (message.kind === 'insight-loader-error') {
      const error = new Error(typeof message.message === 'string' ? message.message : 'Insight Loader observer rejected the observation')
      composition.reject(error)
      token.reject(error)
    }
    if (message.kind === 'insight-account-request' && typeof message.requestId === 'string' && message.operation === 'access-token') {
      request.resolve(message.requestId)
      child.send({ kind: 'insight-account-response', requestId: message.requestId, result: { ok: true, accessToken: 'loader-fixture-token' } })
    }
    if (message.kind === 'insight-loader-token') token.resolve(undefined)
  })
  return { child, active: active.promise, composition: composition.promise, token: token.promise, request: request.promise }
}

/** Remove inherited secrets and Node loader settings before starting the fixture child. */
function childEnvironment(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter((entry): entry is [string, string] => {
    const [key, value] = entry
    return value !== undefined && !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(key) && key !== 'NODE_OPTIONS' && key !== 'NODE_PATH'
  })
  return { ...Object.fromEntries(inherited), ...extra }
}

/** Reject every pending signal when the profile process cannot complete the observation. */
function rejectSignals(
  error: Error,
  ...signals: Array<PromiseWithResolvers<undefined> | PromiseWithResolvers<CompositionObservation> | PromiseWithResolvers<string>>
): void {
  for (const signal of signals) signal.reject(error)
}

/** Stop the profile through its IPC shutdown path, then escalate to signals if it misses bounded deadlines. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = Promise.withResolvers<undefined>()
  child.once('close', () => { closed.resolve(undefined) })
  if (child.connected) child.send('stop')
  else child.kill('SIGTERM')
  if (await settlesWithin(closed.promise, stopGraceMs)) return
  child.kill('SIGTERM')
  if (await settlesWithin(closed.promise, stopKillMs)) return
  child.kill('SIGKILL')
  if (!await settlesWithin(closed.promise, stopKillMs)) {
    throw new Error('Insight Loader child did not close after SIGTERM and SIGKILL.')
  }
}

/** Return whether a promise settles before the specified deadline. */
async function settlesWithin(promise: Promise<undefined>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => { resolve(false) }, milliseconds)
    timer.unref()
  })
  try {
    return await Promise.race([promise.then(() => true), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Narrow object guard for untrusted child-process IPC. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow the one IPC result this test consumes, before allowing it into assertions. */
function compositionRecord(value: unknown): value is CompositionObservation {
  return record(value) && Array.isArray(value.bundles) && Array.isArray(value.rejectedBundleChanges)
    && record(value.web) && Array.isArray(value.clientEntries)
}

it.skipIf(process.env.DSH_EXAMPLE_MODE !== 'lib' || !builtArtifactsAvailable)(
  'loads the built required Insight composition, protects its bundles, and serves their dynamic client entries',
  async () => {
    const loader = await launch()
    await expect(loader.active).resolves.toBeUndefined()
    loader.child.send('observe-insight-composition')
    const observation = await loader.composition

    expect(observation.bundles.map(({
      topLevelPluginEntryId: _entryId,
      topLevelPluginReadOnlyReason: _pluginReason,
      ...bundle
    }) => bundle)).toEqual(requiredBundleNames.map(name => ({
      name,
      readOnlyReason: 'profile-required',
      enabled: true,
    })))
    for (const bundle of observation.bundles) {
      expect(typeof bundle.topLevelPluginEntryId).toBe('string')
      expect(bundle.topLevelPluginReadOnlyReason).toBe('profile-required')
    }
    expect(observation.rejectedBundleChanges).toEqual(requiredBundleNames.map(name => ({
      name,
      disable: { application: 'failed', changed: false, errorCode: 'profile-required' },
      remove: { application: 'failed', changed: false, errorCode: 'profile-required' },
      disablePlugin: { application: 'failed', changed: false, errorCode: 'profile-required' },
    })))
    expect(observation.web).toEqual({ configuredProvider: 'insight-enterprise-search', registeredProvider: true })
    expect(observation.registry).toBe(profileRegistry)
    expect(observation.clientEntries.map(({ contentType: _contentType, ...entry }) => entry)).toEqual(requiredBundleNames.map(id => ({
      id,
      status: 200,
    })))
    for (const entry of observation.clientEntries) expect(entry.contentType?.includes('text/javascript')).toBe(true)

    loader.child.send('request-insight-token')
    await expect(loader.request).resolves.toMatch(/^[0-9a-f-]{36}$/iu)
    await expect(loader.token).resolves.toBeUndefined()
  },
  45_000,
)
