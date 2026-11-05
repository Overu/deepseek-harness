/** Immutable payload and atomic selection-record storage for account platform skills. */
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, open, opendir, readFile, rename, rm, rmdir, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { open as openZip, validateFileName, type Entry, type ZipFile } from 'yauzl'
import type { InstalledPlatformSkill, PlatformSkillInstallProgress, PlatformSkillInstallRequest, PlatformSkillKey, PlatformSkillOperationSettlement, PlatformSkillRemovalRequest, PlatformSkillSnapshot, SkillIdentity } from '../shared/skill-installation.ts'
import { PLATFORM_SKILL_KEY_PATTERN } from '../shared/skill-installation.ts'
import { matchSkillIdentity, skillIdentityKey } from '../shared/skill-identity.ts'

const RECORD = '.json'
const archiveClosures = new WeakMap<ZipFile, Promise<void>>()
interface StoredRecord extends InstalledPlatformSkill { readonly payload: string }
interface StoredHistory extends SkillIdentity { readonly key: PlatformSkillKey }

/** Download and extraction limits applied before a payload can be committed. */
export interface PlatformSkillStoreLimits {
  /** Complete download deadline, including response streaming. */
  readonly requestTimeoutMs: number
  /** Maximum compressed archive bytes. */
  readonly maxArchiveBytes: number
  /** Maximum ZIP entries. */
  readonly maxArchiveEntries: number
  /** Maximum total uncompressed bytes declared by ZIP entries. */
  readonly maxExtractedBytes: number
  /** Exact HTTPS origins admitted for both requests and responses. */
  readonly allowedOrigins: ReadonlySet<string>
}

/** Synchronous observer for progress frames produced within one install. */
export type PlatformSkillProgress = (value: Exclude<PlatformSkillInstallProgress, PlatformSkillOperationSettlement>) => void

/** Reporter for cleanup failures after the visible installation state is settled. */
export type PlatformSkillCleanupReporter = (message: string, error: unknown) => void

/** Parser that must accept a staged root before its installation record commits. */
export type PlatformSkillPayloadValidator = (payload: string, skillName: string, signal: AbortSignal) => Promise<void>

