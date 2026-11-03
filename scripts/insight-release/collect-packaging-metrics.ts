/** Create a credential-free timing summary from completed desktop packaging journals. */

import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'

const runRecordSchema = z.looseObject({
  startedAt: z.string().min(1),
  target: z.string().min(1),
  version: z.string().min(1),
})

const stageRecordSchema = z.looseObject({
  type: z.literal('stage-end'),
  stage: z.string().min(1),
  stageId: z.string().min(1),
  elapsedMs: z.number().nonnegative(),
  success: z.boolean().optional(),
  code: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
  timedOut: z.boolean().optional(),
  fatalObserved: z.boolean().optional(),
  launchError: z.boolean().optional(),
  outputError: z.boolean().optional(),
  terminationError: z.boolean().optional(),
}).refine(record => record.success !== undefined || record.code !== undefined, {
  message: 'stage end must report success or an exit code',
})

const resultRecordSchema = z.looseObject({
  completedAt: z.string().min(1),
  elapsedMs: z.number().nonnegative(),
  success: z.boolean(),
  stages: z.array(stageRecordSchema),
})

/** One public timing record from a completed packaging stage. */
export interface PackagingStageMetrics {
  /** Public phase label emitted by the packaging journal. */
  readonly stage: string
  /** Unique identifier that relates the phase start and end events. */
  readonly stageId: string
  /** Wall-clock duration measured by the packaging process. */
  readonly elapsedMs: number
  /** Whether the stage completed without its recorded failure indicators. */
  readonly success: boolean
  /** Process exit status when this stage launched a child process. */
  readonly exitCode?: number | null
}

/** One public timing record from a completed desktop packaging invocation. */
export interface PackagingRunMetrics {
  /** Target label selected for this invocation. */
  readonly target: string
  /** Package version selected for this invocation. */
  readonly version: string
  /** Time at which the packaging journal was created. */
  readonly startedAt: string
  /** Whether `result.json` completed the journal before collection. */
  readonly complete: boolean
  /** Time at which a completed packaging journal finished. */
  readonly completedAt?: string
  /** Total duration measured by a completed packaging journal. */
  readonly elapsedMs?: number
  /** Whether the complete packaging invocation succeeded; incomplete records are unsuccessful. */
  readonly success: boolean
  /** Completed child and in-process phases, including nested packaging steps. */
  readonly stages: readonly PackagingStageMetrics[]
}

/** Credential-free summary written for one packaging job. */
export interface PackagingMetrics {
  /** Format version for consumers of this generated summary. */
  readonly schemaVersion: 1
  /** Completed packaging journals found below the requested root. */
  readonly runs: readonly PackagingRunMetrics[]
}

function invalidRecord(path: string): Error {
  return new Error(`Invalid desktop packaging record: ${path}`)
}

async function parseRecord(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw invalidRecord(path)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw invalidRecord(path)
  }
}

async function parseOptionalRecord(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw invalidRecord(path)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw invalidRecord(path)
  }
}

function stageSucceeded(stage: z.infer<typeof stageRecordSchema>): boolean {
  if (stage.success !== undefined) return stage.success
  return stage.code === 0
    && stage.signal === null
    && stage.timedOut !== true
    && stage.fatalObserved !== true
    && stage.launchError !== true
    && stage.outputError !== true
    && stage.terminationError !== true
}

function summarizeStages(stages: readonly z.infer<typeof stageRecordSchema>[]): readonly PackagingStageMetrics[] {
  return stages.map(stage => ({
    stage: stage.stage,
    stageId: stage.stageId,
    elapsedMs: stage.elapsedMs,
    success: stageSucceeded(stage),
    ...(stage.code === undefined ? {} : { exitCode: stage.code }),
  }))
}

async function incompleteStages(path: string): Promise<readonly z.infer<typeof stageRecordSchema>[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw invalidRecord(path)
  }
  const stages: z.infer<typeof stageRecordSchema>[] = []
  for (const line of text.split('\n').filter(Boolean)) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      throw invalidRecord(path)
    }
    const event = z.looseObject({ type: z.string() }).safeParse(record)
    if (!event.success) throw invalidRecord(path)
    if (event.data.type !== 'stage-end') continue
    const stage = stageRecordSchema.safeParse(record)
    if (!stage.success) throw invalidRecord(path)
    stages.push(stage.data)
  }
  return stages
}

async function collectRun(directory: string): Promise<PackagingRunMetrics> {
  const runPath = join(directory, 'run.json')
  const resultPath = join(directory, 'result.json')
  const eventsPath = join(directory, 'events.jsonl')
  const run = runRecordSchema.safeParse(await parseRecord(runPath))
  if (!run.success) throw invalidRecord(runPath)
  const rawResult = await parseOptionalRecord(resultPath)
  if (rawResult === undefined) {
    return {
      target: run.data.target,
      version: run.data.version,
      startedAt: run.data.startedAt,
      complete: false,
      success: false,
      stages: summarizeStages(await incompleteStages(eventsPath)),
    }
  }
  const result = resultRecordSchema.safeParse(rawResult)
  if (!result.success) throw invalidRecord(resultPath)
  return {
    target: run.data.target,
    version: run.data.version,
    startedAt: run.data.startedAt,
    complete: true,
    completedAt: result.data.completedAt,
    elapsedMs: result.data.elapsedMs,
    success: result.data.success,
    stages: summarizeStages(result.data.stages),
  }
}

async function packagingRunDirectories(root: string): Promise<readonly string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name)).sort()
}

/**
 * Write a credential-free summary of completed desktop packaging journals.
 *
 * A missing journal root and an existing root with no runs produce an empty summary so an `always()` CI
 * diagnostics step cannot replace the preceding packaging failure. A discovered journal with invalid records fails.
 * @param root - Directory containing the per-run desktop packaging journal directories.
 * @param outputDirectory - Explicit directory into which `packaging-metrics.json` is written.
 * @returns The generated public summary after it has been written.
 */
export async function collectPackagingMetrics(root: string, outputDirectory: string): Promise<PackagingMetrics> {
  try {
    const metadata = await lstat(root)
    if (!metadata.isDirectory()) throw new Error(`Desktop packaging journal root is not a directory: ${root}`)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      const empty: PackagingMetrics = { schemaVersion: 1, runs: [] }
      await mkdir(outputDirectory, { recursive: true })
      await writeFile(join(outputDirectory, 'packaging-metrics.json'), `${JSON.stringify(empty)}\n`)
      return empty
    }
    throw error
  }
  const metrics: PackagingMetrics = {
    schemaVersion: 1,
    runs: await Promise.all((await packagingRunDirectories(root)).map(collectRun)),
  }
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'packaging-metrics.json'), `${JSON.stringify(metrics)}\n`)
  return metrics
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === '') throw new Error(`Missing required option: --${name}`)
  return value
}

/**
 * Write CI packaging metrics from the journal root selected by command-line options.
 * @returns Resolves after the requested output file has been written.
 */
export async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { root: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: false,
  })
  await collectPackagingMetrics(required(values.root, 'root'), required(values.out, 'out'))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
