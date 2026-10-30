/** Failure-only, non-gating Office conversion observations for Insight Intel packaging. */
import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { readPrimaryRuntime, workspaceDependencyPaths } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { desktopTargetBuildPaths } from '../../apps/desktop/scripts/desktop-build-paths.mjs'
import { resolvePackagedApplicationPaths } from '../../apps/desktop/scripts/smoke-packaged-runtime.ts'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..')
const RESOLVER_MODULE = resolve(REPOSITORY_ROOT, 'apps/desktop-host/lib/types/office-engine.js')
const FIXTURE_GENERATOR = resolve(REPOSITORY_ROOT, 'apps/desktop/tests/fixtures/office-conversion-inputs.py')
const DRIVER = fileURLToPath(new URL('./office-diagnostic-driver.mjs', import.meta.url))
const PROBE_BUDGET_MS = 150_000
const TERMINATION_GRACE_MS = 5_000
const OUTPUT_LIMIT_BYTES = 32 * 1024

type Target = 'mac-arm64' | 'mac-x64'
export type OfficeDiagnosticMode = 'signed-asar' | 'signed-raw' | 'resource-node' | 'raw-resource-node'
type DriverPhase = 'resolver' | 'kit' | 'docx' | 'xlsx' | 'dispose' | 'cleanup'

export interface OfficeDiagnosticAttempt {
  readonly mode: OfficeDiagnosticMode
  readonly executable: string
  readonly runtime: string
  readonly supportRuntime: string
  readonly asar: boolean
  readonly electron: boolean
}

export interface OfficeDiagnosticOutcome {
  readonly mode: OfficeDiagnosticMode
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly controllerSignal: 'SIGINT' | 'SIGTERM' | null
  readonly parentBudgetExceeded: boolean
  readonly spawnFailed: boolean
  readonly cleanupFailed: boolean
  readonly stderrBytes: number
  readonly outputTruncated: boolean
  readonly passed: boolean
}

interface DriverEvent {
  readonly event: 'phase-start' | 'phase-complete' | 'phase-failure'
  readonly phase: DriverPhase
  readonly elapsedMs?: number
  readonly backend?: 'native' | 'wasm'
  readonly kind?: 'engine-timeout' | 'unavailable' | 'resolution' | 'conversion' | 'cleanup'
  readonly code?: string
}

interface CapturedOutput { readonly bytes: number; readonly truncated: boolean }

type CapturedOutcome = { readonly ok: true; readonly output: CapturedOutput }
  | { readonly ok: false; readonly error: unknown }

/** Operations used to observe and stop one owned POSIX process group. */
export interface ProcessGroupOperations {
  readonly exists: (pid: number | undefined) => boolean
  readonly signal: (pid: number | undefined, signal: NodeJS.Signals) => void
  readonly now: () => number
  readonly delay: (milliseconds: number) => Promise<void>
}

interface ProbeProtocolSummary {
  readonly docxComplete: boolean
  readonly xlsxComplete: boolean
  readonly phaseFailure: boolean
}

interface ResolvedDiagnosticPaths {
  readonly rawRuntime: string
  readonly preparedSupportRuntime: string
  readonly preparedNode: string
  readonly packaged?: {
    readonly executable: string
    readonly resources: string
    readonly node: string
  }
}

function target(environment: NodeJS.ProcessEnv): Target {
  const value = environment.INSIGHT_MACOS_TARGET
  if (value !== 'mac-arm64' && value !== 'mac-x64') {
    throw new Error('office diagnostics: INSIGHT_MACOS_TARGET must select a macOS target')
  }
  return value
}

function requiredAbsolute(value: string | undefined, name: string): string {
  if (value === undefined || !isAbsolute(value) || value.includes('\0')) {
    throw new Error(`office diagnostics: ${name} must be an absolute path`)
  }
  return resolve(value)
}

async function bundledNode(supportRuntime: string): Promise<string> {
  const primary = join(supportRuntime, 'primary-runtime')
  const node = workspaceDependencyPaths(primary, await readPrimaryRuntime(primary)).node
  if (node === undefined) throw new Error('office diagnostics: bundled Node is unavailable')
  return node
}