/** Own installed releases for a single account. A record rename is the sole visibility commit. */
export class PlatformSkillStore {
  /** Account-owned directory containing records, immutable payloads, and hidden staging. */
  readonly root: string
  private readonly payloads: string
  private readonly installed: string
  private readonly staging: string
  private readonly history: string
  private readonly ready: Promise<void>
  /**
   * @param dshHome - Current account's DSH Home.
   * @param limits - Deployment archive limits.
   * @param validatePayload - Parses a staged skill before commit.
   * @param reportCleanupFailure - Receives non-fatal cleanup failures after state is settled.
   * @param fetcher - Network boundary.
   */
  constructor(
    dshHome: string,
    private readonly limits: PlatformSkillStoreLimits,
    private readonly validatePayload: PlatformSkillPayloadValidator,
    private readonly reportCleanupFailure: PlatformSkillCleanupReporter,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.root = join(dshHome, 'platform-skills')
    this.payloads = join(this.root, 'payloads')
    this.installed = join(this.root, 'installed')
    this.staging = join(this.root, '.staging')
    this.history = join(this.root, 'auto-install-history')
    this.ready = this.initialize()
  }
  /**
   * Remove abandoned uncommitted work while retaining every selected payload.
   * @param signal - Optional cancellation before and after recovery.
   */
  async recover(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
  }
  /**
   * Return only valid committed releases.
   * @param signal - Optional cancellation while reading records.
   * @returns Installed identities and versions sorted by identity.
   */
  async list(signal?: AbortSignal): Promise<PlatformSkillSnapshot> {
    return { skills: (await this.records(signal)).map(({ key, id, skillName, version }) => installedSkill(key, id, skillName, version)) }
  }
  /**
   * Select configured IDs that have never been installed or explicitly removed.
   * @param catalogue - Published identities used to resolve configured selectors.
   * @param selectors - Configured IDs, or technical names for entries without IDs, in installation order.
   * @param signal - Cancellation while reading account state.
   * @returns Distinct identities eligible for automatic installation.
   */
  async pendingPresets(
    catalogue: readonly SkillIdentity[],
    selectors: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly SkillIdentity[]> {
    const selected = [...new Map(selectors.map((selector) => {
      const identity = selectPreset(selector, catalogue)
      return [skillIdentityKey(identity), identity] as const
    })).values()]
    const installed = await this.records(signal)
    const histories = await this.histories(signal)
    return selected.filter((identity) => {
      signal.throwIfAborted()
      const installedMatch = matchSkillIdentity(identity, installed, catalogue)
      if (installedMatch.kind === 'conflict') throw new Error(`Platform skill preset ${identity.skillName} has conflicting installed identities.`)
      if (installedMatch.kind === 'match') return false
      const historyMatch = matchSkillIdentity(
        identity,
        histories.filter(history => !installed.some(record => record.key === history.key)),
        catalogue,
      )
      if (historyMatch.kind === 'conflict') throw new Error(`Platform skill preset ${identity.skillName} has conflicting installation history.`)
      return historyMatch.kind === 'missing'
    })
  }
  /**
   * Return payload roots selected by committed records.
   * @param signal - Optional cancellation while reading records.
   * @returns Absolute roots for the platform filesystem provider.
   */
  async selectedRoots(signal?: AbortSignal): Promise<readonly string[]> {
    return (await this.records(signal)).map(record => join(this.root, record.payload))
  }
  /**
   * Download, validate and commit a release. Aborting before record replacement preserves the prior release.
   * @param input - Catalogue identity, version, archive URL, and operation identity.
   * @param signal - Cancellation honored until the atomic record replacement begins.
   * @param progress - Observer receiving download, validation, and commit phases.
   * @returns The committed identity and version after cleanup reaches quiescence.
   */
  async install(input: PlatformSkillInstallRequest, signal: AbortSignal, progress: PlatformSkillProgress): Promise<InstalledPlatformSkill> {
    validate(input, this.limits)
    await this.recover(signal)
    return await withFileLock(
      join(this.root, '.mutations'),
      () => this.installLocked(input, signal, progress),
      { signal, waitMs: this.limits.requestTimeoutMs },
    )
  }
  /**
   * Atomically stop selecting a release and reclaim its immutable payload.
   * @param request - Local key and identity that must match the installed record.
   * @param signal - Optional cancellation honored before record removal.
   * @returns Installation state computed before the removal commit with the target omitted.
   */
  async remove(request: PlatformSkillRemovalRequest, signal?: AbortSignal): Promise<PlatformSkillSnapshot> {
    validateRemoval(request)
    await this.recover(signal)
    return await withFileLock(
      join(this.root, '.mutations'),
      async () => {
        const records = await this.records(signal)
        const record = records.find(record => record.key === request.key)
        if (record === undefined) throw new Error('Platform skill is not installed.')
        const matched = matchSkillIdentity(request, [record])
        if (matched.kind !== 'match') throw new Error('Platform skill removal identity does not match the installed skill.')
        signal?.throwIfAborted()
        await this.writeHistory(historyIdentity(record.key, request.id ?? record.id, request.skillName))
        await rm(join(this.installed, `${record.key}${RECORD}`), { force: true })
        await this.cleanup(join(this.payloads, record.key), `Platform skill directory cleanup failed for ${record.key}.`)
        return {
          skills: records.filter(candidate => candidate.key !== record.key)
            .map(({ key, id, skillName, version }) => installedSkill(key, id, skillName, version)),
        }
      },
      {
        ...signal === undefined ? {} : { signal },
        waitMs: this.limits.requestTimeoutMs,
      },
    )
  }
  private async installLocked(
    input: PlatformSkillInstallRequest,
    signal: AbortSignal,
    progress: PlatformSkillProgress,
  ): Promise<InstalledPlatformSkill> {
    const records = await this.records(signal)
    const previousMatch = matchSkillIdentity(input, records)
    if (previousMatch.kind === 'conflict') throw new Error('Platform skill installation identity conflicts with an installed skill.')
    const previous = previousMatch.kind === 'match' ? previousMatch.value : undefined
    if (records.some(record => record.key !== previous?.key && record.skillName === input.skillName)) {
      throw new Error('Platform skill technical name is already used by another installation.')
    }
    if (input.key !== undefined && input.key !== previous?.key) {
      throw new Error('Platform skill update key does not identify the matching installed skill.')
    }
    const key = previous?.key ?? randomUUID() as PlatformSkillKey
    const id = input.id ?? previous?.id
    const token = randomUUID()
    const stage = join(this.staging, `${key}-${token}`)
    const archive = join(stage, 'archive.zip')
    const unpacked = join(stage, 'unpacked')
    const payload = join(this.payloads, key, token)
    let committed = false
    try {
      await mkdir(stage, { recursive: true, mode: 0o700 })
      await download(input, archive, this.fetcher, this.limits, signal, progress)
      signal.throwIfAborted()
      progress({ kind: 'progress', operationId: input.operationId, phase: 'validate' })
      await unzip(archive, unpacked, this.limits, signal)
      signal.throwIfAborted()
      await mkdir(join(this.payloads, key), { recursive: true, mode: 0o700 })
      await movePayload(unpacked, payload)
      await readFile(join(payload, 'SKILL.md'), 'utf8')
      await this.validatePayload(payload, input.skillName, signal)
      signal.throwIfAborted()
      progress({ kind: 'progress', operationId: input.operationId, phase: 'commit' })
      await this.writeRecord(storedRecord(key, id, input.skillName, input.version, relative(this.root, payload)))
      committed = true
      try {
        await this.writeHistory(historyIdentity(key, id, input.skillName))
      } catch (error) {
        this.reportCleanupFailure('Platform skill installation history could not be saved; the installed record remains authoritative.', error)
      }
      if (previous !== undefined) await this.removePayload(previous)
      return installedSkill(key, id, input.skillName, input.version)
    } finally {
      await this.cleanup(stage, 'Platform skill staging cleanup failed.')
      await this.pruneEmptyDirectory(this.staging)
      if (!committed) {
        await this.cleanup(payload, 'Platform skill unpublished payload cleanup failed.')
        await this.pruneEmptyDirectory(join(this.payloads, key))
      }
    }
  }
  private async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.payloads, { recursive: true, mode: 0o700 }),
      mkdir(this.installed, { recursive: true, mode: 0o700 }),
      mkdir(this.history, { recursive: true, mode: 0o700 }),
    ])
    await withFileLock(
      join(this.root, '.mutations'),
      () => this.recoverLocked(),
      { waitMs: this.limits.requestTimeoutMs },
    )
  }
  private async recoverLocked(): Promise<void> {
    await rm(this.staging, { recursive: true, force: true })
    const selected = new Set<string>()
    const records = await opendir(this.installed)
    for await (const entry of records) {
      if (!entry.isFile() || !entry.name.endsWith(RECORD) || entry.name.startsWith('.')) continue
      const record = await this.readRecord(entry.name.slice(0, -RECORD.length))
      if (record !== undefined) {
        selected.add(resolve(this.root, record.payload))
        await this.rememberHandled(record)
      }
    }
    const skillDirectories = await opendir(this.payloads)
    for await (const skill of skillDirectories) {
      if (!skill.isDirectory()) continue
      const skillPath = join(this.payloads, skill.name)
      const releases = await opendir(skillPath)
      for await (const release of releases) {
        if (!release.isDirectory()) continue
        const releasePath = join(skillPath, release.name)
        if (!selected.has(releasePath)) {
          await this.cleanup(releasePath, `Platform skill orphan cleanup failed for ${skill.name}.`)
        }
      }
      await this.pruneEmptyDirectory(skillPath)
    }
  }
  private async records(signal?: AbortSignal): Promise<StoredRecord[]> {
    await this.recover(signal)
    const records: StoredRecord[] = []
    const directory = await opendir(this.installed)
    for await (const entry of directory) {
      signal?.throwIfAborted()
      if (!entry.isFile() || !entry.name.endsWith(RECORD) || entry.name.startsWith('.')) continue
      const record = await this.readRecord(entry.name.slice(0, -RECORD.length))
      if (record !== undefined) records.push(record)
    }
    records.sort((a, b) => a.key.localeCompare(b.key))
    return records
  }
  private async readRecord(key: string): Promise<StoredRecord | undefined> {
    validateKey(key)
    let text: string
    try {
      text = await readFile(join(this.installed, `${key}${RECORD}`), 'utf8')
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw new Error(`Platform skill record for ${key} is not valid JSON.`, { cause: error })
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`Platform skill record for ${key} is invalid.`)
    }
    const record = value as { key?: unknown; id?: unknown; skillName?: unknown; version?: unknown; payload?: unknown }
    if (record.key !== key || !validIdentity(record.id, record.skillName)
      || typeof record.version !== 'string' || record.version === '' || typeof record.payload !== 'string') throw new Error(`Platform skill record for ${key} is invalid.`)
    const path = resolve(this.root, record.payload)
    const payloadRelative = relative(join(this.payloads, key), path)
    if (isAbsolute(record.payload) || payloadRelative === '' || payloadRelative === '..'
      || payloadRelative.startsWith(`..${sep}`) || relative(this.root, path) !== record.payload) {
      throw new Error(`Platform skill record for ${key} selects an invalid payload.`)
    }
    try {
      await readFile(join(path, 'SKILL.md'), 'utf8')
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
    return storedRecord(key as PlatformSkillKey, record.id as StoredRecord['id'], record.skillName as string, record.version, record.payload)
  }
  private async histories(signal?: AbortSignal): Promise<StoredHistory[]> {
    await this.recover(signal)
    const histories: StoredHistory[] = []
    const directory = await opendir(this.history)
    for await (const entry of directory) {
      signal?.throwIfAborted()
      if (!entry.isFile() || !entry.name.endsWith(RECORD) || entry.name.startsWith('.')) continue
      const history = await this.readHistory(entry.name.slice(0, -RECORD.length))
      if (history !== undefined) histories.push(history)
    }
    return histories
  }
  private async readHistory(key: string): Promise<StoredHistory | undefined> {
    validateKey(key)
    let text: string
    try {
      text = await readFile(join(this.history, `${key}${RECORD}`), 'utf8')
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw new Error(`Platform skill installation history for ${key} is not valid JSON.`, { cause: error })
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Platform skill installation history for ${key} is invalid.`)
    const history = value as { key?: unknown; id?: unknown; skillName?: unknown }
    if (history.key !== key || !validIdentity(history.id, history.skillName)) {
      throw new Error(`Platform skill installation history for ${key} is invalid.`)
    }
    return historyIdentity(key as PlatformSkillKey, history.id as StoredHistory['id'], history.skillName as string)
  }
  private async writeRecord(record: StoredRecord): Promise<void> {
    await writeFileAtomic(
      join(this.installed, `${record.key}${RECORD}`),
      `${JSON.stringify(record)}\n`,
      { mode: 0o600, dirMode: 0o700 },
    )
  }
  private async removePayload(record: StoredRecord): Promise<void> {
    await this.cleanup(
      join(this.root, record.payload),
      `Platform skill payload cleanup failed for ${record.key}.`,
    )
    await this.pruneEmptyDirectory(join(this.payloads, record.key))
  }
  private async rememberHandled(identity: StoredHistory): Promise<void> {
    if (await this.readHistory(identity.key) === undefined) await this.writeHistory(identity)
  }
  private async writeHistory(history: StoredHistory): Promise<void> {
    await writeFileAtomic(join(this.history, `${history.key}${RECORD}`), `${JSON.stringify(history)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
  private async pruneEmptyDirectory(path: string): Promise<void> {
    try {
      await rmdir(path)
    } catch (error) {
      if (isMissing(error)) return
      if (error instanceof Error && 'code' in error && (error.code === 'ENOTEMPTY' || error.code === 'EEXIST')) return
      this.reportCleanupFailure('Platform skill empty directory cleanup failed.', error)
    }
  }
  private async cleanup(path: string, message: string): Promise<void> {
    try {
      if ((await lstat(path)).isSymbolicLink()) await unlink(path)
      else await rm(path, { recursive: true, force: true })
    } catch (error) {
      if (isMissing(error)) return
      this.reportCleanupFailure(message, error)
    }
  }
}

async function download(
  input: PlatformSkillInstallRequest,
  destination: string,
  fetcher: typeof fetch,
  limits: PlatformSkillStoreLimits,
  signal: AbortSignal,
  progress: PlatformSkillProgress,
): Promise<void> {
  progress({ kind: 'progress', operationId: input.operationId, phase: 'download', receivedBytes: 0 })
  const response = await fetcher(input.downloadUrl, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(limits.requestTimeoutMs)]),
    headers: { Accept: 'application/zip' },
    redirect: 'error',
  })
  try {
    assertAllowedUrl(response.url, limits)
  } catch (error) {
    if (response.body === null) throw error
    await throwAfterBodyCancellation(response.body, error)
  }
  if (!response.ok) {
    const error = new Error(`Skill download failed with HTTP ${response.status}.`)
    if (response.body === null) throw error
    await throwAfterBodyCancellation(response.body, error)
  }
  if (response.body === null) throw new Error('Skill download returned no response body.')
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > limits.maxArchiveBytes) {
    await throwAfterBodyCancellation(response.body, new Error('Skill archive exceeds the download limit.'))
  }
  let received = 0
  const reader = response.body.getReader()
  let file: Awaited<ReturnType<typeof open>> | undefined
  const failures: unknown[] = []
  try {
    file = await open(destination, 'wx', 0o600)
    while (true) {
      const part = await reader.read()
      if (part.done) break
      signal.throwIfAborted()
      received += part.value.byteLength
      if (received > limits.maxArchiveBytes) {
        throw new Error('Skill archive exceeds the download limit.')
      }
      await writeAll(file, part.value)
      progress(Number.isFinite(length) && length > 0
        ? { kind: 'progress', operationId: input.operationId, phase: 'download', receivedBytes: received, totalBytes: length }
        : { kind: 'progress', operationId: input.operationId, phase: 'download', receivedBytes: received })
    }
    signal.throwIfAborted()
  } catch (error) {
    failures.push(error)
    try {
      await reader.cancel(error)
    } catch (cancelError) {
      failures.push(cancelError)
    }
  } finally {
    reader.releaseLock()
    if (file !== undefined) {
      try {
        await file.close()
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Skill download cleanup failed.')
}

async function throwAfterBodyCancellation(body: ReadableStream<Uint8Array>, failure: unknown): Promise<never> {
  try {
    await body.cancel(failure)
  } catch (error) {
    throw new AggregateError([failure, error], 'Skill download and response cancellation both failed.')
  }
  throw failure
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset)
    if (bytesWritten === 0) throw new Error('Skill archive write made no progress.')
    offset += bytesWritten
  }
}

