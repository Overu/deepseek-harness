/**
 * Bounded, read-only sampling of LibreOffice helper lifetimes during Intel packaging.
 * A missing observation does not establish that a helper never ran between samples.
 */

import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { performance } from 'node:perf_hooks'

const PROCESS_TABLE_TIMEOUT_MS = 2_000
const PROCESS_TABLE_MAX_BYTES = 1024 * 1024
const SAMPLE_INTERVAL_MS = 1_000
const SUSTAINED_OBSERVATION_MS = 45_000
const MAX_OUTPUT_RECORDS = 64
const HELPER_NAME = 'libreoffice-kit'

type ObservedState = 'R' | 'S' | 'Z' | 'other'

/** One process-table row retained only inside the observer. */
export interface ProcessTableRow {
  readonly pid: number
  readonly ppid: number
  readonly state: ObservedState
  readonly startIdentity: string
  readonly command: string
}

/** An allowlisted observer record that contains no process identity or command data. */
export type OfficeProcessObserverEvent = {
  readonly event: 'helper-first-observed' | 'helper-no-longer-observed' | 'helper-sustained-observation'
  readonly observedAt: string
  readonly elapsedMs: number
  readonly durationMs: number
  readonly state: ObservedState
  readonly qualification: false
} | {
  readonly event: 'observer-failure'
  readonly observedAt: string
  readonly elapsedMs: number
  readonly kind: 'process-table-unavailable'
  readonly qualification: false
} | {
  readonly event: 'observer-summary'
  readonly observedAt: string
  readonly elapsedMs: number
  readonly helpersObserved: number
  readonly activeHelpers: number
  readonly samples: number
  readonly sampleFailures: number
  readonly outputLimited: boolean
  readonly qualification: false
}

interface TrackedHelper {
  readonly firstObservedMs: number
  state: ObservedState
  sustainedReported: boolean
}

/** Dependencies used by the observer loop; production supplies `/bin/ps` and monotonic clocks. */
export interface OfficeProcessObserverDependencies {
  readonly read: (signal: AbortSignal) => Promise<readonly ProcessTableRow[]>
  readonly monotonicNow: () => number
  readonly wallNow: () => number
  readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>
  readonly write: (line: string) => void
}

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function observedState(value: string): ObservedState {
  const state = value[0]
  return state === 'R' || state === 'S' || state === 'Z' ? state : 'other'
}

/**
 * Parse the fixed `ps` projection without retaining arguments or environment data.
 * @param output - `/bin/ps -axo pid=,ppid=,state=,lstart=,comm=` output.
 * @returns Valid process rows; malformed rows are ignored.
 */
export function parseProcessTable(output: string): readonly ProcessTableRow[] {
  const rows: ProcessTableRow[] = []
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+?)\s*$/u.exec(line)
    if (match === null) continue
    const pid = positiveInteger(match[1])
    const ppid = match[2] === '0' ? 0 : positiveInteger(match[2])
    const state = match[3]
    const startIdentity = match[4]
    const command = match[5]
    if (pid === undefined || ppid === undefined || state === undefined
      || startIdentity === undefined || command === undefined) continue
    rows.push({ pid, ppid, state: observedState(state), startIdentity, command })
  }
  return rows
}

function descendantPids(rootPid: number, rows: readonly ProcessTableRow[]): ReadonlySet<number> {
  const descendants = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
        descendants.add(row.pid)
        changed = true
      }
    }
  }
  descendants.delete(rootPid)
  return descendants
}

function identity(row: ProcessTableRow): string { return `${String(row.pid)}\0${row.startIdentity}` }

/** Track sampled helper appearances without exposing their process identities. */
export class OfficeProcessTracker {
  readonly #active = new Map<string, TrackedHelper>()
  #helpersObserved = 0

  /** @param rootPid - Bash step whose descendants may include the helper. */
  constructor(private readonly rootPid: number) {}