/** Select the fallback or signed-App matrix from already resolved artifact paths. */
export function selectOfficeDiagnosticAttempts(paths: ResolvedDiagnosticPaths): readonly OfficeDiagnosticAttempt[] {
  if (paths.packaged === undefined) {
    return [{ mode: 'raw-resource-node', executable: paths.preparedNode, runtime: paths.rawRuntime,
      supportRuntime: paths.preparedSupportRuntime, asar: false, electron: false }]
  }
  const packagedSupport = join(paths.packaged.resources, 'runtime')
  return [
    { mode: 'signed-asar', executable: paths.packaged.executable, runtime: join(paths.packaged.resources, 'app.asar', 'dsh'),
      supportRuntime: packagedSupport, asar: true, electron: true },
    { mode: 'signed-raw', executable: paths.packaged.executable, runtime: paths.rawRuntime,
      supportRuntime: packagedSupport, asar: false, electron: true },
    { mode: 'resource-node', executable: paths.packaged.node, runtime: paths.rawRuntime,
      supportRuntime: packagedSupport, asar: false, electron: false },
  ]
}

/** Resolve real Desktop build paths and use the prepared runtime as the physical comparison. */
export async function officeDiagnosticAttempts(environment: NodeJS.ProcessEnv): Promise<readonly OfficeDiagnosticAttempt[]> {
  const selected = target(environment)
  const paths = desktopTargetBuildPaths(selected, environment)
  const artifacts = requiredAbsolute(environment.INSIGHT_OFFICE_DIAGNOSTIC_ARTIFACTS, 'artifact directory')
  const packaged = resolvePackagedApplicationPaths(selected, artifacts, environment)
  const appReady = existsSync(packaged.executable) && existsSync(join(packaged.resources, 'app.asar'))
  return selectOfficeDiagnosticAttempts({
    rawRuntime: paths.dsh,
    preparedSupportRuntime: paths.runtime,
    preparedNode: await bundledNode(paths.runtime),
    ...(appReady ? { packaged: {
      executable: packaged.executable,
      resources: packaged.resources,
      node: await bundledNode(join(packaged.resources, 'runtime')),
    } } : {}),
  })
}

/** Keep controller logs on an explicit field allowlist. */
export function diagnosticRecord(mode: OfficeDiagnosticMode | 'controller', event: string,
  fields: Readonly<Record<string, string | number | boolean | null>> = {}): string {
  const names = new Set(['phase', 'elapsedMs', 'backend', 'kind', 'code', 'exitCode', 'signal',
    'controllerSignal', 'parentBudgetExceeded', 'spawnFailed', 'cleanupFailed', 'stderrBytes', 'outputTruncated',
    'passed', 'attempts', 'qualification'])
  return JSON.stringify({ subject: 'insight-office-diagnostic', mode, event,
    ...Object.fromEntries(Object.entries(fields).filter(([name]) => names.has(name))) })
}

function isDriverEventName(value: unknown): value is DriverEvent['event'] {
  return value === 'phase-start' || value === 'phase-complete' || value === 'phase-failure'
}

function isDriverPhase(value: unknown): value is DriverPhase {
  return value === 'resolver' || value === 'kit' || value === 'docx' || value === 'xlsx'
    || value === 'dispose' || value === 'cleanup'
}

function isDriverBackend(value: unknown): value is NonNullable<DriverEvent['backend']> {
  return value === 'native' || value === 'wasm'
}

function isDriverFailureKind(value: unknown): value is NonNullable<DriverEvent['kind']> {
  return value === 'engine-timeout' || value === 'unavailable' || value === 'resolution'
    || value === 'conversion' || value === 'cleanup'
}

