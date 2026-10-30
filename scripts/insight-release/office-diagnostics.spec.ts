import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import {
  diagnosticRecord,
  officeProbePassed,
  parseDriverEvent,
  runOwnedProbe,
  selectOfficeDiagnosticAttempts,
  terminateOwnedGroup,
} from './office-diagnostics.ts'

it('uses the signed ASAR entry, then the byte-verified raw runtime with both launchers', () => {
  const attempts = selectOfficeDiagnosticAttempts({
    rawRuntime: '/build/dsh', preparedSupportRuntime: '/build/runtime', preparedNode: '/build/node',
    packaged: { executable: '/app/Insight', resources: '/app/Resources', node: '/app/Resources/node' },
  })
  expect(attempts.map(attempt => attempt.mode)).toEqual(['signed-asar', 'signed-raw', 'resource-node'])
  expect(attempts).toMatchObject([
    { executable: '/app/Insight', runtime: '/app/Resources/app.asar/dsh', asar: true, electron: true },
    { executable: '/app/Insight', runtime: '/build/dsh', asar: false, electron: true },
    { executable: '/app/Resources/node', runtime: '/build/dsh', asar: false, electron: false },
  ])
})

it('falls back to the prepared runtime and its bundled Node when no signed App exists', () => {
  expect(selectOfficeDiagnosticAttempts({
    rawRuntime: '/build/dsh', preparedSupportRuntime: '/build/runtime', preparedNode: '/build/node',
  })).toEqual([{ mode: 'raw-resource-node', executable: '/build/node', runtime: '/build/dsh',
    supportRuntime: '/build/runtime', asar: false, electron: false }])
})

it('accepts only bounded driver events and emits allowlisted controller fields', () => {
  expect(parseDriverEvent('{"event":"phase-failure","phase":"xlsx","kind":"engine-timeout","code":"timeout","path":"/secret"}'))
    .toEqual({ event: 'phase-failure', phase: 'xlsx', kind: 'engine-timeout', code: 'timeout' })
  expect(parseDriverEvent('{"event":"phase-complete","phase":"xlsx","backend":"other"}')).toBeUndefined()
  expect(parseDriverEvent('not json')).toBeUndefined()
  expect(diagnosticRecord('resource-node', 'probe-exit', { elapsedMs: 45, passed: false, secret: 'value' }))
    .toBe('{"subject":"insight-office-diagnostic","mode":"resource-node","event":"probe-exit","elapsedMs":45,"passed":false}')
})

it('requires both conversion completions and no protocol failure before accepting a zero exit', () => {
  const result = { exitCode: 0, signal: null, controllerSignal: null, parentBudgetExceeded: false,
    spawnFailed: false, cleanupFailed: false, stderrBytes: 0, outputTruncated: false }
  expect(officeProbePassed(result, { docxComplete: false, xlsxComplete: false, phaseFailure: false })).toBe(false)
  expect(officeProbePassed(result, { docxComplete: true, xlsxComplete: true, phaseFailure: true })).toBe(false)
  expect(officeProbePassed({ ...result, outputTruncated: true },
    { docxComplete: true, xlsxComplete: true, phaseFailure: false })).toBe(false)
  expect(officeProbePassed(result, { docxComplete: true, xlsxComplete: true, phaseFailure: false })).toBe(true)
})

it.skipIf(process.platform === 'win32')('kills a TERM-ignoring descendant after the leader exits and inherited pipes stay open', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-diagnostic-process-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const pidFile = join(root, 'grandchild.pid')
  const grandchild = [
    "process.on('SIGTERM', () => {})",
    "process.send?.('ready')",
    'setInterval(() => {}, 1000)',
  ].join(';')
  const source = [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })`,
    "process.on('SIGTERM', () => process.exit(0))",
    "child.once('message', () => { writeFileSync(process.argv[1], String(child.pid)); process.stdout.write('ready\\n') })",
    'setInterval(() => {}, 1000)',
  ].join(';')
  let requested = false
  const result = await runOwnedProbe(process.execPath, ['-e', source, pidFile], {}, (line) => {
    if (line === 'ready' && !requested) { requested = true; process.emit('SIGTERM') }
  }, 5_000, 50)
  expect(result).toMatchObject({ controllerSignal: 'SIGTERM', spawnFailed: false })
  expect(requested).toBe(true)
  const pid = Number(await readFile(pidFile, 'utf8'))
  expect(() => { process.kill(pid, 0) }).toThrow(expect.objectContaining({ code: 'ESRCH' }))
})

it('bounds SIGKILL convergence and reports a residual process group', async () => {
  let now = 0
  const signals: NodeJS.Signals[] = []
  const cleanupFailed = await terminateOwnedGroup(123, 50, 75, {
    exists: () => true,
    signal: (_pid, signal) => { signals.push(signal) },
    now: () => now,
    delay: async (milliseconds) => { now += milliseconds },
  })
  expect(cleanupFailed).toBe(true)
  expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  expect(now).toBe(125)
})

it.skipIf(process.platform === 'win32')('contains a stdout callback failure until its process group is gone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-diagnostic-stream-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const pidFile = join(root, 'child.pid')
  const beforeInterrupt = process.listenerCount('SIGINT')
  const beforeTerminate = process.listenerCount('SIGTERM')
  let unhandled: unknown
  const onUnhandled = (error: unknown): void => { unhandled = error }
  process.on('unhandledRejection', onUnhandled)
  const source = [
    "const { writeFileSync } = require('node:fs')",
    'writeFileSync(process.argv[1], String(process.pid))',
    "process.stdout.write('ready\\n')",
    'setInterval(() => {}, 1000)',
  ].join(';')
  try {
    await expect(runOwnedProbe(process.execPath, ['-e', source, pidFile], {}, () => {
      throw new Error('expected line failure')
    }, 5_000, 50, 50)).rejects.toThrow('stdout capture failed')
    await new Promise<void>((resolvePromise) => { setImmediate(resolvePromise) })
    expect(unhandled).toBeUndefined()
    expect(process.listenerCount('SIGINT')).toBe(beforeInterrupt)
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerminate)
    const pid = Number(await readFile(pidFile, 'utf8'))
    expect(() => { process.kill(pid, 0) }).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  } finally { process.removeListener('unhandledRejection', onUnhandled) }
})

it.skipIf(process.platform === 'win32')('cleans a residual process group after a natural nonzero leader exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-diagnostic-nonzero-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const pidFile = join(root, 'grandchild.pid')
  const grandchild = [
    "process.on('SIGTERM', () => {})",
    "process.send?.('ready')",
    'setInterval(() => {}, 1000)',
  ].join(';')
  const source = [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })`,
    "child.once('message', () => { writeFileSync(process.argv[1], String(child.pid)); process.exit(7) })",
    'setInterval(() => {}, 1000)',
  ].join(';')
  const result = await runOwnedProbe(process.execPath, ['-e', source, pidFile], {}, () => {}, 5_000, 50)
  expect(result).toMatchObject({ exitCode: 7, spawnFailed: false })
  const pid = Number(await readFile(pidFile, 'utf8'))
  expect(() => { process.kill(pid, 0) }).toThrow(expect.objectContaining({ code: 'ESRCH' }))
})

it.skipIf(process.platform === 'win32')('drains POSIX probe output while reporting the diagnostic byte ceiling', async () => {
  const source = "process.stdout.write('x'.repeat(40000))"
  const result = await runOwnedProbe(process.execPath, ['-e', source], {}, () => {}, 5_000)
  expect(result).toMatchObject({ exitCode: 0, outputTruncated: true, parentBudgetExceeded: false })
})