async function unzip(
  archive: string,
  destination: string,
  limits: PlatformSkillStoreLimits,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  const zip = await openArchive(archive)
  if (signal.aborted) {
    await closeArchive(zip)
    signal.throwIfAborted()
  }
  if (zip.entryCount > limits.maxArchiveEntries) {
    await closeArchive(zip)
    throw new Error('Skill archive contains too many entries.')
  }
  let count = 0
  let bytes = 0
  let activeEntry: Promise<void> = Promise.resolve()
  const failures: unknown[] = []
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false
      const onEntry = (entry: Entry): void => {
        activeEntry = extractEntry(zip, entry, destination, limits, signal, count, bytes)
          .then((totals) => {
            count = totals.count
            bytes = totals.bytes
            zip.readEntry()
          })
        void activeEntry.catch(fail)
      }
      const settle = (error?: unknown): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        zip.removeListener('error', fail)
        zip.removeListener('end', complete)
        zip.removeListener('entry', onEntry)
        if (error === undefined) resolvePromise()
        else rejectPromise(asError(error, 'Skill archive extraction failed.'))
      }
      const fail = (error: unknown): void => { settle(error) }
      const complete = (): void => { settle() }
      const abort = (): void => {
        zip.close()
        void activeEntry.then(
          () => { settle(signal.reason) },
          () => { settle(signal.reason) },
        )
      }
      signal.addEventListener('abort', abort, { once: true })
      zip.once('error', fail)
      zip.once('end', complete)
      zip.on('entry', onEntry)
      if (signal.aborted) {
        abort()
        return
      }
      zip.readEntry()
    })
  } catch (error) {
    failures.push(error)
  }
  try {
    await activeEntry
  } catch (error) {
    if (failures.length === 0) failures.push(error)
  }
  try {
    await closeArchive(zip)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Skill extraction and archive cleanup failed.')
}