/** Parse only the diagnostic driver's bounded event protocol. */
export function parseDriverEvent(line: string): DriverEvent | undefined {
  if (Buffer.byteLength(line) > 1024) return undefined
  let value: unknown
  try { value = JSON.parse(line) } catch { return undefined }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (!isDriverEventName(candidate.event) || !isDriverPhase(candidate.phase)) return undefined
  if (candidate.elapsedMs !== undefined && (!Number.isSafeInteger(candidate.elapsedMs) || Number(candidate.elapsedMs) < 0)) return undefined
  if (candidate.backend !== undefined && !isDriverBackend(candidate.backend)) return undefined
  if (candidate.kind !== undefined && !isDriverFailureKind(candidate.kind)) return undefined
  if (candidate.code !== undefined && (typeof candidate.code !== 'string' || !/^[a-z-]{1,32}$/u.test(candidate.code))) return undefined
  return {
    event: candidate.event,
    phase: candidate.phase,
    ...(candidate.elapsedMs === undefined ? {} : { elapsedMs: Number(candidate.elapsedMs) }),
    ...(candidate.backend === undefined ? {} : { backend: candidate.backend }),
    ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
    ...(candidate.code === undefined ? {} : { code: candidate.code }),
  }
}

function resolverUrl(): string {
  const child = relative(REPOSITORY_ROOT, RESOLVER_MODULE)
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || !existsSync(RESOLVER_MODULE)) {
    throw new Error('office diagnostics: required compiled resolver artifact is unavailable')
  }
  return pathToFileURL(RESOLVER_MODULE).href
}

async function fixture(root: string, supportRuntime: string): Promise<void> {
  const primary = join(supportRuntime, 'primary-runtime')
  const dependencies = workspaceDependencyPaths(primary, await readPrimaryRuntime(primary))
  await promisify(execFile)(dependencies.python, ['-I', '-B', FIXTURE_GENERATOR, root], {
    timeout: 120_000, windowsHide: true,
    env: { HOME: root, USERPROFILE: root, TMPDIR: root, TMP: root, TEMP: root, PATH: '' },
  })
}

async function capture(stream: Readable, line: (value: string) => void): Promise<CapturedOutput> {
  let pending = ''
  let bytes = 0
  let truncated = false
  for await (const chunk of stream) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    bytes += Buffer.byteLength(text)
    if (truncated || bytes > OUTPUT_LIMIT_BYTES) { truncated = true; continue }
    pending += text
    for (;;) {
      const end = pending.indexOf('\n')
      if (end < 0) break
      line(pending.slice(0, end))
      pending = pending.slice(end + 1)
    }
  }
  if (!truncated && pending !== '') line(pending)
  return { bytes, truncated }
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return
  try { process.kill(-pid, signal) }
  catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error
  }
}

function groupExists(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try { process.kill(-pid, 0); return true }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === 'ESRCH') return false
      if (error.code === 'EPERM') return true
    }
    throw error
  }
}

const PROCESS_GROUP_OPERATIONS: ProcessGroupOperations = {
  exists: groupExists,
  signal: signalGroup,
  now: Date.now,
  delay: async (milliseconds) => {
    await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, milliseconds) })
  },
}

async function waitForGroupExit(pid: number | undefined, milliseconds: number,
  operations: ProcessGroupOperations): Promise<boolean> {
  const deadline = operations.now() + milliseconds
  while (operations.exists(pid)) {
    if (operations.now() >= deadline) return false
    await operations.delay(Math.min(25, Math.max(1, deadline - operations.now())))
  }
  return true
}

/** Stop an owned group within two bounded grace periods.
 * @returns Whether members remained after SIGKILL grace elapsed.
 */
export async function terminateOwnedGroup(pid: number | undefined, termGraceMs: number, killGraceMs: number,
  operations: ProcessGroupOperations = PROCESS_GROUP_OPERATIONS): Promise<boolean> {
  if (!operations.exists(pid)) return false
  operations.signal(pid, 'SIGTERM')
  if (await waitForGroupExit(pid, termGraceMs, operations)) return false
  operations.signal(pid, 'SIGKILL')
  return !await waitForGroupExit(pid, killGraceMs, operations)
}

