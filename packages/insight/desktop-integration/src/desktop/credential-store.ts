/** Safe-storage encrypted credential persistence for the desktop main process. */
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

interface CredentialFile {
  version: 1
  ciphertext: string
}

/** Encryption operations supplied by Electron safeStorage in the desktop main process. */
export interface CredentialCipher {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

/** Raised when the platform cannot persist credentials with OS encryption. */
export class CredentialStorageUnavailableError extends Error {
  constructor() {
    super('The operating system secure storage is unavailable.')
    this.name = 'CredentialStorageUnavailableError'
  }
}

/** Raised when an existing encrypted credential cannot be safely read. */
export class CredentialStorageReadError extends Error {
  constructor(readonly kind: 'unavailable' | 'invalid') {
    super(kind === 'unavailable'
      ? 'The operating system secure storage is unavailable.'
      : 'The stored credential cannot be read safely.')
    this.name = 'CredentialStorageReadError'
  }
}

/** Raised when the credential location is not a regular, owned filesystem path. */
export class CredentialStoragePathError extends Error {
  constructor() {
    super('The credential storage path is unsafe.')
    this.name = 'CredentialStoragePathError'
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isExistingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function isCredentialFile(value: unknown): value is CredentialFile {
  if (typeof value !== 'object' || value === null) return false
  const version: unknown = Reflect.get(value, 'version')
  const ciphertext: unknown = Reflect.get(value, 'ciphertext')
  return version === 1 && typeof ciphertext === 'string'
}

/** Persist one access token as a safeStorage ciphertext file. */
export class CredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly cipher: CredentialCipher,
    private readonly createTemporaryName: () => string = randomUUID,
  ) {}

  /** Read and decrypt the persisted access token without changing an unreadable file.
   *
   * @returns The token, or undefined when no credential file exists.
   */
  async load(): Promise<string | undefined> {
    let raw: string
    try {
      if (!await this.inspectParentDirectory(false)) return undefined
      const handle = await this.openCredentialForRead()
      try {
        raw = await handle.readFile({ encoding: 'utf8' })
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (isMissingFile(error)) return undefined
      if (error instanceof CredentialStorageReadError) throw error
      if (error instanceof CredentialStoragePathError) {
        throw new CredentialStorageReadError('invalid')
      }
      throw new CredentialStorageReadError('unavailable')
    }

    if (!this.cipher.available()) throw new CredentialStorageReadError('unavailable')

    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isCredentialFile(parsed)) throw new Error('Unsupported credential file.')
      const token = this.cipher.decrypt(Buffer.from(parsed.ciphertext, 'base64'))
      if (!token) throw new Error('Empty credential.')
      return token
    } catch {
      throw new CredentialStorageReadError('invalid')
    }
  }

  /** Encrypt and atomically replace the persisted access token.
   *
   * @param token Main-only access token to persist.
   * @returns Resolves after the replacement is durable.
   */
  async save(token: string): Promise<void> {
    if (!this.cipher.available()) throw new CredentialStorageUnavailableError()
    const encrypted: CredentialFile = {
      version: 1,
      ciphertext: this.cipher.encrypt(token).toString('base64'),
    }
    await this.inspectParentDirectory(true)
    await this.assertRegularCredentialTarget()
    const temporaryPath = join(dirname(this.filePath), `.${basename(this.filePath)}.tmp-${this.createTemporaryName()}`)
    let temporaryCreated = false
    try {
      const handle = await open(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      temporaryCreated = true
      try {
        await handle.writeFile(`${JSON.stringify(encrypted)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      if (temporaryCreated) await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  /** Remove only the credential file; directories are never removed by this store. */
  async clear(): Promise<void> {
    if (!await this.inspectParentDirectory(false)) return
    try {
      const details = await lstat(this.filePath)
      if (details.isDirectory() || details.isSymbolicLink()) throw new CredentialStoragePathError()
    } catch (error) {
      if (isMissingFile(error)) return
      throw error
    }
    await rm(this.filePath, { force: true })
  }

  private async openCredentialForRead() {
    const details = await lstat(this.filePath)
    if (!details.isFile() || details.isSymbolicLink()) throw new CredentialStoragePathError()
    try {
      return await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if (isMissingFile(error)) throw error
      throw new CredentialStoragePathError()
    }
  }

  private async assertRegularCredentialTarget(): Promise<void> {
    try {
      const details = await lstat(this.filePath)
      if (!details.isFile() || details.isSymbolicLink()) throw new CredentialStoragePathError()
    } catch (error) {
      if (isMissingFile(error)) return
      throw error
    }
  }

  private async inspectParentDirectory(create: boolean): Promise<boolean> {
    const directory = dirname(this.filePath)
    try {
      const details = await lstat(directory)
      if (!details.isDirectory() || details.isSymbolicLink()) throw new CredentialStoragePathError()
    } catch (error) {
      if (!isMissingFile(error)) throw error
      if (!create) return false
      await this.createOwnedDirectory(directory)
    }
    const parent = await lstat(dirname(directory))
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new CredentialStoragePathError()
    return true
  }

  private async createOwnedDirectory(directory: string): Promise<void> {
    const missing: string[] = []
    let current = directory
    while (true) {
      try {
        const details = await lstat(current)
        if (!details.isDirectory() || details.isSymbolicLink()) throw new CredentialStoragePathError()
        break
      } catch (error) {
        if (!isMissingFile(error)) throw error
        missing.unshift(current)
        const parent = dirname(current)
        if (parent === current) throw new CredentialStoragePathError()
        current = parent
      }
    }
    for (const path of missing) {
      try {
        await mkdir(path, { mode: 0o700 })
      } catch (error) {
        if (!isExistingFile(error)) throw error
      }
      const details = await lstat(path)
      if (!details.isDirectory() || details.isSymbolicLink()) throw new CredentialStoragePathError()
    }
  }
}