function openArchive(path: string): Promise<ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    openZip(path, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, zip) => {
      if (error !== null) rejectPromise(error)
      else {
        const closed = new Promise<void>((resolveClosed, rejectClosed) => {
          const cleanup = (): void => { zip.removeListener('error', closeFailed) }
          const closeFailed = (closeError: unknown): void => {
            if (zip.isOpen) return
            cleanup()
            rejectClosed(asError(closeError, 'Skill archive close failed.'))
          }
          zip.once('close', () => {
            cleanup()
            resolveClosed()
          })
          zip.on('error', closeFailed)
        })
        archiveClosures.set(zip, closed)
        void closed.catch(() => {
          // closeArchive owns reporting this reader failure.
        })
        resolvePromise(zip)
      }
    })
  })
}

async function closeArchive(zip: ZipFile): Promise<void> {
  const closed = archiveClosures.get(zip)
  if (closed === undefined) throw new Error('Skill archive close state is unavailable.')
  if (zip.isOpen) zip.close()
  await closed
}

async function extractEntry(
  zip: ZipFile,
  entry: Entry,
  destination: string,
  limits: PlatformSkillStoreLimits,
  signal: AbortSignal,
  previousCount: number,
  previousBytes: number,
): Promise<{ count: number; bytes: number }> {
  signal.throwIfAborted()
  const count = previousCount + 1
  const bytes = previousBytes + entry.uncompressedSize
  const name = entry.fileName.replaceAll('\\', '/')
  const normalized = posix.normalize(name)
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000
  if (count > limits.maxArchiveEntries || !Number.isSafeInteger(bytes)
    || bytes > limits.maxExtractedBytes || validateFileName(name) !== null
    || posix.isAbsolute(name) || /^[a-z]:\//iu.test(name)
    || normalized === '..' || normalized.startsWith('../') || name.includes('\0')
    || mode === 0o120000 || (mode !== 0 && mode !== 0o040000 && mode !== 0o100000)) {
    throw new Error('Skill archive contains an unsafe or oversized entry.')
  }
  if (entry.isEncrypted()) throw new Error('Skill archive contains an encrypted entry.')
  if (name.startsWith('__MACOSX/')) return { count, bytes }
  const target = join(destination, normalized)
  const directory = name.endsWith('/') || mode === 0o040000
  if (directory) {
    await mkdir(target, { recursive: true, mode: 0o700 })
    return { count, bytes }
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const input = await openEntry(zip, entry)
  const permissions = (entry.externalFileAttributes >>> 16) & 0o777
  const privateMode = (permissions & 0o111) === 0 ? 0o600 : 0o700
  await pipeline(input, createWriteStream(target, { flags: 'wx', mode: privateMode }), { signal })
  return { count, bytes }
}

function openEntry(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null) rejectPromise(error)
      else resolvePromise(stream)
    })
  })
}