function containCapture(capturePromise: Promise<CapturedOutput>, stop: () => void): Promise<CapturedOutcome> {
  return capturePromise.then(
    output => ({ ok: true as const, output }),
    (error: unknown) => { stop(); return { ok: false as const, error } },
  )
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<undefined>((resolvePromise) => {
    timer = setTimeout(() => { resolvePromise(undefined) }, milliseconds)
  })
  try { return await Promise.race([promise, deadline]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

/** Run one owned process group and await its streams and forced termination to quiescence. */
export async function runOwnedProbe(
  command: string, args: readonly string[], environment: NodeJS.ProcessEnv,
  onLine: (line: string) => void, budgetMs = PROBE_BUDGET_MS, terminationGraceMs = TERMINATION_GRACE_MS,
  killGraceMs = TERMINATION_GRACE_MS,
): Promise<Omit<OfficeDiagnosticOutcome, 'mode' | 'passed'>> {
  const child = spawn(command, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: true })
  let spawnFailed = false
  child.once('error', () => { spawnFailed = true })
  let requestTermination!: () => void
  const termination = new Promise<'terminate'>((resolvePromise) => { requestTermination = () => { resolvePromise('terminate') } })
  const stdout = containCapture(capture(child.stdout, onLine), requestTermination)
  const stderr = containCapture(capture(child.stderr, () => {}), requestTermination)
  let observedExit = { code: null as number | null, signal: null as NodeJS.Signals | null }
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
    child.once('close', (code, signal) => { observedExit = { code, signal }; resolvePromise(observedExit) })
  })
  const exited = new Promise<'exited'>((resolvePromise) => {
    child.once('exit', (code, signal) => { observedExit = { code, signal }; resolvePromise('exited') })
  })
  let parentBudgetExceeded = false
  let controllerSignal: 'SIGINT' | 'SIGTERM' | null = null
  const interrupted = (signal: 'SIGINT' | 'SIGTERM'): void => {
    controllerSignal = signal
    requestTermination()
  }
  const interrupt = (): void => { interrupted('SIGINT') }
  const terminate = (): void => { interrupted('SIGTERM') }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  const timer = setTimeout(() => {
    parentBudgetExceeded = true
    requestTermination()
  }, budgetMs)
  try {
    await Promise.race([exited, closed.then(() => 'exited' as const), termination])
    let cleanupFailed = await terminateOwnedGroup(child.pid, terminationGraceMs, killGraceMs)
    if (cleanupFailed) { child.stdout.destroy(); child.stderr.destroy(); child.unref() }
    const closeResult = await within(closed, killGraceMs)
    if (closeResult === undefined) {
      cleanupFailed = true
      child.stdout.destroy()
      child.stderr.destroy()
      child.unref()
    }
    const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr])
    if (!stdoutResult.ok) throw new Error('office diagnostics: stdout capture failed', { cause: stdoutResult.error })
    if (!stderrResult.ok) throw new Error('office diagnostics: stderr capture failed', { cause: stderrResult.error })
    const result = closeResult ?? observedExit
    return { exitCode: result.code, signal: result.signal, controllerSignal, parentBudgetExceeded, spawnFailed,
      cleanupFailed, stderrBytes: stderrResult.output.bytes, outputTruncated: stdoutResult.output.truncated }
  } finally {
    clearTimeout(timer)
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
  }
}

/** Decide whether a probe completed both conversions without a process or protocol failure. */
export function officeProbePassed(
  result: Omit<OfficeDiagnosticOutcome, 'mode' | 'passed'>,
  protocol: ProbeProtocolSummary,
): boolean {
  return result.exitCode === 0 && result.signal === null && result.controllerSignal === null
    && !result.parentBudgetExceeded && !result.spawnFailed && !result.cleanupFailed && !result.outputTruncated
    && protocol.docxComplete && protocol.xlsxComplete && !protocol.phaseFailure
}

