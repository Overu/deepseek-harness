/** Built-profile evidence for the Insight Host entrypoint. */
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
const integrationDir = fileURLToPath(new URL('../', import.meta.url))
const integrationEntry = join(integrationDir, 'lib/index.js')
const observer = pathToFileURL(fileURLToPath(new URL('./fixtures/real-loader-observer.mjs', import.meta.url))).href
const builtArtifactsAvailable = existsSync(integrationEntry)
const stopGraceMs = 5_000
const stopKillMs = 5_000
const roots: string[] = []
const children: ChildProcess[] = []

afterEach(async () => {
  await Promise.all(children.splice(0).map(stop))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Start a built real `dsh` Web profile selecting Integration as a bundle and an IPC observer as its profile patch. */
async function launch(): Promise<{
  readonly child: ChildProcess
  readonly active: Promise<undefined>
  readonly token: Promise<undefined>
  readonly request: Promise<string>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-insight-real-loader-'))
  roots.push(root)
  const profile = join(root, 'home', 'profiles', 'insight-loader')
  const profileModules = join(profile, 'node_modules', '@insight-ai')
  await mkdir(profileModules, { recursive: true })
  await symlink(integrationDir, join(profileModules, 'desktop-integration'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'insight-loader-profile', private: true,
    dependencies: { '@insight-ai/desktop-integration': `file:${integrationDir}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@insight-ai/desktop-integration'] } },
  }) + '\n')
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{
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
    }),
  })
  const child = spawn(launch.command, launch.args, {
    cwd: root,
    env: launch.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.push(child)
  const active = Promise.withResolvers<undefined>()
  const token = Promise.withResolvers<undefined>()
  const request = Promise.withResolvers<string>()
  let stderr = ''
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
  child.once('error', (error) => { rejectSignals(error, active, token, request) })
  child.once('close', (code, signal) => {
    rejectSignals(new Error(`Insight Loader child exited before completion (code ${String(code)}, signal ${String(signal)}): ${stderr}`), active, token, request)
  })
  child.on('message', (message: unknown) => {
    if (!record(message) || typeof message.kind !== 'string') return
    if (message.kind === 'insight-loader-active') active.resolve(undefined)
    if (message.kind === 'insight-account-request' && typeof message.requestId === 'string' && message.operation === 'access-token') {
      request.resolve(message.requestId)
      child.send({ kind: 'insight-account-response', requestId: message.requestId, result: { ok: true, accessToken: 'loader-fixture-token' } })
    }
    if (message.kind === 'insight-loader-token') token.resolve(undefined)
    if (message.kind === 'insight-loader-error') token.reject(new Error('Insight Loader observer rejected the credential request'))
  })
  return { child, active: active.promise, token: token.promise, request: request.promise }
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
function rejectSignals(error: Error, ...signals: Array<PromiseWithResolvers<undefined> | PromiseWithResolvers<string>>): void {
  for (const signal of signals) signal.reject(error)
}

/** Stop the profile through SIGTERM handling, then escalate to SIGKILL if it misses bounded deadlines. */
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

it.skipIf(process.env.DSH_EXAMPLE_MODE !== 'lib' || !builtArtifactsAvailable)(
  'activates the built Integration bundle entry in a real DSH profile and routes its account request over parent IPC',
  async () => {
    const loader = await launch()
    await expect(loader.active).resolves.toBeUndefined()
    loader.child.send('request-insight-token')
    await expect(loader.request).resolves.toMatch(/^[0-9a-f-]{36}$/iu)
    await expect(loader.token).resolves.toBeUndefined()
  },
  45_000,
)