async function movePayload(source: string, destination: string): Promise<void> {
  const directory = await opendir(source)
  const entries: Array<{ name: string; isDirectory(): boolean }> = []
  for await (const entry of directory) entries.push(entry)
  if (entries.some(entry => entry.name === 'SKILL.md')) {
    await rename(source, destination)
    return
  }
  const [entry] = entries
  if (entries.length !== 1 || entry === undefined || !entry.isDirectory()) {
    throw new Error('Skill archive must contain one skill directory.')
  }
  await rename(join(source, entry.name), destination)
}

function validate(input: PlatformSkillInstallRequest, limits: PlatformSkillStoreLimits): void {
  if (!validIdentity(input.id, input.skillName)) throw new Error('Skill identity is invalid.')
  if (input.key !== undefined) validateKey(input.key)
  if (input.version.trim() === '') throw new Error('Skill version must not be empty.')
  assertAllowedUrl(input.downloadUrl, limits)
}

function validateRemoval(input: PlatformSkillRemovalRequest): void {
  validateKey(input.key)
  if (!validIdentity(input.id, input.skillName)) throw new Error('Skill identity is invalid.')
}

function validateKey(key: string): void {
  if (!PLATFORM_SKILL_KEY_PATTERN.test(key)) throw new Error('Platform skill key is invalid.')
}

