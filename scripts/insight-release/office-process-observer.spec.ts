import { expect, it, vi } from 'vitest'
import {
  BoundedOfficeProcessObserverOutput,
  observeOfficeProcessLifetime,
  OfficeProcessTracker,
  officeProcessObserverRecord,
  parseProcessTable,
  type OfficeProcessObserverDependencies,
  type ProcessTableRow,
} from './office-process-observer.ts'

function row(pid: number, ppid: number, command: string, startIdentity = 'Fri Oct 31 01:00:00 2026', state = 'S'): ProcessTableRow {
  return { pid, ppid, command, startIdentity, state: state === 'R' || state === 'S' || state === 'Z' ? state : 'other' }
}

it('parses the fixed process projection and excludes unrelated helpers', () => {
  const rows = parseProcessTable([
    ' 100 1 S Fri Oct 31 01:00:00 2026 /bin/bash',
    ' 101 100 R Fri Oct 31 01:00:01 2026 /opt/Electron',
    ' 102 101 S Fri Oct 31 01:00:02 2026 /private/runtime/libreoffice-kit',
    ' 200 1 R Fri Oct 31 01:00:03 2026 /other/libreoffice-kit',
    ' malformed row',
  ].join('\n'))
  const events = new OfficeProcessTracker(100).observe(rows, 2_000, '2026-10-31T01:00:02.000Z')
  expect(events).toEqual([{
    event: 'helper-first-observed', observedAt: '2026-10-31T01:00:02.000Z', elapsedMs: 2_000,
    durationMs: 0, state: 'S', qualification: false,
  }])
  const serialized = officeProcessObserverRecord(events[0]!)
  expect(serialized).not.toContain('102')
  expect(serialized).not.toContain('runtime')
  expect(serialized).not.toContain('command')
})

it('treats a reused PID with a new start identity as a distinct helper lifetime', () => {
  const tracker = new OfficeProcessTracker(100)
  tracker.observe([row(101, 100, '/opt/Electron'), row(102, 101, '/a/libreoffice-kit', 'first')], 0, '2026-10-31T01:00:00.000Z')
  expect(tracker.observe([
    row(101, 100, '/opt/Electron'), row(102, 101, '/a/libreoffice-kit', 'second', 'R'),
  ], 5_000, '2026-10-31T01:00:05.000Z').map(event => event.event))
    .toEqual(['helper-no-longer-observed', 'helper-first-observed'])
  expect(tracker.helpersObserved).toBe(2)
  expect(tracker.activeHelpers).toBe(1)
  expect(tracker.observe([row(101, 100, '/opt/Electron')], 6_000, '2026-10-31T01:00:06.000Z'))
    .toMatchObject([{ event: 'helper-no-longer-observed', durationMs: 1_000, state: 'R' }])
})

it('reports one sustained observation after 45 seconds', () => {
  const tracker = new OfficeProcessTracker(100)
  const rows = [row(101, 100, '/opt/Electron'), row(102, 101, '/a/libreoffice-kit')]
  expect(tracker.observe(rows, 0, '2026-10-31T01:00:00.000Z')).toHaveLength(1)
  expect(tracker.observe(rows, 44_999, '2026-10-31T01:00:44.999Z')).toEqual([])
  expect(tracker.observe(rows, 45_000, '2026-10-31T01:00:45.000Z'))
    .toMatchObject([{ event: 'helper-sustained-observation', durationMs: 45_000 }])
  expect(tracker.observe(rows, 60_000, '2026-10-31T01:01:00.000Z')).toEqual([])
})