function probeEnvironment(home: string, electron: boolean): NodeJS.ProcessEnv {
  return {
    HOME: home, USERPROFILE: home,
    XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, XDG_STATE_HOME: home,
    TMPDIR: home, TMP: home, TEMP: home, PATH: '', NODE_OPTIONS: '', DSH_HOME: home,
    NARB_NATIVE_CACHE_DIR: join(home, 'native-cache'), NARB_DISABLE_NATIVE_CACHE: '0',
    ...(electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  }
}

async function runAttempt(attempt: OfficeDiagnosticAttempt, fixtures: string, root: string,
  compiledResolver: string): Promise<OfficeDiagnosticOutcome> {
  // Plain Node cannot stat a virtual ASAR child; the plan already verified the archive itself.
  if (!existsSync(attempt.executable) || (!attempt.asar && !existsSync(attempt.runtime))) {
    console.log(diagnosticRecord(attempt.mode, 'unavailable'))
    return { mode: attempt.mode, exitCode: null, signal: null, controllerSignal: null, parentBudgetExceeded: false,
      spawnFailed: false, cleanupFailed: false, stderrBytes: 0, outputTruncated: false, passed: false }
  }
  const home = await mkdtemp(join(root, `${attempt.mode}-`))
  await chmod(home, 0o700)
  await mkdir(join(home, 'native-cache'), { mode: 0o700 })
  const started = Date.now()
  const protocol = { docxComplete: false, xlsxComplete: false, phaseFailure: false }
  console.log(diagnosticRecord(attempt.mode, 'probe-start'))
  try {
    const result = await runOwnedProbe(attempt.executable, [DRIVER, attempt.asar ? 'asar' : 'physical',
      attempt.runtime, fixtures, ...(attempt.asar ? [compiledResolver] : [])], probeEnvironment(home, attempt.electron), (line) => {
      const event = parseDriverEvent(line)
      if (event === undefined) return
      if (event.event === 'phase-failure') protocol.phaseFailure = true
      if (event.event === 'phase-complete' && event.phase === 'docx') protocol.docxComplete = true
      if (event.event === 'phase-complete' && event.phase === 'xlsx') protocol.xlsxComplete = true
      console.log(diagnosticRecord(attempt.mode, event.event, {
        phase: event.phase,
        ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
        ...(event.backend === undefined ? {} : { backend: event.backend }),
        ...(event.kind === undefined ? {} : { kind: event.kind }),
        ...(event.code === undefined ? {} : { code: event.code }),
      }))
    })
    const passed = officeProbePassed(result, protocol)
    const outcome = { mode: attempt.mode, ...result, passed }
    console.log(diagnosticRecord(attempt.mode, 'probe-exit', {
      elapsedMs: Date.now() - started, exitCode: result.exitCode, signal: result.signal,
      controllerSignal: result.controllerSignal,
      parentBudgetExceeded: result.parentBudgetExceeded, spawnFailed: result.spawnFailed, cleanupFailed: result.cleanupFailed,
      stderrBytes: result.stderrBytes, outputTruncated: result.outputTruncated, passed,
    }))
    return outcome
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 })
  }
}

/** Run a one-pass candidate matrix after packaging has already failed; results never qualify a package. */
export async function runOfficeDiagnostics(environment = process.env): Promise<readonly OfficeDiagnosticOutcome[]> {
  const compiledResolver = resolverUrl()
  const attempts = await officeDiagnosticAttempts(environment)
  const root = await mkdtemp(join(tmpdir(), 'insight-office-diagnostics-'))
  await chmod(root, 0o700)
  const outcomes: OfficeDiagnosticOutcome[] = []
  try {
    const fixtures = join(root, 'fixtures')
    await mkdir(fixtures, { mode: 0o700 })
    const first = attempts[0]
    if (first === undefined) throw new Error('office diagnostics: no probe was selected')
    await fixture(fixtures, first.supportRuntime)
    for (const attempt of attempts) {
      const outcome = await runAttempt(attempt, fixtures, root, compiledResolver)
      outcomes.push(outcome)
      if (outcome.passed || outcome.controllerSignal !== null || outcome.cleanupFailed) break
    }
    console.log(diagnosticRecord('controller', 'matrix-complete', {
      attempts: outcomes.length, passed: outcomes.some(outcome => outcome.passed), qualification: false,
    }))
    return outcomes
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outcomes = await runOfficeDiagnostics()
    if (outcomes.some(outcome => outcome.controllerSignal !== null || outcome.cleanupFailed)) process.exitCode = 1
  }
  catch { console.error(diagnosticRecord('controller', 'controller-failure')); process.exitCode = 1 }
}
