import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CredentialStore,
  CredentialStorageReadError,
  CredentialStoragePathError,
  CredentialStorageUnavailableError,
  type CredentialCipher,
} from '../src/desktop/credential-store.ts'

const testDirectories: string[] = []

const cipher: CredentialCipher = {
  available: () => true,
  encrypt: value => Buffer.from(`encrypted:${value}`, 'utf8'),
  decrypt: value => value.toString('utf8').replace(/^encrypted:/u, ''),
}

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-credential-store-'))
  testDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Insight credential store', () => {
  it('round-trips encrypted data without writing the token in plaintext', async () => {
    const file = join(await testDirectory(), 'auth.json')
    const store = new CredentialStore(file, cipher)
    await store.save('access-secret')
    expect(await readFile(file, 'utf8')).not.toContain('access-secret')
    await expect(store.load()).resolves.toBe('access-secret')
  })

  it('does not persist when the platform encryption service is unavailable', async () => {
    const store = new CredentialStore(join(await testDirectory(), 'auth.json'), {
      ...cipher,
      available: () => false,
    })
    await expect(store.save('secret')).rejects.toBeInstanceOf(CredentialStorageUnavailableError)
  })

  it('preserves a corrupt credential file for an explicit reset and never mistakes a directory for it', async () => {
    const directory = await testDirectory()
    const corrupt = join(directory, 'auth.json')
    await writeFile(corrupt, '{broken', 'utf8')
    const before = await readFile(corrupt, 'utf8')
    const beforeDigest = createHash('sha256').update(before).digest('hex')
    await expect(new CredentialStore(corrupt, cipher).load()).rejects.toMatchObject({
      name: 'CredentialStorageReadError', kind: 'invalid',
    } satisfies Partial<CredentialStorageReadError>)
    const after = await readFile(corrupt, 'utf8')
    expect(createHash('sha256').update(after).digest('hex')).toBe(beforeDigest)

    const credentialDirectory = join(directory, 'credential-directory')
    await mkdir(credentialDirectory)
    const store = new CredentialStore(credentialDirectory, cipher)
    await expect(store.clear()).rejects.toBeInstanceOf(CredentialStoragePathError)
    await expect(readFile(credentialDirectory)).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('does not modify an encrypted credential when safe storage is temporarily unavailable', async () => {
    const file = join(await testDirectory(), 'auth.json')
    const original = '{"version":1,"ciphertext":"cHJlc2VydmU="}\n'
    await writeFile(file, original, 'utf8')
    const store = new CredentialStore(file, { ...cipher, available: () => false })
    await expect(store.load()).rejects.toMatchObject({
      name: 'CredentialStorageReadError', kind: 'unavailable',
    } satisfies Partial<CredentialStorageReadError>)
    await expect(readFile(file, 'utf8')).resolves.toBe(original)
  })

  it('preserves an undecryptable legacy ciphertext for a user-directed reset', async () => {
    const file = join(await testDirectory(), 'auth.json')
    const original = '{"version":1,"ciphertext":"bGVnYWN5"}\n'
    await writeFile(file, original, 'utf8')
    const store = new CredentialStore(file, {
      ...cipher,
      decrypt: () => { throw new Error('keychain item unavailable') },
    })
    await expect(store.load()).rejects.toMatchObject({
      name: 'CredentialStorageReadError', kind: 'invalid',
    } satisfies Partial<CredentialStorageReadError>)
    await expect(readFile(file, 'utf8')).resolves.toBe(original)
  })

  it('rejects credential and parent-directory symlinks without following or replacing their targets', async () => {
    const directory = await testDirectory()
    const target = join(directory, 'target.json')
    const original = '{"version":1,"ciphertext":"bGVnYWN5"}\n'
    await writeFile(target, original, 'utf8')
    const linkedCredential = join(directory, 'auth.json')
    await symlink(target, linkedCredential)
    const linkedStore = new CredentialStore(linkedCredential, cipher)

    await expect(linkedStore.load()).rejects.toMatchObject({
      name: 'CredentialStorageReadError', kind: 'invalid',
    } satisfies Partial<CredentialStorageReadError>)
    await expect(linkedStore.save('new-token')).rejects.toBeInstanceOf(CredentialStoragePathError)
    await expect(linkedStore.clear()).rejects.toBeInstanceOf(CredentialStoragePathError)
    await expect(readFile(target, 'utf8')).resolves.toBe(original)

    const storageTarget = join(directory, 'storage-target')
    await mkdir(storageTarget)
    const linkedParent = join(directory, 'auth')
    await symlink(storageTarget, linkedParent)
    const parentStore = new CredentialStore(join(linkedParent, 'test.json'), cipher)
    await expect(parentStore.save('new-token')).rejects.toBeInstanceOf(CredentialStoragePathError)
    await expect(parentStore.clear()).rejects.toBeInstanceOf(CredentialStoragePathError)
    await expect(readFile(join(storageTarget, 'test.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not remove a pre-existing temporary-name collision it did not create', async () => {
    const directory = await testDirectory()
    const credential = join(directory, 'auth.json')
    const collision = join(directory, '.auth.json.tmp-collision')
    await writeFile(collision, 'do-not-delete', 'utf8')
    const store = new CredentialStore(credential, cipher, () => 'collision')

    await expect(store.save('new-token')).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(readFile(collision, 'utf8')).resolves.toBe('do-not-delete')
  })
})
