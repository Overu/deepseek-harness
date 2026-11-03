import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { collectPackagingMetrics } from './collect-packaging-metrics.ts'

/** Create an isolated journal root and output directory for one metrics test. */
async function fixture(): Promise<{ readonly root: string; readonly output: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-packaging-metrics-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  return { root: join(directory, 'packaging-runs'), output: join(directory, 'output') }
}

/** Write one complete journal with public metadata and deliberately private extra fields. */
async function writeRun(root: string, name: string): Promise<void> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'run.json'), JSON.stringify({
    startedAt: '2026-11-03T01:02:03.000Z', target: 'darwin-arm64', version: '1.0.12-rc.1',
    env: { APPLE_PASSWORD: 'secret' }, commit: 'private-source-identity',
  }))
  await writeFile(join(directory, 'result.json'), JSON.stringify({
    completedAt: '2026-11-03T01:05:03.000Z', elapsedMs: 180_000, success: false,
    stdout: 'private output', stderr: 'private error', error: 'private failure', artifacts: '/private/artifacts',
    stages: [
      { type: 'stage-end', stage: 'prepare:runtime', stageId: 'nested-stage', elapsedMs: 12_345, success: true,
        output: { text: 'secret output' }, error: 'secret error', environment: { TOKEN: 'secret' }, extraSecret: 'secret' },
      { type: 'stage-end', stage: 'electron-builder', stageId: 'child-stage', elapsedMs: 67_890, code: 1, signal: null,
        timedOut: false, fatalObserved: false, launchError: false, outputError: false, terminationError: false,
        stdout: 'secret stdout', stderr: 'secret stderr' },
    ],
  }))
}

describe('desktop packaging metrics collection', () => {
  it('summarizes nested stages while projecting away private journal fields', async () => {
    const { root, output } = await fixture()
    await writeRun(root, 'run-a')

    await expect(collectPackagingMetrics(root, output)).resolves.toEqual({
      schemaVersion: 1,
      runs: [{
        target: 'darwin-arm64', version: '1.0.12-rc.1', startedAt: '2026-11-03T01:02:03.000Z',
        complete: true, completedAt: '2026-11-03T01:05:03.000Z', elapsedMs: 180_000, success: false,
        stages: [
          { stage: 'prepare:runtime', stageId: 'nested-stage', elapsedMs: 12_345, success: true },
          { stage: 'electron-builder', stageId: 'child-stage', elapsedMs: 67_890, success: false, exitCode: 1 },
        ],
      }],
    })
    const written = await readFile(join(output, 'packaging-metrics.json'), 'utf8')
    expect(written).not.toContain('secret')
    expect(written).not.toContain('private')
    expect(JSON.parse(written)).toEqual(await collectPackagingMetrics(root, output))
  })

  it('writes an empty summary when the journal root is missing or has no runs', async () => {
    const missing = await fixture()
    await expect(collectPackagingMetrics(missing.root, missing.output)).resolves.toEqual({ schemaVersion: 1, runs: [] })

    const empty = await fixture()
    await mkdir(empty.root)
    await expect(collectPackagingMetrics(empty.root, empty.output)).resolves.toEqual({ schemaVersion: 1, runs: [] })
  })

  it('rejects a discovered journal with an invalid result record', async () => {
    const { root, output } = await fixture()
    const directory = join(root, 'broken')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'run.json'), JSON.stringify({
      startedAt: '2026-11-03T01:02:03.000Z', target: 'darwin-arm64', version: '1.0.12-rc.1',
    }))
    await writeFile(join(directory, 'result.json'), '{not json')

    await expect(collectPackagingMetrics(root, output)).rejects.toThrow(`Invalid desktop packaging record: ${join(directory, 'result.json')}`)
  })

  it('marks a journal without result.json incomplete while retaining only its completed stages', async () => {
    const { root, output } = await fixture()
    const directory = join(root, 'incomplete')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'run.json'), JSON.stringify({
      startedAt: '2026-11-03T01:02:03.000Z', target: 'darwin-arm64', version: '1.0.12-rc.1',
    }))
    await writeFile(join(directory, 'events.jsonl'), [
      JSON.stringify({ type: 'stage-start', stage: 'prepare:runtime', stageId: 'nested-stage' }),
      JSON.stringify({ type: 'output', text: 'secret output', environment: { TOKEN: 'secret' } }),
      JSON.stringify({ type: 'stage-end', stage: 'prepare:runtime', stageId: 'nested-stage', elapsedMs: 12_345, success: true, error: 'secret error' }),
    ].join('\n'))

    await expect(collectPackagingMetrics(root, output)).resolves.toEqual({
      schemaVersion: 1,
      runs: [{
        target: 'darwin-arm64', version: '1.0.12-rc.1', startedAt: '2026-11-03T01:02:03.000Z',
        complete: false, success: false,
        stages: [{ stage: 'prepare:runtime', stageId: 'nested-stage', elapsedMs: 12_345, success: true }],
      }],
    })
    expect(await readFile(join(output, 'packaging-metrics.json'), 'utf8')).not.toContain('secret')
  })
})