it('bounds lifecycle output and reserves the summary', () => {
  const lines: string[] = []
  const output = new BoundedOfficeProcessObserverOutput((line) => { lines.push(line) })
  for (let index = 0; index < 80; index++) {
    output.writeEvent({ event: 'helper-first-observed', observedAt: '2026-10-31T01:00:00.000Z',
      elapsedMs: index, durationMs: 0, state: 'S', qualification: false })
  }
  expect(output.limited).toBe(true)
  output.writeSummary({ event: 'observer-summary', observedAt: '2026-10-31T01:01:00.000Z', elapsedMs: 60_000,
    helpersObserved: 80, activeHelpers: 0, samples: 80, sampleFailures: 0,
    outputLimited: output.limited, qualification: false })
  expect(lines).toHaveLength(64)
  expect(lines.at(-1)).toContain('"event":"observer-summary"')
})

it('awaits an in-flight process read before reporting cancellation summary', async () => {
  const started = Promise.withResolvers<undefined>()
  let readSettled = false
  const lines: string[] = []
  const controller = new AbortController()
  const dependencies: OfficeProcessObserverDependencies = {
    read: signal => new Promise((_, reject) => {
      started.resolve(undefined)
      signal.addEventListener('abort', () => {
        readSettled = true
        reject(new Error('cancelled'))
      }, { once: true })
    }),
    monotonicNow: () => 5,
    wallNow: () => Date.UTC(2026, 9, 31, 1),
    wait: vi.fn(async () => {}),
    write: (line) => { expect(readSettled).toBe(true); lines.push(line) },
  }
  const observing = observeOfficeProcessLifetime(100, controller.signal, dependencies)
  await started.promise
  controller.abort()
  await observing
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain('"event":"observer-summary"')
  expect(lines[0]).toContain('"sampleFailures":0')
})

it('resets consecutive read failures after a valid sample and keeps the regular interval', async () => {
  const lines: string[] = []
  const controller = new AbortController()
  const read = vi.fn<OfficeProcessObserverDependencies['read']>()
    .mockRejectedValueOnce(new Error('private ps detail'))
    .mockRejectedValueOnce(new Error('private ps detail'))
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error('private ps detail'))
    .mockRejectedValueOnce(new Error('private ps detail'))
    .mockResolvedValueOnce([row(101, 100, '/a/libreoffice-kit')])
  const wait = vi.fn(async (milliseconds: number) => {
    expect(milliseconds).toBe(1_000)
    if (read.mock.calls.length === 6) controller.abort()
  })
  const dependencies: OfficeProcessObserverDependencies = {
    read,
    monotonicNow: () => 10,
    wallNow: () => Date.UTC(2026, 9, 31, 1),
    wait,
    write: (line) => { lines.push(line) },
  }
  await observeOfficeProcessLifetime(100, controller.signal, dependencies)
  expect(read).toHaveBeenCalledTimes(6)
  expect(wait).toHaveBeenCalledTimes(6)
  expect(lines).toHaveLength(6)
  expect(lines[0]).toContain('"event":"observer-failure"')
  expect(lines[0]).not.toContain('private ps detail')
  expect(lines[4]).toContain('"event":"helper-first-observed"')
  expect(lines[5]).toContain('"event":"observer-summary"')
  expect(lines[5]).toContain('"sampleFailures":4')
  expect(lines[5]).toContain('"samples":2')
  expect(lines[5]).toContain('"helpersObserved":1')
})

it('stops after three consecutive failed reads without a busy loop', async () => {
  const lines: string[] = []
  const read = vi.fn<OfficeProcessObserverDependencies['read']>(async () => { throw new Error('private ps detail') })
  const wait = vi.fn(async () => {})
  await observeOfficeProcessLifetime(100, new AbortController().signal, {
    read, wait,
    monotonicNow: () => 10,
    wallNow: () => Date.UTC(2026, 9, 31, 1),
    write: (line) => { lines.push(line) },
  })
  expect(read).toHaveBeenCalledTimes(3)
  expect(wait.mock.calls).toEqual([[1_000, expect.any(AbortSignal)], [1_000, expect.any(AbortSignal)]])
  expect(lines).toHaveLength(4)
  expect(lines.join('\n')).not.toContain('private ps detail')
  expect(lines[3]).toContain('"sampleFailures":3')
  expect(lines[3]).toContain('"event":"observer-summary"')
})