function validIdentity(id: unknown, skillName: unknown): boolean {
  return (id === undefined || typeof id === 'string' && id !== '' && id === id.trim())
    && typeof skillName === 'string' && skillName !== '' && skillName === skillName.trim()
}

function selectPreset(selector: string, catalogue: readonly SkillIdentity[]): SkillIdentity {
  const byId = catalogue.filter(skill => skill.id === selector)
  const candidates = byId.length === 0 ? catalogue.filter(skill => skill.id === undefined && skill.skillName === selector) : byId
  if (candidates.length !== 1) throw new Error(`Configured platform skill preset ${selector} does not identify exactly one catalogue skill.`)
  const [candidate] = candidates
  if (candidate === undefined) throw new Error(`Configured platform skill preset ${selector} is unavailable.`)
  return candidate
}

function installedSkill(key: PlatformSkillKey, id: InstalledPlatformSkill['id'], skillName: string, version: string): InstalledPlatformSkill {
  return id === undefined ? { key, skillName, version } : { key, id, skillName, version }
}

function storedRecord(key: PlatformSkillKey, id: StoredRecord['id'], skillName: string, version: string, payload: string): StoredRecord {
  return id === undefined ? { key, skillName, version, payload } : { key, id, skillName, version, payload }
}

function historyIdentity(key: PlatformSkillKey, id: StoredHistory['id'], skillName: string): StoredHistory {
  return id === undefined ? { key, skillName } : { key, id, skillName }
}

function assertAllowedUrl(value: string, limits: PlatformSkillStoreLimits): void {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !limits.allowedOrigins.has(url.origin)) {
    throw new Error('Skill download URL is not allowed.')
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function asError(value: unknown, message: string): Error {
  return value instanceof Error ? value : new Error(message, { cause: value })
}