  /** Number of distinct PID/start-time identities observed. */
  get helpersObserved(): number { return this.#helpersObserved }

  /** Number of helper identities present in the latest successful sample. */
  get activeHelpers(): number { return this.#active.size }

  /**
   * Apply one complete process-table sample.
   * @param rows - Current process table.
   * @param elapsedMs - Monotonic time since observer startup.
   * @param observedAt - UTC wall-clock timestamp for journal correlation.
   * @returns Allowlisted lifecycle events for this sample.
   */
  observe(rows: readonly ProcessTableRow[], elapsedMs: number, observedAt: string): readonly OfficeProcessObserverEvent[] {
    const descendants = descendantPids(this.rootPid, rows)
    const current = new Map<string, ProcessTableRow>()
    for (const row of rows) {
      if (descendants.has(row.pid) && basename(row.command) === HELPER_NAME) current.set(identity(row), row)
    }

    const events: OfficeProcessObserverEvent[] = []
    for (const [key, tracked] of this.#active) {
      if (current.has(key)) continue
      events.push({ event: 'helper-no-longer-observed', observedAt, elapsedMs,
        durationMs: Math.max(0, elapsedMs - tracked.firstObservedMs), state: tracked.state, qualification: false })
      this.#active.delete(key)
    }
    for (const [key, row] of current) {
      const tracked = this.#active.get(key)
      if (tracked === undefined) {
        this.#active.set(key, { firstObservedMs: elapsedMs, state: row.state, sustainedReported: false })
        this.#helpersObserved++
        events.push({ event: 'helper-first-observed', observedAt, elapsedMs, durationMs: 0,
          state: row.state, qualification: false })
        continue
      }
      tracked.state = row.state
      const durationMs = Math.max(0, elapsedMs - tracked.firstObservedMs)
      if (!tracked.sustainedReported && durationMs >= SUSTAINED_OBSERVATION_MS) {
        tracked.sustainedReported = true
        events.push({ event: 'helper-sustained-observation', observedAt, elapsedMs, durationMs,
          state: row.state, qualification: false })
      }
    }
    return events
  }
}

/** Serialize only fields declared by the observer record union. */
export function officeProcessObserverRecord(event: OfficeProcessObserverEvent): string {
  return JSON.stringify({ subject: 'insight-office-process-observer', ...event })
}

/** Bound observer output while reserving one final summary record. */
export class BoundedOfficeProcessObserverOutput {
  #records = 0
  #limited = false

  /** @param write - Destination for one already-sanitized JSON line. */
  constructor(private readonly write: (line: string) => void) {}

  /** Whether lifecycle records were omitted after reaching the fixed output cap. */
  get limited(): boolean { return this.#limited }

  /**
   * Write one lifecycle record if capacity remains.
   * @param event - Allowlisted lifecycle or failure event.
   */
  writeEvent(event: Exclude<OfficeProcessObserverEvent, { readonly event: 'observer-summary' }>): void {
    if (this.#records >= MAX_OUTPUT_RECORDS - 1) { this.#limited = true; return }
    this.write(officeProcessObserverRecord(event))
    this.#records++
  }

  /**
   * Write the reserved terminal summary.
   * @param event - Allowlisted summary event.
   */
  writeSummary(event: Extract<OfficeProcessObserverEvent, { readonly event: 'observer-summary' }>): void {
    this.write(officeProcessObserverRecord(event))
    this.#records++
  }
}

function readProcessTable(signal: AbortSignal): Promise<readonly ProcessTableRow[]> {
  return new Promise((resolvePromise, reject) => {
    let completion: { readonly error: Error | null; readonly stdout: string } | undefined
    const child = execFile('/bin/ps', ['-axo', 'pid=,ppid=,state=,lstart=,comm='], {
      encoding: 'utf8', env: { LANG: 'C', LC_ALL: 'C' }, timeout: PROCESS_TABLE_TIMEOUT_MS,
      killSignal: 'SIGKILL', maxBuffer: PROCESS_TABLE_MAX_BYTES, signal,
    }, (error, stdout) => {
      completion = { error, stdout }
    })
    // Abort can invoke execFile's callback before the owned process and its pipes close.
    child.once('close', () => {
      if (completion?.error === null) resolvePromise(parseProcessTable(completion.stdout))
      else reject(new Error('office process observer: process table unavailable', { cause: completion?.error }))
    })
  })
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolvePromise) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolvePromise()
    }
    const timer = setTimeout(done, milliseconds)
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}

const PRODUCTION_DEPENDENCIES: OfficeProcessObserverDependencies = {
  read: readProcessTable,
  monotonicNow: () => performance.now(),
  wallNow: () => Date.now(),
  wait,
  write: (line) => { process.stdout.write(`${line}\n`) },
}

/**
 * Observe one packaging shell's helper descendants until cancellation or a process-table failure.
 * @param rootPid - Packaging Bash PID.
 * @param signal - Observer-only cancellation; it never signals product processes.
 * @param dependencies - Process reader, clocks, wait and sanitized output destination.
 */
export async function observeOfficeProcessLifetime(
  rootPid: number, signal: AbortSignal, dependencies: OfficeProcessObserverDependencies = PRODUCTION_DEPENDENCIES,
): Promise<void> {
  const started = dependencies.monotonicNow()
  const tracker = new OfficeProcessTracker(rootPid)
  const output = new BoundedOfficeProcessObserverOutput(dependencies.write)
  const cancelled = (): boolean => signal.aborted
  let samples = 0
  let sampleFailures = 0
  while (!cancelled()) {
    try {
      const rows = await dependencies.read(signal)
      if (cancelled()) break
      samples++
      const elapsedMs = Math.max(0, Math.round(dependencies.monotonicNow() - started))
      const observedAt = new Date(dependencies.wallNow()).toISOString()
      for (const event of tracker.observe(rows, elapsedMs, observedAt)) {
        if (event.event !== 'observer-summary') output.writeEvent(event)
      }
    } catch (_error) {
      if (cancelled()) break
      sampleFailures++
      output.writeEvent({ event: 'observer-failure', observedAt: new Date(dependencies.wallNow()).toISOString(),
        elapsedMs: Math.max(0, Math.round(dependencies.monotonicNow() - started)),
        kind: 'process-table-unavailable', qualification: false })
      break
    }
    await dependencies.wait(SAMPLE_INTERVAL_MS, signal)
  }
  output.writeSummary({ event: 'observer-summary', observedAt: new Date(dependencies.wallNow()).toISOString(),
    elapsedMs: Math.max(0, Math.round(dependencies.monotonicNow() - started)),
    helpersObserved: tracker.helpersObserved, activeHelpers: tracker.activeHelpers,
    samples, sampleFailures, outputLimited: output.limited, qualification: false })
}

async function main(): Promise<void> {
  const rootPid = positiveInteger(process.argv[2])
  if (rootPid === undefined || process.argv.length !== 3) {
    throw new Error('office process observer: expected one packaging Bash PID')
  }
  const controller = new AbortController()
  const interrupt = (): void => { controller.abort() }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try { await observeOfficeProcessLifetime(rootPid, controller.signal) }
  finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

if (import.meta.main) {
  main().catch(() => {
    process.stdout.write(`${officeProcessObserverRecord({ event: 'observer-failure', observedAt: new Date().toISOString(),
      elapsedMs: 0, kind: 'process-table-unavailable', qualification: false })}\n`)
    process.exitCode = 1
  })
}
